/**
 * Notifications settings-section store: a mirror of the service permission
 * state plus the durable preference scope. The plugin's apply-world sync
 * listener is the only writer; the section component reads via
 * props.useStore and writes through the injected callbacks.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { NotificationPermissionState } from './notification-sink.ts'

/** Store state mirrored from the preference scope and the service. */
export interface NotificationsSectionState {
  /** Settings scope status; `unavailable` means the Host does not expose the namespace. */
  settingsStatus: 'loading' | 'ready' | 'unavailable'
  /** Whether approval notifications are enabled. */
  approvals: boolean
  /** Whether task-completion notifications are enabled. */
  completions: boolean
  /** Environment permission state the section renders. */
  permission: NotificationPermissionState
}

/** Declared action shape giving the exported factory a stable return type. */
type NotificationsSectionActions = {
  sync: (draft: NotificationsSectionState, next: NotificationsSectionState) => void
}

/**
 * Declares the notifications section state and write surface.
 * @returns the store handle.
 */
export function createNotificationsSectionStore(): EngineStoreHandle<NotificationsSectionState, NotificationsSectionActions> {
  return defineStore({
    init: (): NotificationsSectionState => ({
      settingsStatus: 'loading',
      approvals: true,
      completions: true,
      permission: 'unsupported',
    }),
    actions: {
      sync: (d, next) => {
        d.settingsStatus = next.settingsStatus
        d.approvals = next.approvals
        d.completions = next.completions
        d.permission = next.permission
      },
    },
  })
}
