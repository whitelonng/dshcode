/**
 * System-notification plugin, node half. The empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration. The durable settings namespace is registered through the
 * optional settings service when the composition provides one.
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  NOTIFICATIONS_SETTINGS_NAMESPACE, NotificationsSettingsSchema,
} from './notifications-settings.ts'

export {
  DEFAULT_NOTIFICATIONS_ENABLED, NOTIFICATIONS_APPROVALS_FIELD,
  NOTIFICATIONS_COMPLETIONS_FIELD, NOTIFICATIONS_SETTINGS_NAMESPACE,
  NotificationsSettingsSchema, type NotificationsSettings,
} from './notifications-settings.ts'

/**
 * Register the durable notification-preference section when the settings
 * service is composed; without it the browser scope degrades to defaults.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(NOTIFICATIONS_SETTINGS_NAMESPACE), NotificationsSettingsSchema,
    )
  })
}
