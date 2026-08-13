/** In-memory ACP transport fixture over the real agent factory and loop. */

import { Context } from '@deepseek-ai/cordis'
import {
  ClientSideConnection,
  ndJsonStream,
  type Agent as AcpAgent,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type Stream,
} from '@agentclientprotocol/sdk'
import { type GenerateOptions, LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as AcpPlugin from '../src/index.ts'
import type { AcpConfig } from '../src/index.ts'

/** Scripted adapter for protocol tests. */
class MockAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: (StreamChunk[] | 'hang')[]) {
    super()
  }

  override providerInfo(provider: string) {
    if (provider !== 'mock') throw new Error(`MockAdapter: unknown provider ${provider}`)
    return { id: 'mock', name: 'Mock' }
  }

  override listModels(provider: string) {
    return Promise.resolve(provider === 'mock' ? [{ provider: 'mock', id: 'mock', name: 'Mock' }] : [])
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('MockAdapter: script exhausted')
    if (entry === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('aborted'))
          return
        }
        options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
      return
    }
    for (const chunk of entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

/** Scripted text response ending in a clean stop. */
export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Scripted response ending at the output-token ceiling. */
export function maxTokensResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ]
}

/** Scripted response that fails after publishing an uncommitted partial chunk. */
export function errorResponse(message: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'partial' },
    { type: 'finish', reason: { kind: 'error', failure: { message, code: 'PROVIDER_ERROR' } } },
  ]
}

export type CapturedUpdate = SessionNotification['update']

export interface BridgeHarness {
  ctx: Context
  client: ClientSideConnection
  adapter: MockAdapter
  updates: CapturedUpdate[]
  sessionUpdates: { sessionId: string; update: CapturedUpdate }[]
  permissionRequests: RequestPermissionRequest[]
  onPermission: (request: RequestPermissionRequest) => RequestPermissionResponse
  onSessionUpdateError: (() => void) | undefined
  closeClientTransport: () => Promise<void>
  abortClientTransport: () => Promise<void>
  acpFiber: Awaited<ReturnType<Context['plugin']>>
  /** The AgentLoop fiber, so a test can reload the loop out from under the bridge. */
  loopFiber: Awaited<ReturnType<Context['plugin']>>
  dispose: () => Promise<void>
}

type AcpConfigOverrides = { [K in keyof AcpConfig]?: AcpConfig[K] | undefined }

/** Build the bridge and a connected SDK client over cross-wired byte streams. */
export async function makeBridgeHarness(options: {
  script?: (StreamChunk[] | 'hang')[]
  config?: AcpConfigOverrides
  persona?: string
} = {}): Promise<BridgeHarness> {
  const adapter = new MockAdapter(options.script ?? [])
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona: options.persona ?? '' } })
  const loopFiber = await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)

  const agentToClient = new TransformStream<Uint8Array, Uint8Array>()
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>()
  const clientToAgentWriter = clientToAgent.writable.getWriter()
  const clientOutput = new WritableStream<Uint8Array>({
    write: chunk => clientToAgentWriter.write(chunk),
  })
  const agentStream: Stream = ndJsonStream(agentToClient.writable, clientToAgent.readable)
  const clientStream: Stream = ndJsonStream(clientOutput, agentToClient.readable)

  const updates: CapturedUpdate[] = []
  const sessionUpdates: { sessionId: string; update: CapturedUpdate }[] = []
  const permissionRequests: RequestPermissionRequest[] = []
  const harness: BridgeHarness = {
    ctx,
    adapter,
    updates,
    sessionUpdates,
    permissionRequests,
    onPermission: () => ({ outcome: { outcome: 'cancelled' } }),
    onSessionUpdateError: undefined,
    client: undefined as unknown as ClientSideConnection,
    acpFiber: undefined as unknown as BridgeHarness['acpFiber'],
    loopFiber,
    closeClientTransport: async () => { await clientToAgentWriter.close() },
    abortClientTransport: async () => { await clientToAgentWriter.abort(new Error('client transport failed')) },
    dispose: async () => { await ctx.fiber.dispose() },
  }

  const makeClient = (_agent: AcpAgent): Client => ({
    sessionUpdate(params: SessionNotification): Promise<void> {
      updates.push(params.update)
      sessionUpdates.push({ sessionId: params.sessionId, update: params.update })
      if (harness.onSessionUpdateError !== undefined) return Promise.reject(new Error('client update rejected'))
      return Promise.resolve()
    },
    requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
      permissionRequests.push(params)
      return Promise.resolve(harness.onPermission(params))
    },
  })

  const config = { stream: agentStream, ...options.config } as AcpConfig
  if (!(options.config && 'provider' in options.config)) config.provider = 'mock'
  if (!(options.config && 'model' in options.config)) config.model = 'mock'
  harness.acpFiber = await ctx.plugin({
    name: 'acp-test',
    inject: [...AcpPlugin.inject],
    apply: (inner: Context) => { AcpPlugin.apply(inner, config) },
  })
  harness.client = new ClientSideConnection(makeClient, clientStream)
  return harness
}
