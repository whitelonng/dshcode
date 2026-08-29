/** Strict replay fold for Agent Teams log-only events. */

import { z } from 'zod'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type {
  TeamId,
  TeamMemberSnapshot,
  TeamMessageId,
  TeamMessageSnapshot,
  TeamTaskId,
  TeamTaskSnapshot,
} from './types.ts'
import {
  TeamId as toTeamId,
  TeamMessageId as toTeamMessageId,
  TeamTaskId as toTeamTaskId,
} from './types.ts'
import { assertTaskGraphCandidate } from './task-graph.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveSafeInteger = nonNegativeSafeInteger.min(1)
const sessionIdSchema = z.string().min(1).transform(value => SessionId(value))
const teamIdSchema = z.string().min(1).transform(value => toTeamId(value))
const numericTaskIdPattern = /^task-(\d+)$/u
const teamTaskIdSchema = z.string().min(1).refine((value) => {
  const match = numericTaskIdPattern.exec(value)
  return match === null || Number.isSafeInteger(Number(match[1]))
}, { message: 'numeric task id suffix must be a safe integer' }).transform(value => toTeamTaskId(value))
const teamMessageIdSchema = z.string().min(1).transform(value => toTeamMessageId(value))

const coreContentBlockTypes = new Set(['text', 'reasoning', 'image', 'tool-call', 'tool-result'])
const imageAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: nonNegativeSafeInteger,
  width: positiveSafeInteger,
  height: positiveSafeInteger,
  name: z.string().optional(),
}).strict()

// ContentBlockMap is merge-extensible. Validate every core variant exactly,
// while retaining JSON-decoded plugin variants under an unknown type tag.
const contentBlockSchema: z.ZodType<ContentBlock> = z.lazy(() => z.union([
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({ type: z.literal('reasoning'), text: z.string() }).strict(),
  z.object({ type: z.literal('image'), attachment: imageAttachmentSchema }).strict(),
  z.object({
    type: z.literal('tool-call'),
    id: z.string().min(1),
    name: z.string(),
    arguments: z.string(),
  }).strict(),
  z.object({
    type: z.literal('tool-result'),
    toolCallId: z.string().min(1),
    content: z.array(contentBlockSchema),
    isError: z.boolean().optional(),
  }).strict(),
  z.object({ type: z.string().min(1) }).loose().refine(
    block => !coreContentBlockTypes.has(block.type),
    { message: 'known content block types must match their declared fields' },
  ),
])) as z.ZodType<ContentBlock>

const teamMemberSnapshotSchema = z.object({
  id: sessionIdSchema,
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  context: z.enum(['fresh', 'fork']),
  phase: z.enum(['provisioning', 'active', 'failed']),
  error: z.string().optional(),
}).strict() as z.ZodType<TeamMemberSnapshot>

const teamTaskSnapshotSchema = z.object({
  id: teamTaskIdSchema,
  revision: positiveSafeInteger,
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  ownerId: sessionIdSchema.optional(),
  blockedBy: z.array(teamTaskIdSchema),
  writeScopes: z.array(z.string()),
}).strict() as z.ZodType<TeamTaskSnapshot>

const teamMessageSnapshotSchema = z.object({
  id: teamMessageIdSchema,
  senderId: sessionIdSchema,
  senderName: z.string(),
  targetId: sessionIdSchema,
  delivery: z.enum(['quiet', 'wakeup']),
  content: z.array(contentBlockSchema),
}).strict() as z.ZodType<TeamMessageSnapshot>

const teamEventSelectorSchema = z.object({
  version: nonNegativeSafeInteger,
  teamId: teamIdSchema,
}).loose()

const teamMemberEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  member: teamMemberSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['team/member']>

const teamTaskEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  task: teamTaskSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['team/task']>

const teamMessageQueuedEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  message: teamMessageSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['team/message/queued']>

const teamMessageDeliveredEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  messageId: teamMessageIdSchema,
  targetId: sessionIdSchema,
}).strict() as z.ZodType<SessionEventMap['team/message/delivered']>

/** Mutable internal replay state. */
export interface TeamFoldState {
  readonly id: TeamId
  readonly members: Map<SessionId, TeamMemberSnapshot>
  readonly memberIdsByName: Map<string, SessionId>
  readonly tasks: Map<TeamTaskId, TeamTaskSnapshot>
  readonly messages: Map<TeamMessageId, TeamMessageSnapshot>
  readonly delivered: Set<TeamMessageId>
  nextTaskNumber: number
}

/**
 * Construct an empty Team fold for one root Session.
 * @param rootId - Session whose TeamId selects applicable records.
 * @returns mutable empty replay state.
 */
export function emptyTeamFoldState(rootId: SessionId): TeamFoldState {
  return {
    id: toTeamId(rootId),
    members: new Map(),
    memberIdsByName: new Map(),
    tasks: new Map(),
    messages: new Map(),
    delivered: new Set(),
    nextTaskNumber: 1,
  }
}

/** Whether one event belongs to the Team domain. */
export type TeamEventType =
  | 'team/member'
  | 'team/task'
  | 'team/message/queued'
  | 'team/message/delivered'

/** One event owned by the Team domain. */
export type TeamSessionEvent = SessionEvent<TeamEventType>

/**
 * Test whether a Session event belongs to the Team domain.
 * @param event - candidate Session event.
 * @returns whether the event has a Team-owned type.
 */
export function isTeamEvent(event: SessionEvent): event is TeamSessionEvent {
  return event.type === 'team/member'
    || event.type === 'team/task'
    || event.type === 'team/message/queued'
    || event.type === 'team/message/delivered'
}

/** Decode one persisted Team value and retain the schema failure as its cause. */
function parsePersisted<T>(type: TeamEventType, schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value)
  } catch (error: unknown) {
    throw new Error(`persisted Agent Teams ${type} payload is invalid`, { cause: error })
  }
}

/** Decode the complete current-version payload selected by one Team event type. */
function parseCurrentTeamEvent(event: TeamSessionEvent): TeamSessionEvent {
  switch (event.type) {
    case 'team/member':
      return { ...event, data: parsePersisted(event.type, teamMemberEventSchema, event.data) }
    case 'team/task':
      return { ...event, data: parsePersisted(event.type, teamTaskEventSchema, event.data) }
    case 'team/message/queued':
      return { ...event, data: parsePersisted(event.type, teamMessageQueuedEventSchema, event.data) }
    case 'team/message/delivered':
      return { ...event, data: parsePersisted(event.type, teamMessageDeliveredEventSchema, event.data) }
    /* v8 ignore next 2 -- TeamEventType is closed and every member is handled above. */
    default:
      return event
  }
}

/**
 * Apply one event, ignoring Team records inherited by a different root fork.
 * @param state - mutable Team replay state.
 * @param event - next contiguous Session event.
 */
export function applyTeamEvent(state: TeamFoldState, event: SessionEvent): void {
  if (!isTeamEvent(event)) return
  const selector = parsePersisted(event.type, teamEventSelectorSchema, event.data)
  if (selector.version !== 1) {
    if (selector.teamId !== state.id) return
    throw new Error(`unsupported Agent Teams event version ${String(selector.version)}`)
  }
  const decoded = parseCurrentTeamEvent(event)
  if (decoded.data.teamId !== state.id) return

  switch (decoded.type) {
    case 'team/member': {
      const member = decoded.data.member
      const prior = state.members.get(member.id)
      const named = state.memberIdsByName.get(member.name)
      if (named !== undefined && named !== member.id) {
        throw new Error(`teammate name "${member.name}" is reused by another member`)
      }
      if (prior === undefined) {
        if (member.phase !== 'provisioning') throw new Error(`teammate "${member.name}" must begin provisioning`)
        state.memberIdsByName.set(member.name, member.id)
      } else {
        if (prior.name !== member.name || prior.provider !== member.provider || prior.context !== member.context) {
          throw new Error(`teammate "${member.id}" changed immutable identity fields`)
        }
        if (prior.phase !== 'provisioning' || member.phase === 'provisioning') {
          throw new Error(`teammate "${member.name}" has an invalid ${prior.phase} -> ${member.phase} transition`)
        }
      }
      state.members.set(member.id, member)
      break
    }
    case 'team/task': {
      const task = decoded.data.task
      const prior = state.tasks.get(task.id)
      if (prior === undefined && task.revision !== 1) {
        throw new Error(`team task "${task.id}" must begin at revision 1`)
      }
      if (prior !== undefined && task.revision !== prior.revision + 1) {
        throw new Error(`team task "${task.id}" revision is not contiguous`)
      }
      assertTaskGraphCandidate(state.tasks, task)
      const match = numericTaskIdPattern.exec(task.id)
      if (match !== null) {
        const number = Number(match[1])
        state.nextTaskNumber = Math.max(
          state.nextTaskNumber,
          number === Number.MAX_SAFE_INTEGER ? number : number + 1,
        )
      }
      state.tasks.set(task.id, task)
      break
    }
    case 'team/message/queued': {
      const message = decoded.data.message
      if (state.messages.has(message.id)) throw new Error(`team message "${message.id}" was queued twice`)
      state.messages.set(message.id, message)
      break
    }
    case 'team/message/delivered': {
      const queued = state.messages.get(decoded.data.messageId)
      if (queued === undefined) throw new Error(`team message "${decoded.data.messageId}" was delivered before queueing`)
      if (queued.targetId !== decoded.data.targetId) throw new Error(`team message "${decoded.data.messageId}" target changed`)
      if (state.delivered.has(decoded.data.messageId)) throw new Error(`team message "${decoded.data.messageId}" was delivered twice`)
      state.delivered.add(decoded.data.messageId)
      break
    }
    /* v8 ignore next 2 -- TeamEventType is closed and every member is handled above. */
    default:
      return
  }
}

/**
 * Replay one root Session into its current Team state.
 * @param rootId - root Session identity selecting Team-owned records.
 * @param events - complete contiguous Session log.
 * @returns mutable replay state at the end of the log.
 */
export function foldTeam(rootId: SessionId, events: readonly SessionEvent[]): TeamFoldState {
  const state = emptyTeamFoldState(rootId)
  for (const event of events) applyTeamEvent(state, event)
  return state
}
