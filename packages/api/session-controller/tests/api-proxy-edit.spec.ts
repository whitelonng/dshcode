/** Session message editing: range expansion, refusal vocabulary, and follow-up wiring. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import {
  CallId, createMessage, createToolResultMessage, createUserMessage, freezeMessage, LlmRuntime,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`edit-${String(nextRpc++)}`), payload }
}

interface CapturedFollowup {
  message: UserMessage
  replace: { start: number; end: number; sourceEventSeqs: number[] } | undefined
}

async function composed(): Promise<{ ctx: Context; followups: CapturedFollowup[] }> {
  const ctx = new Context()
  const followups: CapturedFollowup[] = []
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  // The edit RPC routes through turnAgentFor, which requires the default
  // selection's provider to be served; the fake agent never generates.
  ctx.llm.registerAdapter(['default-provider'], {
    providerInfo: (provider: string) => ({ id: provider, name: provider }),
    providerRetryPolicy: () => undefined,
    listModels: async () => [],
  } as never)
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, {
        id: session.id,
        session,
        status: 'idle',
        ctx: agentCtx,
        followup: (message: UserMessage, replace?: { start: number; end: number; sourceEventSeqs: number[] }) => {
          followups.push({ message, replace })
        },
      })
      await options.setup?.(agentCtx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('edit test sources are live')),
  })
  return { ctx, followups }
}

interface BuiltTurn {
  userSeq: number
  assistantSeq: number
  toolResultSeq: number
  closingSeq: number
}

function appendTurn(session: Session, turn: number, text: string): BuiltTurn {
  session.append('turn/start', { turn })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  const step = session.append('assistant/message', {
    turn, step: 1,
    message: freezeMessage(createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: CallId(`c-${turn}`), name: 'echo', arguments: '{}' }],
      source: { kind: 'model', ...{ provider: 'mock', model: 'mock' } },
    })),
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

function liveSession(ctx: Context, id: string, followups?: CapturedFollowup[]): Session {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  ctx.agents.register({
    id: session.id,
    session,
    status: 'idle',
    ctx,
    followup: (message: UserMessage, replace?: { start: number; end: number; sourceEventSeqs: number[] }) => {
      followups?.push({ message, replace })
    },
  } as Agent)
  return session
}

const api = (ctx: Context) => createApiProxy(ctx, {
  defaultModelSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
  cwd: '/tmp',
})

const text = (value: string) => [{ type: 'text' as const, text: value }]

describe('sessions.editMessage', () => {
  it('drives a follow-up whose replace shadows the whole old turn', async () => {
    const { ctx, followups } = await composed()
    const proxy = api(ctx)
    const session = liveSession(ctx, 'edit-whole-turn', followups)
    const first = appendTurn(session, 1, 'original')

    const response = await proxy.sessions.editMessage(request({
      sessionId: session.id, seq: first.userSeq, content: text('edited'),
    }))
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(followups).toHaveLength(1)
    expect(followups[0]?.message.content).toEqual(text('edited'))
    expect(followups[0]?.replace).toEqual({
      start: first.userSeq,
      end: first.closingSeq,
      sourceEventSeqs: [first.userSeq, first.assistantSeq, first.toolResultSeq, first.closingSeq],
    })
    await ctx.fiber.dispose()
  })

  it('refuses with edit-unavailable for a non-last or non-human message', async () => {
    const { ctx } = await composed()
    const proxy = api(ctx)
    const session = liveSession(ctx, 'edit-invalid')
    const first = appendTurn(session, 1, 'original')
    appendTurn(session, 2, 'later')

    const nonLast = await proxy.sessions.editMessage(request({
      sessionId: session.id, seq: first.userSeq, content: text('edited'),
    }))
    // first.userSeq is NOT the last user message (turn 2's is), so it refuses.
    expect(nonLast.result.ok).toBe(false)
    if (nonLast.result.ok) return
    expect(nonLast.result.error.code).toBe('edit-unavailable')

    const nonHuman = await proxy.sessions.editMessage(request({
      sessionId: session.id, seq: first.toolResultSeq, content: text('edited'),
    }))
    expect(nonHuman.result.ok).toBe(false)
    if (nonHuman.result.ok) return
    expect(nonHuman.result.error.code).toBe('edit-unavailable')
    await ctx.fiber.dispose()
  })

  it('refuses with agent-busy while a turn is open', async () => {
    const { ctx } = await composed()
    const proxy = api(ctx)
    const session = liveSession(ctx, 'edit-busy')
    appendTurn(session, 1, 'done')
    session.append('turn/start', { turn: 2 })
    const open = session.append('user/message', createUserMessage({
      content: text('running'),
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const response = await proxy.sessions.editMessage(request({
      sessionId: session.id, seq: open.seq, content: text('edited'),
    }))
    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('agent-busy')
    await ctx.fiber.dispose()
  })
})
