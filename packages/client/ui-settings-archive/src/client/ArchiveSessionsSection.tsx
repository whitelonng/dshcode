/**
 * Archived sessions settings section: one row per archived conversation with
 * a selection checkbox, plus a search box, bulk restore and bulk permanent
 * delete over the selection. The list loads on mount and after every
 * mutation; permanent deletion requires an explicit confirmation modal
 * because it is irreversible. Business data (titles, times) arrives through
 * the injected wire face; the component keeps only viewing state (loading,
 * query, selection, confirm target) locally.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, IconSearchOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArchivedSessionItem } from './protocol.ts'
import { ArchiveActionError } from './protocol.ts'
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

/** One pending single-row mutation (restore or delete) addressed by session id. */
type PendingAction = { readonly kind: 'restore' | 'delete'; readonly sessionId: string }

/** One pending bulk mutation over the selection. */
type BulkTarget = { readonly kind: 'restore' | 'delete'; readonly count: number }

/** Human-readable creation time for an item. */
function formatCreated(createdAt: number | undefined, t: ArchiveSessionsSectionProps['t']): string | undefined {
  if (createdAt === undefined) return undefined
  const date = new Date(createdAt)
  const time = Number.isNaN(date.getTime())
    ? String(createdAt)
    : date.toLocaleString()
  return t('created', { time })
}

/** Whether an item matches the trimmed search query (title or session id). */
function matchesQuery(item: ArchivedSessionItem, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  const haystack = `${item.title ?? ''} ${item.sessionId}`.toLowerCase()
  return haystack.includes(normalizedQuery)
}

/** The archived-sessions settings page. */
export function ArchiveSessionsSection(props: ArchiveSessionsSectionProps) {
  const { list, restore, remove } = props
  const t = props.t
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [pending, setPending] = useState<PendingAction | undefined>(undefined)
  const [bulkTarget, setBulkTarget] = useState<BulkTarget | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

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
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = useMemo(
    () => rows.filter(item => matchesQuery(item, normalizedQuery)),
    [rows, normalizedQuery],
  )
  const selectedCount = useMemo(
    () => filtered.filter(item => selected.has(item.sessionId)).length,
    [filtered, selected],
  )
  const allSelected = filtered.length > 0 && selectedCount === filtered.length

  const reload = async (): Promise<void> => {
    const items = await list()
    setView({ status: 'ready', items })
  }

  // A live session cannot be permanently deleted: map the Host's
  // `session-active` rejection to copy that names the remedy; every other
  // failure interpolates the raw reason.
  const failureMessage = (kind: 'restore' | 'delete', reason: unknown): string => {
    if (kind === 'delete' && reason instanceof ArchiveActionError && reason.code === 'session-active') {
      return t('deleteFailedActive')
    }
    return t(kind === 'restore' ? 'restoreFailed' : 'deleteFailed', {
      reason: reason instanceof Error ? reason.message : String(reason),
    })
  }

  const toggle = (sessionId: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }

  const toggleAll = (): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (allSelected) {
        for (const item of filtered) next.delete(item.sessionId)
      } else {
        for (const item of filtered) next.add(item.sessionId)
      }
      return next
    })
  }

  const runAction = async (action: PendingAction): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await (action.kind === 'restore' ? restore(action.sessionId) : remove(action.sessionId))
      setPending(undefined)
      await reload()
    } catch (reason) {
      setError(failureMessage(action.kind, reason))
    } finally {
      setBusy(false)
    }
  }

  const runBulk = async (target: BulkTarget): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const ids = rows.filter(item => selected.has(item.sessionId)).map(item => item.sessionId)
      for (const sessionId of ids) {
        await (target.kind === 'restore' ? restore(sessionId) : remove(sessionId))
      }
      setBulkTarget(undefined)
      setSelected(new Set())
      await reload()
    } catch (reason) {
      setError(failureMessage(target.kind, reason))
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
      <div className={css.toolbar}>
        <label className={css.search}>
          <IconSearchOutline16 aria-hidden="true" />
          <span className={css.visuallyHidden}>{t('search')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
        </label>
        {filtered.length > 0 && (
          <div className={css.bulkActions}>
            <label className={css.selectAll}>
              <input
                type="checkbox"
                checked={allSelected}
                aria-label={t('selectAll')}
                disabled={busy}
                onChange={toggleAll}
              />
              <span>{t('selectAll')}</span>
            </label>
            {selectedCount > 0 && (
              <>
                <span className={css.selectedCount}>{t('selected', { count: String(selectedCount) })}</span>
                <Button variant="outline" disabled={busy} onClick={() => { void runBulk({ kind: 'restore', count: selectedCount }) }}>
                  {t('restoreSelected')}
                </Button>
                <Button
                  variant="outline"
                  className={css.dangerButton}
                  disabled={busy}
                  onClick={() => { setBulkTarget({ kind: 'delete', count: selectedCount }) }}
                >
                  {t('deleteSelected')}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {filtered.length === 0
        ? <div className={css.state}>{t('emptySearch')}</div>
        : (
          <ul className={css.list}>
            {filtered.map(item => (
              <li key={item.sessionId} className={css.row}>
                <input
                  type="checkbox"
                  className={css.checkbox}
                  checked={selected.has(item.sessionId)}
                  disabled={busy}
                  aria-label={t('selectItem', { title: item.title ?? t('untitled') })}
                  onChange={() => { toggle(item.sessionId) }}
                />
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
        )}
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
      {bulkTarget !== undefined && (
        <Modal
          title={t('deleteConfirmTitle')}
          open
          onClose={() => { setBulkTarget(undefined) }}
        >
          <p className={css.confirmBody}>{t('bulkDeleteConfirmBody', { count: String(bulkTarget.count) })}</p>
          <div className={css.modalActions}>
            <Button variant="outline" disabled={busy} onClick={() => { setBulkTarget(undefined) }}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              className={css.dangerButton}
              disabled={busy}
              onClick={() => { void runBulk(bulkTarget) }}
            >
              {t('deleteConfirm')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
