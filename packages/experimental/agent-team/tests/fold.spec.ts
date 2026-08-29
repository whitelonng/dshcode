import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import {
  applyTeamEvent,
  emptyTeamFoldState,
  foldTeam,
  isTeamEvent,
} from '../src/fold.ts'
import type { TeamFoldState } from '../src/fold.ts'
import { TeamId, TeamMessageId, TeamTaskId } from '../src/types.ts'
import type { TeamMemberSnapshot, TeamMessageSnapshot, TeamTaskSnapshot } from '../src/types.ts'

const ROOT = SessionId('team-root')
const TEAM = TeamId(ROOT)
const CHILD = SessionId('child-a')

function event<T extends SessionEventType>(type: T, data: SessionEventMap[T], seq: number): SessionEvent<T> {
  return { type, data, seq, time: seq } as SessionEvent<T>
}

/** Queued-minus-delivered mail, the recovery mailbox the fold is responsible for. */
function pending(state: TeamFoldState): TeamMessageSnapshot[] {
  return [...state.messages.values()].filter(message => !state.delivered.has(message.id))
}

/** Whether one fold reached the end of its log without applying any Team record. */
function isEmptyFold(state: TeamFoldState): boolean {
  return state.members.size === 0 && state.tasks.size === 0
    && state.messages.size === 0 && state.delivered.size === 0
}

function member(overrides: Partial<TeamMemberSnapshot> = {}): TeamMemberSnapshot {
  return {
    id: CHILD,
    name: 'worker-a',
    description: 'worker',
    provider: 'spawn',
    context: 'fresh',
    phase: 'provisioning',
    ...overrides,
  }
}

function task(overrides: Partial<TeamTaskSnapshot> = {}): TeamTaskSnapshot {
  return {
    id: TeamTaskId('task-1'),
    revision: 1,
    subject: 'subject',
    description: 'description',
    status: 'pending',
    blockedBy: [],
    writeScopes: [],
    ...overrides,
  }
}

function message(overrides: Partial<TeamMessageSnapshot> = {}): TeamMessageSnapshot {
  return {
    id: TeamMessageId('message-1'),
    senderId: ROOT,
    senderName: 'lead',
    targetId: CHILD,
    delivery: 'quiet',
    content: [{ type: 'text', text: 'hello' }],
    ...overrides,
  }
}

describe('Agent Teams fold', () => {
  it('folds current-team records and ignores inherited records', () => {
    const records: SessionEvent[] = [
      event('team/member', { version: 1, teamId: TeamId('ancestor'), member: member() }, 0),
      event('team/member', { version: 1, teamId: TEAM, member: member() }, 1),
      event('team/member', {
        version: 1,
        teamId: TEAM,
        member: member({ phase: 'active' }),
      }, 2),
      event('team/task', { version: 1, teamId: TEAM, task: task({ id: TeamTaskId('task-7') }) }, 3),
      event('team/message/queued', { version: 1, teamId: TEAM, message: message() }, 4),
    ]
    const state = foldTeam(ROOT, records)

    expect(state).toMatchObject({ id: TEAM })
    expect(state.members.size).toBe(1)
    expect(state.tasks.size).toBe(1)
    expect(pending(state)).toHaveLength(1)
    expect(state.nextTaskNumber).toBe(8)
    expect(state.members.get(CHILD)?.name).toBe('worker-a')
    expect(isTeamEvent(records[0]!)).toBe(true)
    expect(isTeamEvent(event('turn/start', { turn: 1 }, 5))).toBe(false)
  })

  it('enforces teammate identity and lifecycle', () => {
    const base = event('team/member', { version: 1, teamId: TEAM, member: member() }, 0)
    expect(() => foldTeam(ROOT, [event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ phase: 'active' }),
    }, 0)])).toThrow(/must begin provisioning/)
    expect(() => foldTeam(ROOT, [base, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ name: 'renamed', phase: 'active' }),
    }, 1)])).toThrow(/immutable identity/)
    expect(() => foldTeam(ROOT, [base, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ phase: 'active' }),
    }, 1), event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ phase: 'failed' }),
    }, 2)])).toThrow(/invalid active -> failed/)

    const duplicateName = member({ id: SessionId('child-b') })
    expect(() => foldTeam(ROOT, [base, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: duplicateName,
    }, 1)])).toThrow(/name .* reused/)
  })

  it('enforces task revision continuity', () => {
    const first = event('team/task', { version: 1, teamId: TEAM, task: task() }, 0)
    expect(() => foldTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 2 }),
    }, 0)])).toThrow(/begin at revision 1/)
    expect(() => foldTeam(ROOT, [first, event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 3 }),
    }, 1)])).toThrow(/revision is not contiguous/)
  })

  it('rejects every invalid persisted task dependency relation', () => {
    const first = event('team/task', { version: 1, teamId: TEAM, task: task() }, 0)
    const second = event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({
        id: TeamTaskId('task-2'),
        blockedBy: [TeamTaskId('task-1')],
      }),
    }, 1)
    const invalid: Array<{ records: SessionEvent[]; message: RegExp }> = [
      {
        records: [event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ blockedBy: [TeamTaskId('missing')] }),
        }, 0)],
        message: /blocker task "missing" .* is missing or deleted/,
      },
      {
        records: [event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ blockedBy: [TeamTaskId('task-1')] }),
        }, 0)],
        message: /cannot block itself/,
      },
      {
        records: [first, event('team/task', {
          ...second.data,
          task: { ...second.data.task, blockedBy: [TeamTaskId('task-1'), TeamTaskId('task-1')] },
        }, 1)],
        message: /repeats blocker/,
      },
      {
        records: [first, second, event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ revision: 2, blockedBy: [TeamTaskId('task-2')] }),
        }, 2)],
        message: /dependency cycle/,
      },
      {
        records: [first, second, event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ revision: 2, status: 'deleted' }),
        }, 2)],
        message: /blocker task "task-1" .* is missing or deleted/,
      },
    ]

    for (const { records, message: expected } of invalid) {
      expect(() => foldTeam(ROOT, records)).toThrow(expected)
    }
  })

  it('leaves numeric allocation unchanged for a branded nonstandard task id', () => {
    const state = foldTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ id: TeamTaskId('external-task') }),
    }, 0)])
    expect(state.nextTaskNumber).toBe(1)
  })

  it('rejects a persisted numeric task id outside the safe integer range', () => {
    expect(() => foldTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ id: TeamTaskId('task-9007199254740992') }),
    }, 0)])).toThrow(/persisted Agent Teams team\/task payload is invalid/)
  })

  it('enforces mailbox queue and acknowledgement relations', () => {
    const queued = event('team/message/queued', { version: 1, teamId: TEAM, message: message() }, 0)
    const delivered = event('team/message/delivered', {
      version: 1,
      teamId: TEAM,
      messageId: TeamMessageId('message-1'),
      targetId: CHILD,
    }, 1)
    expect(pending(foldTeam(ROOT, [queued, delivered]))).toEqual([])
    expect(() => foldTeam(ROOT, [queued, queued])).toThrow(/queued twice/)
    expect(() => foldTeam(ROOT, [delivered])).toThrow(/delivered before queueing/)
    expect(() => foldTeam(ROOT, [queued, event('team/message/delivered', {
      ...delivered.data,
      targetId: SessionId('other'),
    }, 1)])).toThrow(/target changed/)
    expect(() => foldTeam(ROOT, [queued, delivered, { ...delivered, seq: 2 }])).toThrow(/delivered twice/)
  })

  it('validates every current-version persisted payload before folding it', () => {
    const malformed = [
      {
        ...event('team/member', { version: 1, teamId: TEAM, member: member() }, 0),
        data: { version: 1, teamId: TEAM, member: { ...member(), name: 42 } },
      },
      {
        ...event('team/task', { version: 1, teamId: TEAM, task: task() }, 0),
        data: { version: 1, teamId: TEAM, task: { ...task(), blockedBy: [42] } },
      },
      {
        ...event('team/message/queued', { version: 1, teamId: TEAM, message: message() }, 0),
        data: {
          version: 1,
          teamId: TEAM,
          message: { ...message(), content: [{ type: 'text', text: 42 }] },
        },
      },
      {
        ...event('team/message/delivered', {
          version: 1,
          teamId: TEAM,
          messageId: TeamMessageId('message-1'),
          targetId: CHILD,
        }, 0),
        data: {
          version: 1,
          teamId: TEAM,
          messageId: TeamMessageId('message-1'),
          targetId: 42,
        },
      },
      {
        ...event('team/member', { version: 1, teamId: TEAM, member: member() }, 0),
        data: { version: 1, teamId: TEAM, member: member(), unexpected: true },
      },
      {
        ...event('team/task', { version: 1, teamId: TEAM, task: task() }, 0),
        data: { version: 1, teamId: 42, task: task() },
      },
    ] as unknown as SessionEvent[]

    for (const candidate of malformed) {
      expect(() => foldTeam(ROOT, [candidate]))
        .toThrow(/persisted Agent Teams .* payload is invalid/)
    }
  })

  it('retains merge-extensible content blocks while rejecting malformed core variants', () => {
    const extension = { type: 'plugin/custom', payload: { value: 1 } } as never
    const state = foldTeam(ROOT, [event('team/message/queued', {
      version: 1,
      teamId: TEAM,
      message: message({ content: [extension] }),
    }, 0)])
    expect(pending(state)[0]?.content).toEqual([extension])
  })

  it('rejects unsupported event versions without mutating an empty state', () => {
    const state = emptyTeamFoldState(ROOT)
    const invalid = event('team/task', {
      version: 2 as 1,
      teamId: TEAM,
      task: task(),
    }, 0)
    expect(() => { applyTeamEvent(state, invalid) }).toThrow(/unsupported Agent Teams event version 2/)
    expect(isEmptyFold(state)).toBe(true)
  })

  it('ignores unsupported inherited Team records before decoding their version', () => {
    const inherited = event('team/task', {
      version: 2 as 1,
      teamId: TeamId('ancestor'),
      task: task(),
    }, 0)
    expect(isEmptyFold(foldTeam(ROOT, [inherited]))).toBe(true)
  })

  it('still validates complete current-version records inherited from another Team', () => {
    const inherited = {
      ...event('team/task', {
        version: 1,
        teamId: TeamId('ancestor'),
        task: task(),
      }, 0),
      data: {
        version: 1,
        teamId: TeamId('ancestor'),
        task: { ...task(), subject: 42 },
      },
    } as unknown as SessionEvent
    expect(() => foldTeam(ROOT, [inherited]))
      .toThrow(/persisted Agent Teams team\/task payload is invalid/)
  })
})
