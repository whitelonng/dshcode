/**
 * System-notification plugin, browser half: the notification service
 * (sessions-list edge observer + platform sink + preference scope) and the
 * General-settings notifications row. The service attaches unconditionally so
 * notifications fire whether or not the user ever opened the settings page;
 * the row mirrors service permission and durable preferences through its
 * store. Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings slot declarations plus the ctx.settingsScope
// Context merge. Cross-plugin collaboration goes through the service, never a
// value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  DEFAULT_NOTIFICATIONS_ENABLED, NOTIFICATIONS_SETTINGS_NAMESPACE, type NotificationsSettings,
} from '../notifications-settings.ts'
import { createNotificationSink } from './notification-sink.ts'
import { NotificationsService } from './notifications-service.ts'
import { createNotificationsSectionStore } from './notifications-store.ts'
import { NotificationsSection, type NotificationsSectionInjected } from './NotificationsSection.tsx'
import { en, NS, zh, type NotificationsKey } from './locales.ts'

export type { NotificationsSectionInjected, NotificationsSectionProps } from './NotificationsSection.tsx'
export type { NotificationsSectionState } from './notifications-store.ts'
export type { NotificationsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Notifications settings section + OS notification copy. */
    'settings.notifications': NotificationsKey
  }
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings-general's apply, whose activation order relative to this one is
 * NOT constrained; registration depends on it through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'sessions', 'settingsScope']

/**
 * Wire the notification service to the sessions list and register the
 * General-settings row once its slot declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-notifications: copy dictionaries')

  const t = ctx.locale.bind(NS)
  const settingsHost = ctx.settingsScope.bind<NotificationsSettings>({
    namespace: NOTIFICATIONS_SETTINGS_NAMESPACE,
  })
  const service = new NotificationsService({
    sessions: ctx.sessions,
    settings: settingsHost,
    sink: createNotificationSink(),
    translate: t,
  })
  const store = createNotificationsSectionStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (): void => {
    const snapshot = settingsHost.getSnapshot()
    bound?.sync({
      settingsStatus: snapshot.status,
      approvals: snapshot.value?.approvals ?? DEFAULT_NOTIFICATIONS_ENABLED,
      completions: snapshot.value?.completions ?? DEFAULT_NOTIFICATIONS_ENABLED,
      permission: service.permission(),
    })
  }
  ctx.effect(() => {
    service.attach()
    const disposers = [
      settingsHost.subscribe(sync),
      service.subscribe(sync),
    ]
    sync()
    return () => {
      for (const dispose of disposers) dispose()
      service.dispose()
    }
  }, 'ui-notifications: service wiring')
  const injected = (actions: BoundActions<typeof store>): NotificationsSectionInjected => {
    bound = actions
    // Re-sync at first render so no change between registration and mount is lost.
    sync()
    return {
      setApprovals: (enabled) => { void service.setApprovals(enabled) },
      setCompletions: (enabled) => { void service.setCompletions(enabled) },
      requestPermission: () => { void service.requestPermission() },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'notifications',
    order: 30,
    locale: NS,
    store,
    inject: injected,
  }, NotificationsSection))
}
