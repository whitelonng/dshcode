/**
 * Notifications settings section: the two preference toggles plus the
 * environment permission status row. The toggles write through the injected
 * callbacks (which persist through the settings scope and request web
 * permission on enable); the permission row reflects the sink state and
 * offers a request/retry action unless the environment cannot notify.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createNotificationsSectionStore } from './notifications-store.ts'
import type { NotificationPermissionState } from './notification-sink.ts'
import type { NotificationsKey } from './locales.ts'
import css from './NotificationsSection.module.css'

/** Injected business face: the toggle writes and the permission retry. */
export interface NotificationsSectionInjected {
  /** Persist the approval toggle (requests permission on enable). */
  setApprovals: (enabled: boolean) => void
  /** Persist the completion toggle (requests permission on enable). */
  setCompletions: (enabled: boolean) => void
  /** Ask for notification permission (the settings page's request/retry). */
  requestPermission: () => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type NotificationsSectionProps =
  PropsRuntime<'settings.section'> & PropsStore<ReturnType<typeof createNotificationsSectionStore>>
  & PropsLocale<'settings.notifications'> & NotificationsSectionInjected

/** Permission status line: label, accent, and action for the current state. */
function permissionLine(
  permission: NotificationPermissionState,
  t: (key: NotificationsKey) => string,
  requestPermission: () => void,
): { text: string; action?: () => void; label?: string } {
  switch (permission) {
    case 'granted': return { text: t('permission.granted') }
    case 'requesting': return { text: t('permission.requesting') }
    case 'denied': return { text: t('permission.denied'), action: requestPermission, label: t('permission.retry') }
    case 'default': return { text: t('permission.default'), action: requestPermission, label: t('permission.request') }
    case 'unsupported': return { text: t('permission.unsupported') }
  }
}

/**
 * Render the notifications section.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function NotificationsSection({
  t, useStore, setApprovals, setCompletions, requestPermission,
}: NotificationsSectionProps) {
  const { approvals, completions, permission } = useStore(s => s)
  const line = permissionLine(permission, t, requestPermission)
  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('section.nav')}</h2>
      <div className={css.rows}>
        <label className={css.row}>
          <span className={css.copy}>
            <span className={css.label}>{t('approvals.label')}</span>
            <span className={css.desc}>{t('approvals.desc')}</span>
          </span>
          <button
            type="button"
            role="switch"
            className={css.switch}
            aria-checked={approvals}
            aria-label={t('approvals.label')}
            onClick={() => { setApprovals(!approvals) }}
          >
            <span className={css.thumb} />
          </button>
        </label>
        <label className={css.row}>
          <span className={css.copy}>
            <span className={css.label}>{t('completions.label')}</span>
            <span className={css.desc}>{t('completions.desc')}</span>
          </span>
          <button
            type="button"
            role="switch"
            className={css.switch}
            aria-checked={completions}
            aria-label={t('completions.label')}
            onClick={() => { setCompletions(!completions) }}
          >
            <span className={css.thumb} />
          </button>
        </label>
      </div>
      <div className={css.statusRow}>
        <span className={css.statusText}>{line.text}</span>
        {line.action !== undefined
          ? (
            <button
              type="button"
              className={css.statusAction}
              onClick={() => { line.action?.() }}
            >
              {line.label}
            </button>
          )
          : null}
      </div>
    </div>
  )
}
