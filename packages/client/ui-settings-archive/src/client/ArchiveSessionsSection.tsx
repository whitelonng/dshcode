/**
 * Archived sessions settings section: one row per archived conversation with
 * restore and permanent-delete actions. The list loads on mount and after
 * every mutation; deletion requires an explicit confirmation modal because
 * it is irreversible. Business data (titles, times) arrives through the
 * injected wire face; the component keeps only viewing state (loading,
 * confirm target) locally.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArchivedSessionItem } from './protocol.ts'
import css from './ArchiveSessionsSection.module.css'

/** Registration-side wire face used by the section. */
export interface ArchiveSessionsSectionInjected {
  /** Read the current archived-session list. */
  list: () => Promise<ArchivedSessionItem[]>
  /** Remove one session from the archive set (reappears in its workspace). */
  restore: (sessionId: string) => Promise<void>
  /** Permanently delete one archived session on the host. Irreversible. */
  remove: (sessionId: string) => Promise<void>
}

/** Full component props assembled by the Settings slot renderer. */
export type ArchiveSessionsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.archive'>
  & InjectFace<ArchiveSessionsSectionInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly items: readonly ArchivedSessionItem[] }

/** One pending mutation (restore or delete) addressed by session id. */
type PendingAction = { readonly kind: 'restore' | 'delete'; readonly sessionId: string }

/** Human-readable creation time for an item. */
function formatCreated(createdAt: number | undefined, t: ArchiveSessionsSectionProps['t']): string | undefined {
  if (createdAt === undefined) return undefined
  const date = new Date(createdAt)
  const time = Number.isNaN(date.getTime())
    ? String(createdAt)
    : date.toLocaleString()
  return t('created', { time })
}

/** The archived-sessions settings page. */
export function ArchiveSessionsSection(props: ArchiveSessionsSectionProps) {
  const { list, restore, remove } = props
  const t = props.t
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [pending, setPending] = useState<PendingAction | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    list().then((items) => {
      if (!cancelled) setView({ status: 'ready', items })
    }).catch(() => {
      if (!cancelled) setView({ status: 'error' })
    })
    return () => { cancelled = true }
  }, [list])

  const rows = useMemo(() => view.status === 'ready' ? view.items : [], [view])

  const runAction = async (action: PendingAction): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await (action.kind === 'restore' ? restore(action.sessionId) : remove(action.sessionId))
      setPending(undefined)
      const items = await list()
      setView({ status: 'ready', items })
    } catch (reason) {
      setError(t(action.kind === 'restore' ? 'restoreFailed' : 'deleteFailed', {
        reason: reason instanceof Error ? reason.message : String(reason),
      }))
    } finally {
      setBusy(false)
    }
  }

  if (view.status === 'loading') {
    return <div className={css.state}>{t('loading')}</div>
  }
  if (view.status === 'error') {
    return (
      <div className={css.state}>
        {t('loadError')}
        <button type="button" className={css.retry} onClick={() => { setView({ status: 'loading' }) }}>
          {t('retry')}
        </button>
      </div>
    )
  }
  if (rows.length === 0) {
    return <div className={css.state}>{t('empty')}</div>
  }
  const confirmTarget = pending?.kind === 'delete' ? pending.sessionId : undefined

  return (
    <div className={css.section}>
      {error !== undefined && <div className={css.error}>{error}</div>}
      <ul className={css.list}>
        {rows.map(item => (
          <li key={item.sessionId} className={css.row}>
            <div className={css.meta}>
              <div className={css.title}>{item.title ?? t('untitled')}</div>
              <div className={css.sub}>{item.sessionId}</div>
              {formatCreated(item.createdAt, t) !== undefined && (
                <div className={css.sub}>{formatCreated(item.createdAt, t)}</div>
              )}
            </div>
            <div className={css.actions}>
              <Button variant="outline" disabled={busy} onClick={() => { void runAction({ kind: 'restore', sessionId: item.sessionId }) }}>
                {t('restore')}
              </Button>
              <Button
                variant="primary"
                className={css.dangerButton}
                disabled={busy}
                onClick={() => { setPending({ kind: 'delete', sessionId: item.sessionId }) }}
              >
                {t('delete')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {confirmTarget !== undefined && (
        <Modal
          title={t('deleteConfirmTitle')}
          open
          onClose={() => { setPending(undefined) }}
        >
          <p className={css.confirmBody}>{t('deleteConfirmBody')}</p>
          <div className={css.modalActions}>
            <Button variant="outline" disabled={busy} onClick={() => { setPending(undefined) }}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              className={css.dangerButton}
              disabled={busy}
              onClick={() => { void runAction({ kind: 'delete', sessionId: confirmTarget }) }}
            >
              {t('deleteConfirm')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
