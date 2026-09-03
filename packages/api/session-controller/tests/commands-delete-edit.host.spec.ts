import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, FollowupReplace } from '@deepseek-ai/dsh-agent'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  createMessage, createToolResultMessage, createUserMessage, ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices } from './test-remote.ts'

const imageRef: ImageAttachmentRef = {
  attachmentId: AttachmentId('att-edit'),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}

function assistantData(turn: number, step: number, text: string) {
  return {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', ...{ provider: 'mock', model: 'mock' } },
    }),
  }
}

function toolResultData(turn: number, step: number, callId: string) {
  return {
    turn,
    step,
    message: createToolResultMessage({
      callId: ToolCallId(callId),
      content: [{ type: 'text', text: `result ${callId}` }],
      isError: false,
    }),
  }
}

function userMessage(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/**
 * Two completed turns of user, assistant, and tool-result surface nodes:
 * turn 1 answers "first" across two steps, turn 2 answers "second" in one.
 * Surface nodes land on seqs [1, 2, 3, 4, 7, 8].
 */
function transcript(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', userMessage('first'), { surfaceOp: 'append' })
  session.append('assistant/message', assistantData(1, 1, 'answer one'), { surfaceOp: 'append' })
  session.append('tool/result', toolResultData(1, 1, 'c1'), { surfaceOp: 'append' })
  session.append('tool/result', toolResultData(1, 2, 'c2'), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('user/message', userMessage('second'), { surfaceOp: 'append' })
  session.append('assistant/message', assistantData(2, 1, 'answer two'), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
}

type FollowupSpy = ReturnType<typeof vi.fn<(message: UserMessage, replace?: FollowupReplace) => void>>
type SaveImagesSpy = ReturnType<typeof vi.fn<(inputs: unknown) => Promise<readonly [ImageAttachmentRef]>>>

async function commandHarness(id = 'transcript-session'): Promise<{
  ctx: Context
  controller: SessionCommandController
  session: Session
  followup: FollowupSpy
  saveImages: SaveImagesSpy
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd: '/workspace' } })
  return { ctx, session, ...attachAgent(ctx, session) }
}

function attachAgent(
  ctx: Context,
  session: Session,
): { controller: SessionCommandController; followup: FollowupSpy; saveImages: SaveImagesSpy } {
  const followup: FollowupSpy = vi.fn()
  const agent = { id: session.id, session, status: 'idle', ctx, followup } as unknown as Agent
  ctx.agents.register(agent)
  const saveImages: SaveImagesSpy = vi.fn(() => Promise.resolve([imageRef]))
  ctx.provide('attachments', { saveImages } as never)
  const agents = {
    resolveAgent: (requested: SessionId) => requested === session.id
      ? Promise.resolve({ agent })
      : Promise.resolve({
        error: new RemoteError('session/not-found', `session "${requested}" not found`, { sessionId: requested }),
      }),
    serializeImageAdmission: <Value>(_agent: Agent, operation: () => Promise<Value>) => operation(),
  } as unknown as ApiSessionAgentController
  return { controller: new SessionCommandController(ctx, agents, '/workspace'), followup, saveImages }
}

async function expectFailure(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code })
}

describe('Session deleteMessage', () => {
  it('deletes a whole completed turn from its turn/end anchor', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)

    await expect(controller.deleteMessage({ sessionId: session.id, seq: 9 })).resolves.toEqual({
      start: 7,
      end: 8,
      deletedSeqs: [7, 8],
    })
    expect(session.surface.nodes).toEqual([1, 2, 3, 4])
    await ctx.fiber.dispose()
  })

  it('refuses a stopped turn that left nothing on the surface', async () => {
    const { ctx, controller, session } = await commandHarness('interrupted-session')
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await expect(controller.deleteMessage({ sessionId: session.id, seq: 1 })).rejects.toMatchObject({
      code: 'session/delete-unavailable',
      message: 'turn 1 left nothing on the surface to delete',
      details: { sessionId: session.id, seq: 1 },
    })
    await ctx.fiber.dispose()
  })

  it('expands a user message delete to the rest of its turn', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)

    await expect(controller.deleteMessage({ sessionId: session.id, seq: 1 })).resolves.toEqual({
      start: 1,
      end: 4,
      deletedSeqs: [1, 2, 3, 4],
    })
    expect(session.surface.nodes).toEqual([7, 8])
    await ctx.fiber.dispose()
  })

  it('expands a last user message delete to the surface tail', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)

    await expect(controller.deleteMessage({ sessionId: session.id, seq: 7 })).resolves.toEqual({
      start: 7,
      end: 8,
      deletedSeqs: [7, 8],
    })
    expect(session.surface.nodes).toEqual([1, 2, 3, 4])
    await ctx.fiber.dispose()
  })

  it('deletes an assistant message together with its own step results', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)

    await expect(controller.deleteMessage({ sessionId: session.id, seq: 2 })).resolves.toEqual({
      start: 2,
      end: 3,
      deletedSeqs: [2, 3],
    })
    expect(session.surface.nodes).toEqual([1, 4, 7, 8])

    await expect(controller.deleteMessage({ sessionId: session.id, seq: 8 })).resolves.toEqual({
      start: 8,
      end: 8,
      deletedSeqs: [8],
    })
    expect(session.surface.nodes).toEqual([1, 4, 7])
    await ctx.fiber.dispose()
  })

  it('keeps a bare assistant message single-node when unrelated nodes follow it', async () => {
    const { ctx, controller, session } = await commandHarness('assistant-tail-session')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', userMessage('a'), { surfaceOp: 'append' })
    session.append('assistant/message', assistantData(1, 1, 'bare answer'), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', userMessage('b'), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

    await expect(controller.deleteMessage({ sessionId: session.id, seq: 2 })).resolves.toEqual({
      start: 2,
      end: 2,
      deletedSeqs: [2],
    })
    expect(session.surface.nodes).toEqual([1, 5])
    await ctx.fiber.dispose()
  })

  it('refuses a malformed seq, an unknown session, and non-deletable targets', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)

    await expectFailure(controller.deleteMessage({ sessionId: session.id, seq: -1 }), 'gateway/bad-request')
    await expectFailure(controller.deleteMessage({
      sessionId: SessionId('never-created'), seq: 0,
    }), 'session/not-found')
    await expectFailure(controller.deleteMessage({ sessionId: session.id, seq: 0 }), 'session/delete-unavailable')
    await expectFailure(controller.deleteMessage({ sessionId: session.id, seq: 99 }), 'session/delete-unavailable')
    await ctx.fiber.dispose()
  })

  it('refuses a turn/end anchor whose turn/start is missing from the log', async () => {
    const { ctx, controller, session } = await commandHarness('orphan-end-session')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', userMessage('only'), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // A log can carry a turn/end without its start only through direct
    // writes; the host refuses the anchor instead of guessing the range.
    session.append('turn/end', { turn: 9, reason: { kind: 'completed' } })

    await expect(controller.deleteMessage({ sessionId: session.id, seq: 3 })).rejects.toThrow(
      'no turn/start precedes the turn/end at 3',
    )
    await ctx.fiber.dispose()
  })

  it('refuses a message already shadowed by an earlier delete', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)
    await expect(controller.deleteMessage({ sessionId: session.id, seq: 1 })).resolves.toMatchObject({ start: 1 })

    const refusal = controller.deleteMessage({ sessionId: session.id, seq: 2 })
    await expect(refusal).rejects.toMatchObject({ code: 'session/delete-unavailable' })
    await expect(refusal).rejects.toThrow('already shadowed by compaction or an earlier edit')
    await ctx.fiber.dispose()
  })

  it('refuses transcript surgery while the last turn is open', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)
    session.append('turn/start', { turn: 3 })

    await expect(controller.deleteMessage({ sessionId: session.id, seq: 2 })).rejects.toMatchObject({
      code: 'session/agent-busy',
      details: { reason: 'turn-open' },
    })
    await ctx.fiber.dispose()
  })

  it('maps a log rejection to an internal failure', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)
    vi.spyOn(session, 'append').mockImplementationOnce(() => {
      throw new Error('log sealed')
    })

    await expect(controller.deleteMessage({ sessionId: session.id, seq: 2 })).rejects.toMatchObject({
      code: 'gateway/internal',
      message: 'failed to delete message at event 2: Error: log sealed',
    })
    await ctx.fiber.dispose()
  })
})

describe('Session editMessage', () => {
  it('rewrites the last user message and regenerates its turn', async () => {
    const { ctx, controller, session, followup } = await commandHarness()
    transcript(session)

    await expect(controller.editMessage({
      sessionId: session.id,
      seq: 7,
      content: [{ type: 'text', text: 'revised' }],
      clientTimeZone: 'UTC',
    })).resolves.toEqual({ accepted: true })
    const [zoned, zonedPlan] = followup.mock.calls[0] ?? []
    expect(zoned).toMatchObject({
      content: [{ type: 'text', text: 'revised' }],
      source: { kind: 'user', clientTimeZone: 'UTC' },
    })
    expect(zonedPlan).toEqual({ start: 7, end: 8, sourceEventSeqs: [7, 8] })

    await expect(controller.editMessage({
      sessionId: session.id,
      seq: 7,
      content: [{ type: 'text', text: 'again' }],
    })).resolves.toEqual({ accepted: true })
    const second = followup.mock.calls[1]
    if (second === undefined) throw new Error('second edit was not delivered')
    const [plain, plainPlan] = second
    expect(plain).toMatchObject({ source: { kind: 'user' } })
    expect(plain.source).not.toHaveProperty('clientTimeZone')
    expect(plainPlan).toEqual({ start: 7, end: 8, sourceEventSeqs: [7, 8] })
    await ctx.fiber.dispose()
  })

  it('admits image edits through the serialized image chain', async () => {
    const { ctx, controller, session, followup, saveImages } = await commandHarness()
    transcript(session)

    await expect(controller.editMessage({
      sessionId: session.id,
      seq: 7,
      content: [{ type: 'image', mediaType: 'image/png', data: 'AA==' }],
    })).resolves.toEqual({ accepted: true })
    expect(saveImages).toHaveBeenCalledOnce()
    const delivered = followup.mock.calls[0]
    if (delivered === undefined) throw new Error('edited message was not delivered')
    const [message] = delivered
    expect(message.content).toEqual([{ type: 'image', attachment: imageRef }])
    await ctx.fiber.dispose()
  })

  it('rejects a malformed seq and an invalid client time zone before resuming', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)

    await expectFailure(controller.editMessage({
      sessionId: session.id, seq: 1.5, content: [{ type: 'text', text: 'x' }],
    }), 'gateway/bad-request')
    await expectFailure(controller.editMessage({
      sessionId: session.id, seq: 7, content: [{ type: 'text', text: 'x' }], clientTimeZone: 'Mars/Olympus',
    }), 'session/invalid-time-zone')
    await ctx.fiber.dispose()
  })

  it('refuses targets that are not user-authored messages', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'injected' }],
      source: { kind: 'plugin', plugin: 'fixture', form: 'relay' },
    }), { surfaceOp: 'append' })

    await expectFailure(controller.editMessage({
      sessionId: session.id, seq: 8, content: [{ type: 'text', text: 'x' }],
    }), 'session/edit-unavailable')
    await expectFailure(controller.editMessage({
      sessionId: session.id, seq: 99, content: [{ type: 'text', text: 'x' }],
    }), 'session/edit-unavailable')
    await expectFailure(controller.editMessage({
      sessionId: session.id, seq: 10, content: [{ type: 'text', text: 'x' }],
    }), 'session/edit-unavailable')
    await ctx.fiber.dispose()
  })

  it('refuses an edit to a user message that is not the last one', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)

    await expect(controller.editMessage({
      sessionId: session.id, seq: 1, content: [{ type: 'text', text: 'x' }],
    })).rejects.toMatchObject({
      code: 'session/edit-unavailable',
      message: 'only the last user message of a conversation can be edited',
    })
    await ctx.fiber.dispose()
  })

  it('refuses an edit whose target user message no longer sits on the surface', async () => {
    const { ctx, controller, session } = await commandHarness('shadowed-edit-session')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', userMessage('only'), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('message/delete', { start: SessionSeq(1), end: SessionSeq(1) }, {
      surfaceOp: { op: 'delete', start: SessionSeq(1), end: SessionSeq(1) },
      sourceEventSeqs: [SessionSeq(1)],
    })

    await expect(controller.editMessage({
      sessionId: session.id, seq: 1, content: [{ type: 'text', text: 'x' }],
    })).rejects.toMatchObject({ code: 'session/edit-unavailable' })
    await ctx.fiber.dispose()
  })

  it('refuses an edit while the last turn is open', async () => {
    const { ctx, controller, session } = await commandHarness()
    transcript(session)
    session.append('turn/start', { turn: 3 })

    await expectFailure(controller.editMessage({
      sessionId: session.id, seq: 7, content: [{ type: 'text', text: 'x' }],
    }), 'session/agent-busy')
    await ctx.fiber.dispose()
  })

  it('maps attachment refusal, busy agents, and Remote failures from the regenerated turn', async () => {
    const refusing = await commandHarness()
    transcript(refusing.session)
    refusing.saveImages.mockRejectedValue(new AttachmentError('Image batch refused.', 'TOO_MANY_IMAGES'))
    await expect(refusing.controller.editMessage({
      sessionId: refusing.session.id,
      seq: 7,
      content: [{ type: 'image', mediaType: 'image/png', data: 'AA==' }],
    })).rejects.toMatchObject({
      code: 'session/attachment-invalid',
      details: { reason: 'TOO_MANY_IMAGES' },
    })
    await refusing.ctx.fiber.dispose()

    const busy = await commandHarness()
    transcript(busy.session)
    busy.followup.mockImplementation(() => {
      throw new Error('agent "transcript-session" lifecycle disposed')
    })
    await expect(busy.controller.editMessage({
      sessionId: busy.session.id, seq: 7, content: [{ type: 'text', text: 'x' }],
    })).rejects.toMatchObject({
      code: 'session/agent-busy',
      message: 'edit rejected',
      details: { reason: 'Error: agent "transcript-session" lifecycle disposed' },
    })
    await busy.ctx.fiber.dispose()

    const remote = await commandHarness()
    transcript(remote.session)
    const remoteFailure = new RemoteError('session/model-unavailable', 'no adapter serves provider', {
      provider: 'fixture',
      model: 'fixture-model',
    })
    remote.followup.mockImplementation(() => {
      throw remoteFailure
    })
    await expect(remote.controller.editMessage({
      sessionId: remote.session.id, seq: 7, content: [{ type: 'text', text: 'x' }],
    })).rejects.toBe(remoteFailure)
    await remote.ctx.fiber.dispose()
  })
})
