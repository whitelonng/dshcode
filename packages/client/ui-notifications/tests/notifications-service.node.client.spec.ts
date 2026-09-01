// @ts-nocheck -- alpha.4 sync: product pending protocol awaits the client-store deep migration
/**
 * Node-environment service behavior: with no `window`/`document`, the
 * completion gate reads false (no hidden page), clicking a notification skips
 * window focus, and the default clock uses Date.now.
 */
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type ISessions, type SessionId, type SessionListState, type SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import type { NotificationSink } from '../src/client/notification-sink.ts'
import { NotificationsService } from '../src/client/notifications-service.ts'

const translate = makeTranslate(zh)
const sid = (id: string) => id as SessionId

function bench() {
  const list = createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const opened: SessionId[] = []
  const sessions = {
    list,
    open: (id: SessionId) => { opened.push(id) },
    binding: () => undefined,
  } as Pick<ISessions, 'list' | 'open' | 'binding'>
  const shows: Array<{ title: string; body: string; onClick: () => void }> = []
  const show = vi.fn((title: string, body: string, onClick: () => void) => { shows.push({ title, body, onClick }) })
  const sink: NotificationSink = {
    supported: true,
    permission: () => 'granted',
    requestPermission: vi.fn(async () => 'granted' as const),
    show,
  }
  const settings = stubSettingsScope<{ approvals: boolean; completions: boolean }>()
  settings.publish({ status: 'ready', value: { approvals: true, completions: true }, revision: 0, writable: true })
  const service = new NotificationsService({ sessions, settings: settings.scope, sink, translate })
  service.attach()
  return { list, opened, sink, shows, show, service, settings }
}

describe('NotificationsService node environment', () => {
  it('keeps the completion gate off without a document and skips focus on click without a window', () => {
    const b = bench()
    const summary: SessionSummary = {
      id: sid('s1'), displayTitle: 'title-s1', running: true, blank: false, updatedAt: 1,
    }
    b.list.update((draft) => {
      draft.ids.push(summary.id)
      draft.byId[summary.id] = summary
    })
    // Session completion while "hidden" is unknowable without a document: no notification.
    b.list.update((draft) => {
      draft.byId[summary.id] = { ...summary, running: false }
    })
    expect(b.show).not.toHaveBeenCalled()
    // The approval path still fires, and its click opens the session without touching window.
    b.list.update((draft) => {
      draft.byId[summary.id] = { ...summary, running: true, pendingInteraction: 'approval' }
    })
    expect(b.show).toHaveBeenCalledTimes(1)
    b.shows[0]!.onClick()
    expect(b.opened).toEqual([sid('s1')])
    b.service.dispose()
  })
})
