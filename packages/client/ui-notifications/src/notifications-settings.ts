/** Notification preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the notifications plugin. */
export const NOTIFICATIONS_SETTINGS_NAMESPACE = 'notifications'

/** Field carrying the approval-notification toggle. */
export const NOTIFICATIONS_APPROVALS_FIELD = 'approvals'

/** Field carrying the task-completion-notification toggle. */
export const NOTIFICATIONS_COMPLETIONS_FIELD = 'completions'

/** Default toggle state when the user-settings document has no override. */
export const DEFAULT_NOTIFICATIONS_ENABLED = true

/** Durable notifications section shared by the Host schema and the browser scope. */
export interface NotificationsSettings {
  /** Whether approval waits raise an OS notification. */
  approvals: boolean
  /** Whether finished sessions and background jobs raise an OS notification. */
  completions: boolean
}

/** Durable notifications schema; also the wire envelope the browser scope validates against. */
export const NotificationsSettingsSchema: z<NotificationsSettings> = z.object({
  [NOTIFICATIONS_APPROVALS_FIELD]: z.boolean().default(DEFAULT_NOTIFICATIONS_ENABLED),
  [NOTIFICATIONS_COMPLETIONS_FIELD]: z.boolean().default(DEFAULT_NOTIFICATIONS_ENABLED),
})
