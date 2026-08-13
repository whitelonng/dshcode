import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  errorResponse,
  makeBridgeHarness,
  maxTokensResponse,
  textResponse,
  type BridgeHarness,
} from './harness.ts'

async function newSession(harness: BridgeHarness): Promise<string> {
  await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  return (await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).sessionId
}

function messageText(harness: BridgeHarness): string {
  return harness.updates.flatMap(update => (
    update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
      ? [update.content.text]
      : []
  )).join('')
}

describe('ACP prompt lifecycle', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('maps a max-token turn to end_turn without losing its committed text', async () => {
    harness = await makeBridgeHarness({ script: [maxTokensResponse('cut off')] })
    const sessionId = await newSession(harness)
    const result = await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })
    // A token-limit turn ending is not a prompt-level stop reason (README):
    // the prompt settles at whole-agent idle with end_turn.
    expect(result.stopReason).toBe('end_turn')
    await vi.waitFor(() => { expect(messageText(harness!)).toBe('cut off') })
  })

  it('renders an assistant image as an explicit attachment placeholder', async () => {
    const attachmentId = `sha256:${'a'.repeat(64)}` as never
    harness = await makeBridgeHarness({
      script: [[
        { type: 'block-start', index: 0, blockType: 'image' },
        {
          type: 'block-end',
          index: 0,
          block: {
            type: 'image',
            attachment: {
              attachmentId,
              mediaType: 'image/png',
              bytes: 1,
              width: 1,
              height: 1,
            },
          },
        },
        { type: 'finish', reason: { kind: 'stop' } },
      ]],
    })
    const sessionId = await newSession(harness)
    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'show it' }] })
    await vi.waitFor(() => {
      expect(messageText(harness!)).toBe(`[image attachment ${String(attachmentId)}]`)
    })
  })

  it('rejects a failed turn and never publishes its partial chunks', async () => {
    harness = await makeBridgeHarness({ script: [errorResponse('provider boom')] })
    const sessionId = await newSession(harness)
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .rejects.toThrow(/turn failed: provider boom/)
    expect(messageText(harness)).toBe('')
  })

  it('rejects an ordinary plugin failure through the same prompt boundary', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('must not run')] })
    harness.ctx.on('agent/pre-step', () => { throw new Error('plugin pre-step failed') })
    const sessionId = await newSession(harness)
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .rejects.toThrow(/turn failed: plugin pre-step failed/)
  })

  it('rejects a turn-start failure before the prompt is claimed', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('must not run')] })
    const sessionId = await newSession(harness)
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    const append = agent.session.append.bind(agent.session)
    vi.spyOn(agent.session, 'append').mockImplementation(((type: string, ...rest: never[]) => {
      if (type === 'turn/start') throw new Error('turn start unavailable')
      return (append as (...args: never[]) => unknown)(type as never, ...rest)
    }) as never)

    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .rejects.toThrow(/turn failed: turn start unavailable/)
    vi.restoreAllMocks()
  })

  it('settles even when an earlier turn observer throws', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('answer')] })
    harness.ctx.on('session/event', (_session, event) => {
      if (event.type === 'turn/start' || event.type === 'turn/end') throw new Error('peer listener boom')
    }, { prepend: true })
    const sessionId = await newSession(harness)
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .resolves.toEqual({ stopReason: 'end_turn' })
  })

  it('correlates the owning prompt when a synchronous injection joins its first step', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('real answer')] })
    const sessionId = await newSession(harness)
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    let injected = false
    harness.ctx.on('agent/inbox/inserted', ({ agent: subject, message }) => {
      if (subject === agent && message.source.kind === 'user' && !injected) {
        injected = true
        agent.inject(createUserMessage({ content: [{ type: 'text', text: 'context' }], source: { kind: 'plugin', plugin: 'test' } }))
      }
    })

    const result = await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })
    expect(result.stopReason).toBe('end_turn')
    await vi.waitFor(() => { expect(messageText(harness!)).toBe('real answer') })
  })

  it('ignores an autonomous message turn while correlating the client turn', async () => {
    harness = await makeBridgeHarness({ script: ['hang'] })
    const sessionId = await newSession(harness)
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    let autonomousStarted!: () => void
    const started = new Promise<void>((resolve) => { autonomousStarted = resolve })
    harness.ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'assistant/chunk') autonomousStarted()
    })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'autonomous work' }],
      source: { kind: 'plugin', plugin: 'test' },
    }))
    await started

    let settled = false
    const prompt = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })
      .finally(() => { settled = true })
    await vi.waitFor(() => {
      expect(agent.session.events.filter(event => event.type === 'agent/inbox/spliced'
        && event.data.inserted.length > 0)).toHaveLength(2)
    })
    expect(settled).toBe(false)
    await harness.client.cancel({ sessionId })
    await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
  })

  it('correlates a prompt whose step history is replaced', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('rewritten answer')] })
    harness.ctx.on('agent/pre-step', async () => ({
      kind: 'enter',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'rewritten prompt' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }))
    const sessionId = await newSession(harness)

    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'original' }] }))
      .resolves.toEqual({ stopReason: 'end_turn' })
  })

  it('frees the prompt slot when the agent rejects the send synchronously', async () => {
    harness = await makeBridgeHarness({ script: [] })
    const sessionId = await newSession(harness)
    // Reload the loop out from under the bridge: its agents dispose while the
    // bridge record survives, so the next send() throws synchronously.
    await harness.loopFiber.dispose()
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'one' }] }))
      .rejects.toThrow(/prompt was not queued/)
    // The failed prompt must not wedge the session's single prompt slot.
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'two' }] }))
      .rejects.toThrow(/prompt was not queued/)
  })

  it('permits only one in-flight prompt per session', async () => {
    harness = await makeBridgeHarness({ script: ['hang'] })
    const sessionId = await newSession(harness)
    const first = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'one' }] })
    await vi.waitFor(() => { expect(harness!.ctx.agents.get(SessionId(sessionId))?.status).toBe('running') })
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'two' }] }))
      .rejects.toThrow(/already in flight/)
    await harness.client.cancel({ sessionId })
    await expect(first).resolves.toEqual({ stopReason: 'cancelled' })
  })

  it('cancels a running turn and records the aborted outcome', async () => {
    harness = await makeBridgeHarness({ script: ['hang'] })
    const sessionId = await newSession(harness)
    const prompt = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    await vi.waitFor(() => { expect(agent.status).toBe('running') })
    await harness.client.cancel({ sessionId })
    await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
    await agent.whenIdle()
    expect(agent.session.events.findLast(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })
  })

  it('settles a hook-cancelled turn as end_turn, not cancelled', async () => {
    harness = await makeBridgeHarness({ script: ['hang'] })
    const sessionId = await newSession(harness)
    const prompt = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    await vi.waitFor(() => { expect(agent.status).toBe('running') })
    // A hook or another owner cancels the agent: the ACP client never called
    // session/cancel, so this is ordinary quiescence and reports end_turn.
    agent.cancel({ kind: 'hook', reason: 'owner intervention' })
    await expect(prompt).resolves.toEqual({ stopReason: 'end_turn' })
  })

  it('cancels autonomous running work without an in-flight prompt', async () => {
    harness = await makeBridgeHarness({ script: ['hang'] })
    const sessionId = await newSession(harness)
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'autonomous work' }],
      source: { kind: 'plugin', plugin: 'test' },
    }))
    await vi.waitFor(() => {
      expect(agent.session.events.some(event => event.type === 'turn/start')).toBe(true)
    })

    await harness.client.cancel({ sessionId })
    await agent.whenIdle()

    expect(agent.session.events.findLast(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })
  })

  it('an idle cancel does not affect the following prompt', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('answer')] })
    const sessionId = await newSession(harness)
    await harness.client.cancel({ sessionId })
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .resolves.toEqual({ stopReason: 'end_turn' })
    await vi.waitFor(() => { expect(messageText(harness!)).toBe('answer') })
  })

  it('a late end from a cancelled turn cannot settle the next prompt', async () => {
    harness = await makeBridgeHarness({ script: ['hang', textResponse('next')] })
    const sessionId = await newSession(harness)
    const first = harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'one' }] })
    await vi.waitFor(() => { expect(harness!.ctx.agents.get(SessionId(sessionId))?.status).toBe('running') })
    await harness.client.cancel({ sessionId })
    await expect(first).resolves.toEqual({ stopReason: 'cancelled' })

    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'two' }] }))
      .resolves.toEqual({ stopReason: 'end_turn' })
    await vi.waitFor(() => { expect(messageText(harness!)).toBe('next') })
  })

  it('a retry turn adopts the prompt instead of rejecting at the failed turn end', async () => {
    harness = await makeBridgeHarness({ script: [errorResponse('transient boom'), textResponse('recovered')] })
    // A recovery policy: schedule one retry for the failed request.
    let retried = false
    harness.ctx.on('agent/request-error', async () => {
      if (!retried) {
        retried = true
        return { kind: 'retry' }
      }
    })
    const sessionId = await newSession(harness)
    const result = await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })
    expect(result.stopReason).toBe('end_turn')
    await vi.waitFor(() => { expect(messageText(harness!)).toBe('recovered') })
  })

  it('a failed turn with no retry still rejects', async () => {
    harness = await makeBridgeHarness({ script: [errorResponse('terminal boom')] })
    let offered = 0
    harness.ctx.on('agent/request-error', async () => { offered += 1 })
    const sessionId = await newSession(harness)
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .rejects.toThrow(/turn failed: terminal boom/)
    expect(offered).toBe(1)
  })

  it('a pre-step-rejected prompt settles instead of hanging', async () => {
    harness = await makeBridgeHarness({ script: [] })
    harness.ctx.on('agent/pre-step', async () => ({
      kind: 'reject' as const,
    }))
    const sessionId = await newSession(harness)
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .resolves.toEqual({ stopReason: 'end_turn' })
    // The rejected prompt closed a blocked turn without streaming anything.
    expect(messageText(harness)).toBe('')
  })

  it('cancels a prompt removed before its turn claims it', async () => {
    harness = await makeBridgeHarness({ script: [] })
    const sessionId = await newSession(harness)
    const dispose = harness.ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (message.source.kind === 'user') agent.inbox.remove(message.id)
    })

    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .resolves.toEqual({ stopReason: 'cancelled' })
    dispose()
  })

  it('rejects a prompt when pre-step fails inside its open turn', async () => {
    harness = await makeBridgeHarness({ script: [] })
    harness.ctx.on('agent/pre-step', async () => { throw new Error('pre-step exploded') })
    const sessionId = await newSession(harness)

    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .rejects.toThrow(/turn failed: pre-step exploded/)
  })
})
