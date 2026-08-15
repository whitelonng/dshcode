/** Session message deletion: surface ranges, turn folding, and refusal codes. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import {
  CallId, createMessage, createToolResultMessage, createUserMessage, freezeMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`delete-${String(nextRpc++)}`), payload }
}

async function composed(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, { id: session.id, session, status: 'idle', ctx: agentCtx })
      await options.setup?.(agentCtx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('delete test sources are live')),
  })
  return ctx
}

interface BuiltTurn {
  userSeq: number
  assistantSeq: number
  toolResultSeq: number
  closingSeq: number
}

/**
 * Append one completed turn: user message, one assistant tool-call message,
 * its tool result, and a closing assistant answer.
 */
function appendTurn(session: Session, turn: number, text: string): BuiltTurn {
  session.append('turn/start', { turn })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const toolCallMessage = createMessage({
    role: 'assistant',
    content: [{ type: 'tool-call', id: CallId(`c-${turn}`), name: 'echo', arguments: '{}' }],
    source: { kind: 'model', ...{ provider: 'mock', model: 'mock' } },
  })
  const step = session.append('assistant/message', {
    turn, step: 1,
    message: freezeMessage(toolCallMessage),
  }, { surfaceOp: 'append' })
  const result = session.append('tool/result', {
    turn, step: 1,
    message: createToolResultMessage({
      callId: CallId(`c-${turn}`),
      content: [{ type: 'text', text: `result ${turn}` }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn, step: 2,
    message: freezeMessage(createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: `answer ${turn}` }],
      source: { kind: 'model', ...{ provider: 'mock', model: 'mock' } },
    })),
  }, { surfaceOp: 'append' })
  const closing = session.events.at(-1)!
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
  return { userSeq: user.seq, assistantSeq: step.seq, toolResultSeq: result.seq, closingSeq: closing.seq }
}

function liveSession(ctx: Context, id: string): Session {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session
}

const api = (ctx: Context) => createApiProxy(ctx, {
  defaultModelSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
  cwd: '/tmp',
})

describe('sessions.deleteMessage', () => {
  it('deletes a whole turn when targeting its user message', async () => {
    const ctx = await composed()
    const session = liveSession(ctx, 'delete-user')
    const first = appendTurn(session, 1, 'first')
    appendTurn(session, 2, 'second')
    expect(session.deriveMessages()).toHaveLength(8)

    const response = await api(ctx).sessions.deleteMessage(request({
      sessionId: session.id, seq: first.userSeq,
    }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(response.result.value.deletedSeqs).toEqual([
      first.userSeq, first.assistantSeq, first.toolResultSeq, first.closingSeq,
    ])
    // Turn 1's four surface nodes are gone; turn 2 remains.
    expect(session.deriveMessages()).toHaveLength(4)
    const deletion = session.events.at(-1)!
    expect(deletion.type).toBe('message/delete')
    await ctx.fiber.dispose()
  })

  it('deletes an assistant message plus its same-step tool results', async () => {
    const ctx = await composed()
    const session = liveSession(ctx, 'delete-assistant')
    const turn = appendTurn(session, 1, 'prompt')
    const response = await api(ctx).sessions.deleteMessage(request({
      sessionId: session.id, seq: turn.assistantSeq,
    }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    // The tool-call message and its result are removed; the user message and
    // the closing answer stay.
    expect(response.result.value.deletedSeqs).toEqual([turn.assistantSeq, turn.toolResultSeq])
    expect(session.deriveMessages().map(message => message.role)).toEqual(['user', 'assistant'])
    await ctx.fiber.dispose()
  })

  it('refuses with agent-busy while a turn is open', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const session = liveSession(ctx, 'delete-busy')
    const first = appendTurn(session, 1, 'done')
    session.append('turn/start', { turn: 2 })
    const open = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'running' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const response = await proxy.sessions.deleteMessage(request({
      sessionId: session.id, seq: first.userSeq,
    }))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('agent-busy')
    // The open turn's own message also refuses while running.
    const openResponse = await proxy.sessions.deleteMessage(request({
      sessionId: session.id, seq: open.seq,
    }))
    expect(openResponse.result.ok).toBe(false)
    if (openResponse.result.ok) return
    expect(openResponse.result.error.code).toBe('agent-busy')
    await ctx.fiber.dispose()
  })

  it('refuses with delete-unavailable for a non-message or shadowed seq', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const session = liveSession(ctx, 'delete-invalid')
    const turn = appendTurn(session, 1, 'prompt')
    const nonMessage = await proxy.sessions.deleteMessage(request({
      sessionId: session.id, seq: turn.toolResultSeq,
    }))
    expect(nonMessage.result.ok).toBe(false)
    if (nonMessage.result.ok) return
    expect(nonMessage.result.error.code).toBe('delete-unavailable')

    const unknown = await proxy.sessions.deleteMessage(request({
      sessionId: session.id, seq: 999,
    }))
    expect(unknown.result.ok).toBe(false)
    if (unknown.result.ok) return
    expect(unknown.result.error.code).toBe('delete-unavailable')
    await ctx.fiber.dispose()
  })

  it('records the deletion with fold metadata the surface accepts', async () => {
    const ctx = await composed()
    const proxy = api(ctx)
    const session = liveSession(ctx, 'delete-fold')
    const first = appendTurn(session, 1, 'first')
    const second = appendTurn(session, 2, 'second')
    const response = await proxy.sessions.deleteMessage(request({
      sessionId: session.id, seq: first.userSeq,
    }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    const deletion = session.events.at(-1)!
    expect(deletion.type).toBe('message/delete')
    const { start, end } = deletion.data as { start: number; end: number }
    expect(start).toBe(first.userSeq)
    expect(end).toBe(first.closingSeq)
    expect(session.surface.nodes).toEqual([
      second.userSeq, second.assistantSeq, second.toolResultSeq, second.closingSeq,
    ])
    await ctx.fiber.dispose()
  })
})
