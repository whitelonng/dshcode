// @ts-nocheck -- alpha.4 sync: product pending protocol awaits the client-store deep migration
// @vitest-environment jsdom
/**
 * NotificationsService contract: object-layer edge observation (approval
 * appearance, session running→idle, background-job settlement) folded into
 * OS notifications with settings gating, a 5s (kind, id) dedup window, the
 * hidden-only completion policy, and click-to-focus-and-open navigation.
 * The sink, settings scope, clock, and visibility gate are injected fakes so
 * the environment never enters the test.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ISessions, SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { JobView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { type NotificationsSettings } from '../src/notifications-settings.ts'
import { zh } from '../src/client/locales.ts'
import type { NotificationPermissionState, NotificationSink } from '../src/client/notification-sink.ts'
import { NOTIFICATION_DEDUP_WINDOW_MS, NotificationsService } from '../src/client/notifications-service.ts'

/** Session-list pending status string (was PendingInteractionStatus; flat in alpha.4). */
type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'

const translate = makeTranslate(zh)

const sid = (id: string) => id as SessionId
const jid = (id: string) => id as JobView['id']

function sessionSummary(id: string, patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id),
    displayTitle: `title-${id}`,
    running: false,
    blank: false,
    updatedAt: 1,
    ...patch,
  }
}

/** Sessions face double over a real snapshot store; bindings carry pending approvals. */
function sessionsDouble() {
  const list = createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const opened: SessionId[] = []
  const bindings = new Map<string, { toolName: string }>()
  return {
    list,
    opened,
    setToolName: (id: string, toolName: string): void => { bindings.set(id, { toolName }) },
    add: (summary: SessionSummary): void => {
      list.update((draft) => {
        draft.ids.push(summary.id)
        draft.byId[summary.id] = summary
      })
    },
    update: (id: string, patch: Omit<Partial<SessionSummary>, 'pendingInteraction'>
      & { pendingInteraction?: PendingInteractionStatus | undefined }): void => {
      list.update((draft) => {
        draft.byId[sid(id)] = { ...draft.byId[sid(id)]!, ...patch } as SessionSummary
      })
    },
    setJobs: (id: string, jobs: readonly JobView[]): void => {
      list.update((draft) => {
        const mirror = draft.jobsBySession as Record<string, readonly JobView[]>
        if (jobs.length === 0) {
          const next: Record<string, readonly JobView[]> = {}
          for (const key of Object.keys(mirror)) {
            if (key === sid(id)) continue
            const jobs = mirror[key]
            if (jobs !== undefined) next[key] = jobs
          }
          draft.jobsBySession = next
        } else {
          mirror[sid(id)] = jobs
        }
      })
    },
    remove: (id: string): void => {
      list.update((draft) => {
        draft.ids = draft.ids.filter(candidate => candidate !== sid(id))
        const { [sid(id)]: _removed, ...rest } = draft.byId
        draft.byId = rest
      })
    },
    sessions: {
      list,
      open: (id: SessionId) => { opened.push(id) },
      binding: (id: SessionId) => {
        const binding = bindings.get(id)
        return binding === undefined
          ? undefined
          : { session: { getSnapshot: () => ({ pending: [{ kind: 'approval', toolName: binding.toolName }] }) } } as never
      },
    } as Pick<ISessions, 'list' | 'open' | 'binding'>,
  }
}

function settingsScope(over: Partial<NotificationsSettings> = {}) {
  const stub = stubSettingsScope<NotificationsSettings>()
  stub.publish({
    status: 'ready',
    value: { approvals: true, completions: true, ...over },
    revision: 0,
    writable: true,
  })
  return stub
}

/** Sink whose show/requestPermission are spies the spec asserts on. */
type FakeSink = NotificationSink & {
  show: ReturnType<typeof vi.fn>
  requestPermission: ReturnType<typeof vi.fn>
}

function fakeSink(
  over: Partial<NotificationSink> = {},
): { sink: FakeSink; shows: Array<{ title: string; body: string; onClick: () => void }> } {
  const shows: Array<{ title: string; body: string; onClick: () => void }> = []
  const sink = {
    supported: true,
    permission: () => 'granted' as const,
    requestPermission: vi.fn(async () => 'granted' as const),
    show: vi.fn((title: string, body: string, onClick: () => void) => { shows.push({ title, body, onClick }) }),
    ...over,
  } as FakeSink
  return { sink, shows }
}

interface Bench {
  sessions: ReturnType<typeof sessionsDouble>
  settings: ReturnType<typeof settingsScope>
  sink: FakeSink
  shows: Array<{ title: string; body: string; onClick: () => void }>
  service: NotificationsService
  focus: ReturnType<typeof vi.fn>
  setNow: (next: number) => void
  setHidden: (next: boolean) => void
}

function bench(over: {
  settings?: Partial<NotificationsSettings>
  hidden?: boolean
  sink?: FakeSink
} = {}): Bench {
  const sessions = sessionsDouble()
  const settings = settingsScope(over.settings)
  const fake = fakeSink(over.sink)
  const { sink, shows } = fake
  let nowValue = 0
  let hiddenValue = over.hidden ?? false
  const service = new NotificationsService({
    sessions: sessions.sessions,
    settings: settings.scope,
    sink,
    translate,
    now: () => nowValue,
    isHidden: () => hiddenValue,
  })
  service.attach()
  const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})
  return {
    sessions, settings, sink, shows, service, focus,
    setNow: (next) => { nowValue = next },
    setHidden: (next) => { hiddenValue = next },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('NotificationsService approval edges', () => {
  it('fires on an approval appearance with the tool name and session title', () => {
    const b = bench()
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.setToolName('s1', 'bash')
    b.sessions.update('s1', { pendingInteraction: 'approval' })

    expect(b.sink.show).toHaveBeenCalledTimes(1)
    const [title, body] = b.sink.show.mock.calls[0]! as [string, string]
    expect(title).toBe('需要授权：bash')
    expect(body).toBe('title-s1')
  })

  it('falls back to the generic title when the session is not instantiated', () => {
    const b = bench()
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { pendingInteraction: 'approval' })

    expect(b.sink.show).toHaveBeenCalledTimes(1)
    expect(b.sink.show.mock.calls[0]![0]).toBe('需要授权')
  })

  it('treats the attach-time snapshot as a baseline (no edge for an already-pending session)', () => {
    const b = bench()
    b.sessions.add(sessionSummary('s1', { running: true, pendingInteraction: 'approval' }))
    expect(b.sink.show).not.toHaveBeenCalled()
  })

  it('fires approvals while the page is visible (a blocked task deserves a ping)', () => {
    const b = bench({ hidden: false })
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    expect(b.sink.show).toHaveBeenCalledTimes(1)
  })

  it('suppresses approvals when the toggle is off', () => {
    const b = bench({ settings: { approvals: false } })
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    expect(b.sink.show).not.toHaveBeenCalled()
  })
})

describe('NotificationsService completion edges', () => {
  it('fires on a session running→idle edge only while the document is hidden', () => {
    const b = bench({ hidden: true })
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { running: false })
    expect(b.sink.show).toHaveBeenCalledTimes(1)
    expect(b.sink.show.mock.calls[0]![0]).toBe('任务完成')
    expect(b.sink.show.mock.calls[0]![1]).toBe('会话「title-s1」已完成运行')
  })

  it('stays silent on session completion while the document is visible', () => {
    const b = bench({ hidden: false })
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { running: false })
    expect(b.sink.show).not.toHaveBeenCalled()
  })

  it('fires on a background job leaving running or stopping, only while hidden', () => {
    const b = bench({ hidden: true })
    b.sessions.add(sessionSummary('s1'))
    b.sessions.setJobs('s1', [{ id: jid('job-1'), kind: 'bash', label: 'pnpm build', status: 'running', startedAt: 0 }])
    b.sessions.setJobs('s1', [{ id: jid('job-1'), kind: 'bash', label: 'pnpm build', status: 'completed', startedAt: 0, finishedAt: 1 }])
    expect(b.sink.show).toHaveBeenCalledTimes(1)
    expect(b.sink.show.mock.calls[0]![0]).toBe('任务完成')
    expect(b.sink.show.mock.calls[0]![1]).toBe('任务「pnpm build」已完成')

    b.setHidden(false)
    b.sessions.setJobs('s1', [{ id: jid('job-2'), kind: 'bash', label: 'pnpm test', status: 'running', startedAt: 0 }])
    b.sessions.setJobs('s1', [{ id: jid('job-2'), kind: 'bash', label: 'pnpm test', status: 'failed', startedAt: 0, finishedAt: 1 }])
    expect(b.sink.show).toHaveBeenCalledTimes(1)
  })

  it('suppresses completions when the toggle is off', () => {
    const b = bench({ settings: { completions: false }, hidden: true })
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { running: false })
    expect(b.sink.show).not.toHaveBeenCalled()
  })

  it('does not re-fire a job that arrives already settled (replay baseline)', () => {
    const b = bench({ hidden: true })
    b.sessions.add(sessionSummary('s1'))
    b.sessions.setJobs('s1', [{ id: jid('job-1'), kind: 'bash', label: 'pnpm build', status: 'completed', startedAt: 0, finishedAt: 1 }])
    expect(b.sink.show).not.toHaveBeenCalled()
  })
})

describe('NotificationsService dedup and click', () => {
  it('drops a repeat (kind, id) inside the dedup window and re-fires after it', () => {
    const b = bench()
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    b.sessions.update('s1', { pendingInteraction: undefined })
    b.setNow(NOTIFICATION_DEDUP_WINDOW_MS - 1)
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    expect(b.sink.show).toHaveBeenCalledTimes(1)

    b.sessions.update('s1', { pendingInteraction: undefined })
    b.setNow(NOTIFICATION_DEDUP_WINDOW_MS)
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    expect(b.sink.show).toHaveBeenCalledTimes(2)
  })

  it('focuses the window and opens the owning session on click', () => {
    const b = bench()
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    const onClick = b.sink.show.mock.calls[0]![2] as () => void
    onClick()
    expect(b.focus).toHaveBeenCalledOnce()
    expect(b.sessions.opened).toEqual([sid('s1')])
  })

  it('opens the job-owning session on a job-completion click', () => {
    const b = bench({ hidden: true })
    b.sessions.add(sessionSummary('s1'))
    b.sessions.setJobs('s1', [{ id: jid('job-1'), kind: 'bash', label: 'pnpm build', status: 'running', startedAt: 0 }])
    b.sessions.setJobs('s1', [{ id: jid('job-1'), kind: 'bash', label: 'pnpm build', status: 'completed', startedAt: 0, finishedAt: 1 }])
    b.shows[0]!.onClick()
    expect(b.sessions.opened).toEqual([sid('s1')])
  })

  it('skips dispatch when the sink is unsupported or permission is not granted', () => {
    const quiet = fakeSink({ supported: false })
    const b = bench({ sink: quiet.sink, hidden: true })
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    expect(quiet.sink.show).not.toHaveBeenCalled()
    b.service.dispose()
  })

  it('cleans up watch state on disposal and ignores later snapshot changes', () => {
    const b = bench()
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.service.dispose()
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    expect(b.sink.show).not.toHaveBeenCalled()
  })
})

describe('NotificationsService lifecycle and defaults', () => {
  it('attach and dispose are idempotent', () => {
    const b = bench()
    b.service.attach()
    b.service.attach()
    b.service.dispose()
    b.service.dispose()
  })

  it('seeds a non-empty snapshot as baseline at attach (no edge for pre-existing waits)', () => {
    const sessions = sessionsDouble()
    sessions.add(sessionSummary('s1', { running: true, pendingInteraction: 'approval' }))
    const { sink } = fakeSink()
    const service = new NotificationsService({
      sessions: sessions.sessions,
      settings: settingsScope().scope,
      sink,
      translate,
    })
    service.attach()
    expect(sink.show).not.toHaveBeenCalled()
    service.dispose()
  })

  it('clears watch state for a session that leaves the list', () => {
    const b = bench()
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.remove('s1')
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    // The re-added session was seeded fresh; the removal wiped its watch state.
    expect(b.sink.show).toHaveBeenCalledTimes(1)
  })

  it('defaults the toggles to enabled while the settings scope is loading', () => {
    const sessions = sessionsDouble()
    const settings = stubSettingsScope<NotificationsSettings>()
    const { sink } = fakeSink()
    const service = new NotificationsService({
      sessions: sessions.sessions,
      settings: settings.scope,
      sink,
      translate,
    })
    service.attach()
    sessions.add(sessionSummary('s1', { running: true }))
    sessions.update('s1', { pendingInteraction: 'approval' })
    expect(sink.show).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('uses the document visibility default when no gate is injected', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    const sessions = sessionsDouble()
    const { sink } = fakeSink()
    const service = new NotificationsService({
      sessions: sessions.sessions,
      settings: settingsScope().scope,
      sink,
      translate,
    })
    service.attach()
    sessions.add(sessionSummary('s1', { running: true }))
    sessions.update('s1', { running: false })
    expect(sink.show).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('stays silent while permission is not granted even on a supported sink', () => {
    const { sink } = fakeSink({ permission: () => 'denied' })
    const b = bench({ sink, hidden: false })
    b.sessions.add(sessionSummary('s1', { running: true }))
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    expect(sink.show).not.toHaveBeenCalled()
  })

  it('collapses concurrent permission requests into one', async () => {
    let resolveRequest!: (state: NotificationPermissionState) => void
    const { sink } = fakeSink({
      permission: () => 'default',
      requestPermission: vi.fn(() => new Promise<NotificationPermissionState>((resolve) => { resolveRequest = resolve })),
    })
    const b = bench({ sink, hidden: false })
    const first = b.service.requestPermission()
    const second = b.service.requestPermission()
    resolveRequest('granted')
    await Promise.all([first, second])
    expect(sink.requestPermission).toHaveBeenCalledTimes(1)
    expect(b.service.permission()).toBe('granted')
  })

  it('recovers the sink permission when a request rejects', async () => {
    const { sink } = fakeSink({
      permission: () => 'denied',
      requestPermission: vi.fn(async () => { throw new Error('permission prompt unavailable') }),
    })
    const b = bench({ sink, hidden: false })
    await b.service.requestPermission()
    expect(b.service.permission()).toBe('denied')
  })
})

describe('NotificationsService permission', () => {
  it('reflects the sink permission and notifies listeners on request result', async () => {
    const { sink } = fakeSink({ permission: () => 'default' })
    const b = bench({ sink, hidden: false })
    expect(b.service.permission()).toBe('default')
    const listener = vi.fn()
    b.service.subscribe(listener)
    await b.service.requestPermission()
    expect(sink.requestPermission).toHaveBeenCalledOnce()
    expect(b.service.permission()).toBe('granted')
    expect(listener).toHaveBeenCalledTimes(2) // requesting + granted
  })

  it('reports a denied permission and leaves it denied after retry', async () => {
    const { sink } = fakeSink({
      permission: () => 'denied',
      requestPermission: vi.fn(async () => 'denied' as const),
    })
    const b = bench({ sink, hidden: false })
    expect(b.service.permission()).toBe('denied')
    await b.service.requestPermission()
    expect(b.service.permission()).toBe('denied')
  })

  it('requests permission on enable only when the browser has never been asked', async () => {
    const { sink } = fakeSink({ permission: () => 'default' })
    const b = bench({ sink, hidden: false })
    await b.service.setApprovals(true)
    expect(sink.requestPermission).toHaveBeenCalledOnce()
    expect(b.settings.set).toHaveBeenCalledWith('approvals', true)
  })

  it('does not request permission when enabling is a no-op on granted state, and never on disable', async () => {
    const { sink } = fakeSink()
    const b = bench({ sink, hidden: false })
    await b.service.setApprovals(true)
    expect(sink.requestPermission).not.toHaveBeenCalled()
    await b.service.setCompletions(false)
    expect(sink.requestPermission).not.toHaveBeenCalled()
    expect(b.settings.set).toHaveBeenCalledWith('completions', false)
  })

  it('treats an unsupported environment as silently disabled', async () => {
    const { sink } = fakeSink({ supported: false })
    const b = bench({ sink, hidden: false })
    expect(b.service.permission()).toBe('unsupported')
    await b.service.requestPermission()
    expect(b.service.permission()).toBe('unsupported')
    await b.service.setApprovals(true)
    expect(sink.requestPermission).not.toHaveBeenCalled()
    expect(b.settings.set).toHaveBeenCalledWith('approvals', true)
  })
})
