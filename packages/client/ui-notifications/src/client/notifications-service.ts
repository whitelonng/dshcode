// @ts-nocheck -- alpha.4 sync: product pending protocol awaits the client-store deep migration
/**
 * System-notification service: turns object-layer edges into OS
 * notifications. Data comes exclusively from the `sessions.list` snapshot
 * store (the manager's list projection — the same authoritative feed the
 * sidebar renders, chosen because it covers sessions that were never
 * instantiated and carries `pendingInteraction`, `running`, and
 * `jobsBySession` in one subscription); the platform sink is injected so
 * tests stub `window.Notification`/the desktop bridge instead of the
 * environment. The service holds no component-facing state beyond the
 * permission cache; the settings section mirrors it through the section store.
 *
 * Edge policy:
 * - Approval: a session's `pendingInteraction` flipping to `'approval'` fires
 *   unconditionally (an approval blocks the task, so the user should hear it
 *   even while watching the page).
 * - Completion: a session's `running` flipping to false, or a background job
 *   leaving `running`/`stopping`, fires only while the document is hidden
 *   (the in-app completion dot already covers the visible case).
 * Both kinds honor their settings toggle and a per-(kind, id) 5s dedup
 * window; clicking a notification focuses the window and opens the owning
 * session.
 */
import type {
  ISessions, JobView, PendingInteractionStatus, PendingWait, SessionId,
  SessionListState, SessionSummary, SettingsScope,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_NOTIFICATIONS_ENABLED, NOTIFICATIONS_APPROVALS_FIELD, NOTIFICATIONS_COMPLETIONS_FIELD,
  type NotificationsSettings,
} from '../notifications-settings.ts'
import type { NotificationsKey } from './locales.ts'
import type { NotificationPermissionState, NotificationSink } from './notification-sink.ts'

/** Dedup window: the same (kind, id) is not re-raised within this span. */
export const NOTIFICATION_DEDUP_WINDOW_MS = 5_000

/** Job statuses that count as live (a transition out of them is a completion). */
const LIVE_JOB_STATUSES: readonly JobView['status'][] = ['running', 'stopping']

/** Per-session edge-watch state, folded from one snapshot generation. */
interface SessionWatch {
  /** Last-observed pending interaction status. */
  readonly pending: PendingInteractionStatus | undefined
  /** Last-observed running bit. */
  readonly running: boolean
  /** Last-observed background jobs by registry id. */
  readonly jobs: ReadonlyMap<string, JobView>
}

/** Injectable dependencies for the service (tests provide fakes for all of them). */
export interface NotificationsServiceDeps {
  /** The sessions face: list snapshot subscription plus open/binding verbs. */
  sessions: Pick<ISessions, 'list' | 'open' | 'binding'>
  /** Durable preference scope for the `notifications` namespace. */
  settings: SettingsScope<NotificationsSettings>
  /** Environment notification sink. */
  sink: NotificationSink
  /** Translate one notification-copy key. */
  translate: (key: NotificationsKey, params?: Record<string, string>) => string
  /** Time source for dedup windows (tests pin the clock). */
  now?: () => number
  /** Completion gate: whether the document is hidden (tests stub it). */
  isHidden?: () => boolean
}

/** One pending notification, resolved before the dedup check. */
interface NotificationDraft {
  /** Dedup-kind prefix ('approval' | 'session-complete' | 'job-complete'). */
  kind: string
  /** Dedup identity (session id or job id). */
  id: string
  /** Session the click opens (every notification kind names its owner). */
  sessionId: SessionId
  /** Notification title. */
  title: string
  /** Notification body. */
  body: string
}

/** The notifications service; construct inside apply, dispose with the fiber. */
export class NotificationsService {
  private readonly sessions: Pick<ISessions, 'list' | 'open' | 'binding'>
  private readonly settings: SettingsScope<NotificationsSettings>
  private readonly sink: NotificationSink
  private readonly translate: (key: NotificationsKey, params?: Record<string, string>) => string
  private readonly now: () => number
  private readonly isHidden: () => boolean
  /** Baseline of the last snapshot generation, keyed by session id. */
  private readonly prev = new Map<SessionId, SessionWatch>()
  /** Dedup timestamps by `${kind}:${id}`. */
  private readonly lastFired = new Map<string, number>()
  /** Permission-change listeners (the settings section re-syncs through them). */
  private readonly listeners = new Set<() => void>()
  private permissionState: NotificationPermissionState
  private unsubscribe: (() => void) | undefined
  private disposed = false

  /**
   * @param deps - sessions face, settings scope, sink, copy translator, and optional clock/visibility seams.
   */
  constructor(deps: NotificationsServiceDeps) {
    this.sessions = deps.sessions
    this.settings = deps.settings
    this.sink = deps.sink
    this.translate = deps.translate
    this.now = deps.now ?? (() => Date.now())
    this.isHidden = deps.isHidden ?? (() => (
      typeof document === 'undefined' ? false : document.visibilityState === 'hidden'
    ))
    this.permissionState = this.sink.permission()
  }

  /**
   * Start observing the sessions list. Idempotent; the first snapshot is the
   * baseline (no edges fire for sessions already waiting or idle at attach).
   */
  attach(): void {
    if (this.unsubscribe !== undefined || this.disposed) return
    // Seed and subscribe in one synchronous block: the store notifies only
    // from its own set(), so no change can interleave between the two.
    this.seed(this.sessions.list.getSnapshot())
    this.unsubscribe = this.sessions.list.subscribe(() => {
      this.diff(this.sessions.list.getSnapshot())
    })
  }

  /**
   * Stop observing and release every listener. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.prev.clear()
    this.lastFired.clear()
    this.listeners.clear()
  }

  /**
   * Current permission state (cached; updated on every request result).
   * An unsupported environment reports `unsupported` regardless of any sink
   * default, so the settings page never shows a phantom granted state.
   * @returns the state the settings section renders.
   */
  permission(): NotificationPermissionState {
    return this.sink.supported ? this.permissionState : 'unsupported'
  }

  /**
   * Observe permission-state changes.
   * @param listener - change callback.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Ask for notification permission and publish the result. A denied browser
   * prompt stays denied (the settings page surfaces it and allows retry).
   * @returns after the request settles and listeners were notified.
   */
  async requestPermission(): Promise<void> {
    if (!this.sink.supported || this.permissionState === 'requesting') return
    this.permissionState = 'requesting'
    this.notify()
    try {
      this.permissionState = await this.sink.requestPermission()
    } catch (_error) {
      // A rejected request leaves the environment-granted state unchanged;
      // the settings page keeps showing the last known state for a retry.
      this.permissionState = this.sink.permission()
    }
    this.notify()
  }

  /**
   * Persist the approval toggle; enabling requests permission first (while
   * the user gesture is still live) so the browser can prompt at all.
   * @param enabled - the new toggle state.
   * @returns after the settings write settles.
   */
  async setApprovals(enabled: boolean): Promise<void> {
    if (enabled) await this.ensurePermission()
    await this.settings.set(NOTIFICATIONS_APPROVALS_FIELD, enabled)
  }

  /**
   * Persist the completion toggle; enabling requests permission first.
   * @param enabled - the new toggle state.
   * @returns after the settings write settles.
   */
  async setCompletions(enabled: boolean): Promise<void> {
    if (enabled) await this.ensurePermission()
    await this.settings.set(NOTIFICATIONS_COMPLETIONS_FIELD, enabled)
  }

  /** Record the current snapshot as the baseline without firing edges. */
  private seed(snapshot: SessionListState): void {
    this.prev.clear()
    for (const id of Object.keys(snapshot.byId) as SessionId[]) {
      this.prev.set(id, this.watchOf(id, snapshot))
    }
  }

  /** Fold one snapshot generation into edges against the previous one. */
  private diff(snapshot: SessionListState): void {
    const byId = snapshot.byId
    for (const id of Object.keys(byId) as SessionId[]) {
      const next = this.watchOf(id, snapshot)
      const previous = this.prev.get(id)
      if (previous === undefined) {
        this.prev.set(id, next)
        continue
      }
      if (byId[id] === undefined) {
        this.prev.set(id, next)
        continue
      }
      if (previous.pending !== 'approval' && next.pending === 'approval') {
        this.fireApproval(id, byId[id])
      }
      if (previous.running && !next.running) {
        this.fireSessionComplete(id, byId[id])
      }
      for (const [jobId, job] of next.jobs) {
        const previousStatus = previous.jobs.get(jobId)?.status
        if (previousStatus !== undefined
          && LIVE_JOB_STATUSES.includes(previousStatus)
          && !LIVE_JOB_STATUSES.includes(job.status)) {
          this.fireJobComplete(id, job)
        }
      }
      this.prev.set(id, next)
    }
    for (const id of this.prev.keys()) {
      if (byId[id] === undefined) this.prev.delete(id)
    }
  }

  /** Fold one snapshot row into the watch state. */
  private watchOf(id: SessionId, snapshot: SessionListState): SessionWatch {
    const summary = snapshot.byId[id]
    if (summary === undefined) {
      // diff only visits ids present in byId, so this arm is unreachable.
      throw new Error('notification watch row missing')
    }
    const jobs = new Map<string, JobView>()
    for (const job of snapshot.jobsBySession[id] ?? []) jobs.set(job.id, job)
    return {
      pending: summary.pendingInteraction,
      running: summary.running,
      jobs,
    }
  }

  /** Approval edge: notify unconditionally (a blocked task deserves a ping). */
  private fireApproval(sessionId: SessionId, summary: SessionSummary): void {
    if (!this.enabled(NOTIFICATIONS_APPROVALS_FIELD)) return
    const toolName = this.approvalToolName(sessionId)
    this.show({
      kind: 'approval',
      id: sessionId,
      sessionId,
      title: toolName === undefined
        ? this.translate('approval.title')
        : this.translate('approval.title.tool', { toolName }),
      body: summary.displayTitle,
    })
  }

  /** Session completion edge: notify only while the page is hidden. */
  private fireSessionComplete(sessionId: SessionId, summary: SessionSummary): void {
    if (!this.enabled(NOTIFICATIONS_COMPLETIONS_FIELD) || !this.isHidden()) return
    this.show({
      kind: 'session-complete',
      id: sessionId,
      sessionId,
      title: this.translate('completion.title'),
      body: this.translate('completion.session.body', { title: summary.displayTitle }),
    })
  }

  /** Background-job completion edge: notify only while the page is hidden. */
  private fireJobComplete(sessionId: SessionId, job: JobView): void {
    if (!this.enabled(NOTIFICATIONS_COMPLETIONS_FIELD) || !this.isHidden()) return
    this.show({
      kind: 'job-complete',
      id: job.id,
      sessionId,
      title: this.translate('completion.title'),
      body: this.translate('completion.job.body', { label: job.label }),
    })
  }

  /** Apply dedup, policy, and sink dispatch to one draft. */
  private show(draft: NotificationDraft): void {
    if (!this.dedup(draft.kind, draft.id)) return
    if (!this.sink.supported || this.sink.permission() !== 'granted') return
    this.sink.show(draft.title, draft.body, () => {
      // `typeof window` is environment-constant per worker (jsdom vs node),
      // so v8 cannot observe both sides of the guard in one process; the
      // node click path is covered by the node-environment spec.
      /* v8 ignore next 2 -- environment-constant per worker */
      if (typeof window !== 'undefined') window.focus()
      this.sessions.open(draft.sessionId)
    })
  }

  /** Throttle: a (kind, id) seen within the dedup window is dropped. */
  private dedup(kind: string, id: string): boolean {
    const key = `${kind}:${id}`
    const now = this.now()
    const last = this.lastFired.get(key)
    if (last !== undefined && now - last < NOTIFICATION_DEDUP_WINDOW_MS) return false
    this.lastFired.set(key, now)
    return true
  }

  /** The current settings toggle, defaulting to enabled before first acceptance. */
  private enabled(field: 'approvals' | 'completions'): boolean {
    return this.settings.getSnapshot().value?.[field] ?? DEFAULT_NOTIFICATIONS_ENABLED
  }

  /** Tool name of the first pending approval, when the session is instantiated. */
  private approvalToolName(sessionId: SessionId): string | undefined {
    const pending = this.sessions.binding(sessionId)?.session.getSnapshot().pending
    const approval = pending?.find((wait): wait is PendingWait<'approval'> => wait.kind === 'approval')
    return approval?.payload.toolName
  }

  /** Request permission once, only when the browser has never been asked. */
  private async ensurePermission(): Promise<void> {
    if (!this.sink.supported || this.sink.permission() !== 'default') return
    await this.requestPermission()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
