/** ui-notifications apply wiring: service attachment over the sessions list,
 * settings-scope mirroring into the section store, localized section
 * registration, face write routing, and HMR collapse recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry, createSnapshotStore, type ISessions, type SessionId, type SessionListState, type SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-notifications/client'
import type { NotificationsSectionInjected } from '../src/client/NotificationsSection.tsx'
import { NotificationsSection } from '../src/client/NotificationsSection.tsx'
import type { createNotificationsSectionStore } from '../src/client/notifications-store.ts'
import { NS } from '../src/client/locales.ts'
import { NOTIFICATIONS_APPROVALS_FIELD, NOTIFICATIONS_COMPLETIONS_FIELD, NOTIFICATIONS_SETTINGS_NAMESPACE, NotificationsSettingsSchema } from '../src/notifications-settings.ts'

// The service reads the browser environment for its sink; these specs assert
// the shipped Chinese copy and a granted browser permission.
usePinnedBrowserLanguages('zh-CN')

const SLOT = 'settings.general.item'

function sessionsDouble() {
  const list = createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const opened: SessionId[] = []
  return {
    list,
    opened,
    add: (summary: SessionSummary): void => {
      list.update((draft) => {
        draft.ids.push(summary.id)
        draft.byId[summary.id] = summary
      })
    },
    update: (id: string, patch: Partial<SessionSummary>): void => {
      list.update((draft) => {
        draft.byId[id as SessionId] = { ...draft.byId[id as SessionId]!, ...patch }
      })
    },
    sessions: {
      list,
      open: (id: SessionId) => { opened.push(id) },
      binding: () => undefined,
    } as Pick<ISessions, 'list' | 'open' | 'binding'>,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function bench() {
  // A granted browser Notification API so the wired sink dispatches in the spec.
  const notificationInstances = stubGrantedNotification()
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  let section = { approvals: true, completions: true }
  const namespace = () => ({
    ns: NOTIFICATIONS_SETTINGS_NAMESPACE,
    schema: NotificationsSettingsSchema.toJSON(),
    value: section,
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'notifications-describe' as never,
    result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [namespace()] } },
  }))
  const mutate = vi.fn((request: { ns: string; ops: { path: string[]; value?: unknown }[] }) => {
    const op = request.ops[0]!
    section = { ...section, [op.path[0]!]: op.value }
    return Promise.resolve({ rpcId: 'notifications-mutate' as never, result: { ok: true as const, value: namespace() } })
  })
  ctx.provide('connection', {
    api: { settings: { describe, mutate } },
    isLoopback: true,
  } as never)
  new TestRemote(ctx)
  await ctx.plugin(SettingsScopeBinder).await()
  const sessions = sessionsDouble()
  ctx.provide('sessions', sessions.sessions)
  return { ctx, sessions, locale, describe, mutate, notificationInstances }
}

/** Stand in for the settings shell: declare the section slot from root. */
function declareSection(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Bake a real store instance and hand its actions to the entry's inject factory. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === NotificationsSection)!
  const handle = entry.store as ReturnType<typeof createNotificationsSectionStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => NotificationsSectionInjected)(instance.actions)
  return { entry, instance, face }
}

/** A granted browser Notification API so the wired sink dispatches in the spec. */
function stubGrantedNotification() {
  const instances: Array<{ title: string; onclick: (() => void) | null }> = []
  const api = class FakeNotification {
    static permission = 'granted' as NotificationPermission
    static requestPermission = vi.fn(async () => 'granted')
    onclick: (() => void) | null = null
    constructor(public readonly title: string) {
      instances.push(this)
    }
  }
  vi.stubGlobal('Notification', api)
  return instances
}

describe('ui-notifications apply', () => {
  it('declares the slot and locale services', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'settingsScope'])
  })

  it('registers the localized notifications section and mirrors settings into its store', async () => {
    const b = await bench()
    declareSection(b.ctx.get('slots') as SlotRegistry)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.ctx.get('slots')!.entries(SLOT).find(e => e.component === NotificationsSection)!
    expect(entry.options).toMatchObject({ id: 'notifications', order: 30 })
    expect(entry.locale).toBe(NS)

    const { instance } = faceOf(b.ctx.get('slots') as SlotRegistry)
    expect(instance.getSnapshot()).toMatchObject({ approvals: true, completions: true, permission: 'granted' })
  })

  it('routes face writes to the settings transport', async () => {
    const b = await bench()
    declareSection(b.ctx.get('slots') as SlotRegistry)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { face } = faceOf(b.ctx.get('slots') as SlotRegistry)

    face.setApprovals(false)
    await vi.waitFor(() => {
      expect(b.mutate).toHaveBeenCalledWith(expect.objectContaining({
        ns: NOTIFICATIONS_SETTINGS_NAMESPACE,
        ops: [{ op: 'set', path: [NOTIFICATIONS_APPROVALS_FIELD], value: false }],
      }))
    })
    face.setCompletions(true)
    await vi.waitFor(() => {
      expect(b.mutate).toHaveBeenCalledWith(expect.objectContaining({
        ns: NOTIFICATIONS_SETTINGS_NAMESPACE,
        ops: [{ op: 'set', path: [NOTIFICATIONS_COMPLETIONS_FIELD], value: true }],
      }))
    })
  })

  it('attaches the notification service over the sessions list', async () => {
    const b = await bench()
    declareSection(b.ctx.get('slots') as SlotRegistry)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.sessions.add({ id: 's1' as SessionId, displayTitle: 't1', running: true, blank: false, updatedAt: 1 })
    b.sessions.update('s1', { pendingInteraction: 'approval' })
    expect(b.notificationInstances).toHaveLength(1)
    expect(b.notificationInstances[0]!.title).toBe('需要授权')
  })

  it('routes the permission request through the wired sink', async () => {
    const b = await bench()
    declareSection(b.ctx.get('slots') as SlotRegistry)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { face } = faceOf(b.ctx.get('slots') as SlotRegistry)
    const api = (globalThis as unknown as { Notification?: { requestPermission: ReturnType<typeof vi.fn> } }).Notification!
    face.requestPermission()
    await vi.waitFor(() => { expect(api.requestPermission).toHaveBeenCalled() })
  })

  it('activates before a slow initial settings read and converges when it settles', async () => {
    const b = await bench()
    const describe = b.describe.getMockImplementation()!
    const pending = deferred<Awaited<ReturnType<typeof describe>>>()
    b.describe.mockImplementationOnce(() => pending.promise)
    declareSection(b.ctx.get('slots') as SlotRegistry)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const { instance } = faceOf(b.ctx.get('slots') as SlotRegistry)
    // Loading scope: the section mirrors the schema defaults.
    expect(instance.getSnapshot()).toMatchObject({ approvals: true, completions: true })
    pending.resolve(await describe())
    await vi.waitFor(() => { expect(instance.getSnapshot().settingsStatus).toBe('ready') })
  })

  it('recovers after an HMR collapse of the declaring entry', async () => {
    const b = await bench()
    const host = declareSection(b.ctx.get('slots') as SlotRegistry)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.ctx.get('slots')!.entries(SLOT)).toHaveLength(1)

    host()
    expect(b.ctx.get('slots')!.entries(SLOT)).toHaveLength(0)

    declareSection(b.ctx.get('slots') as SlotRegistry)
    await Promise.resolve()
    expect(b.ctx.get('slots')!.entries(SLOT).some(e => e.component === NotificationsSection)).toBe(true)
  })

  it('teardown removes the section and stops the service subscription', async () => {
    const b = await bench()
    declareSection(b.ctx.get('slots') as SlotRegistry)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.ctx.get('slots')!.entries(SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.ctx.get('slots')!.entries(SLOT)).toHaveLength(0)
    // Locale disposal: translation falls back to the bare key.
    expect(b.locale.bind(NS)('row.title')).toBe('row.title')
  })
})
