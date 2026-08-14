/**
 * Plugin install and update tab: an install box (npm spec or git URL) plus
 * one row per installed user plugin with version, update availability, and
 * update/uninstall actions. Uninstall requires confirmation; installs and
 * updates end with a restart affordance (the desktop preload bridge restarts
 * the application in place; the web build shows a hint instead).
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InstalledPluginItem, PluginUpdateItem } from './protocol.ts'
import css from './PluginInstallerTab.module.css'

/** Minimal face of the desktop preload bridge (defined in apps/desktop).
 * Read through a local cast: the authoritative `Window.dshDesktop` type lives
 * in the shell (client-web), and a second global declaration would replace it. */
type DesktopBridge = { restart: () => void }

function desktopBridge(): DesktopBridge | undefined {
  return (window as Window & { dshDesktop?: DesktopBridge }).dshDesktop
}

/** Registration-side wire face used by the tab. */
export interface PluginInstallerTabInjected {
  /** Read the installed snapshot. */
  list: () => Promise<InstalledPluginItem[]>
  /** Install one plugin from an npm spec or git URL. */
  install: (spec: string) => Promise<InstalledPluginItem>
  /** Re-install one plugin from its recorded source. */
  update: (id: string) => Promise<InstalledPluginItem>
  /** Remove one plugin. */
  uninstall: (id: string) => Promise<InstalledPluginItem[]>
  /** Compare installed versions against their sources. */
  checkUpdates: () => Promise<PluginUpdateItem[]>
}

/** Full component props assembled by the Settings slot renderer. */
export type PluginInstallerTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInstaller'>
  & InjectFace<PluginInstallerTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly plugins: readonly InstalledPluginItem[] }

/** One row operation in flight. */
type BusyAction = { readonly kind: 'install' | 'update' | 'uninstall' | 'check'; readonly id?: string }

/** The plugin-install tab. */
export function PluginInstallerTab(props: PluginInstallerTabProps) {
  const { list, install, update, uninstall, checkUpdates } = props
  const t = props.t
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [spec, setSpec] = useState('')
  const [updates, setUpdates] = useState<ReadonlyMap<string, string>>(new Map())
  const [busy, setBusy] = useState<BusyAction | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [uninstallTarget, setUninstallTarget] = useState<string | undefined>(undefined)
  const [dirty, setDirty] = useState(false)

  const reload = async (): Promise<void> => {
    setView({ status: 'ready', plugins: await list() })
  }

  useEffect(() => {
    let cancelled = false
    list().then((plugins) => {
      if (!cancelled) setView({ status: 'ready', plugins })
    }).catch(() => {
      if (!cancelled) setView({ status: 'error' })
    })
    return () => { cancelled = true }
  }, [list])

  const plugins = useMemo(() => view.status === 'ready' ? view.plugins : [], [view])

  const run = async (action: BusyAction, operation: () => Promise<void>): Promise<void> => {
    setBusy(action)
    setError(undefined)
    try {
      await operation()
      setDirty(true)
    } catch (reason) {
      setError(t('failed', { reason: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      setBusy(undefined)
    }
  }

  const onInstall = (): void => {
    void run({ kind: 'install' }, async () => {
      await install(spec.trim())
      setSpec('')
      await reload()
    })
  }

  const onUpdate = (id: string): void => {
    void run({ kind: 'update', id }, async () => {
      await update(id)
      const next = new Map(updates)
      next.delete(id)
      setUpdates(next)
      await reload()
    })
  }

  const onUninstall = (id: string): void => {
    void run({ kind: 'uninstall', id }, async () => {
      await uninstall(id)
      setUninstallTarget(undefined)
      await reload()
    })
  }

  const onCheck = (): void => {
    void run({ kind: 'check' }, async () => {
      const found = await checkUpdates()
      setUpdates(new Map(found.map(item => [item.id, item.latest])))
    })
  }

  const restart = (): void => {
    desktopBridge()?.restart()
  }

  if (view.status === 'loading') return <div className={css.state}>{t('installing')}</div>
  if (view.status === 'error') return <div className={css.state}>{t('failed', { reason: 'load' })}</div>

  return (
    <div className={css.section}>
      <div className={css.installRow}>
        <input
          className={css.spec}
          type="text"
          value={spec}
          placeholder={t('installPlaceholder')}
          onChange={(event) => { setSpec(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && spec.trim() !== '' && busy === undefined) onInstall()
          }}
        />
        <Button variant="primary" disabled={spec.trim() === '' || busy !== undefined} onClick={onInstall}>
          {busy?.kind === 'install' ? t('installing') : t('install')}
        </Button>
      </div>
      <div className={css.hint}>{t('installHint')}</div>
      {error !== undefined && <div className={css.error}>{error}</div>}
      <div className={css.actionsRow}>
        <Button variant="outline" disabled={busy !== undefined} onClick={onCheck}>
          {busy?.kind === 'check' ? t('checking') : t('checkUpdates')}
        </Button>
        {updates.size === 0 && busy === undefined && plugins.length > 0 && <span className={css.ok}>{t('noUpdates')}</span>}
      </div>
      {plugins.length === 0
        ? <div className={css.state}>{t('empty')}</div>
        : (
          <ul className={css.list}>
            {plugins.map(plugin => (
              <li key={plugin.id} className={css.row}>
                <div className={css.meta}>
                  <div className={css.name}>{plugin.name}</div>
                  <div className={css.sub}>
                    {t('version', { version: plugin.version })}
                    {updates.has(plugin.id) && (() => {
                      const latest = updates.get(plugin.id)
                      return latest === undefined
                        ? null
                        : <span className={css.latest}>{t('latest', { version: latest })}</span>
                    })()}
                  </div>
                  <div className={css.sub}>{plugin.source.spec}</div>
                </div>
                <div className={css.actions}>
                  {updates.has(plugin.id) && (
                    <Button variant="primary" disabled={busy !== undefined} onClick={() => { onUpdate(plugin.id) }}>
                      {busy?.kind === 'update' && busy.id === plugin.id ? t('updating') : t('update')}
                    </Button>
                  )}
                  <Button variant="outline" disabled={busy !== undefined} onClick={() => { setUninstallTarget(plugin.id) }}>
                    {t('uninstall')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      {dirty && (
        <div className={css.restartRow}>
          <span>{t('restartHint')}</span>
          {desktopBridge() !== undefined && (
            <Button variant="primary" onClick={restart}>{t('restart')}</Button>
          )}
        </div>
      )}
      {uninstallTarget !== undefined && (
        <Modal
          title={t('uninstallConfirmTitle')}
          open
          onClose={() => { setUninstallTarget(undefined) }}
        >
          <p className={css.confirmBody}>{t('uninstallConfirmBody', { name: uninstallTarget })}</p>
          <div className={css.modalActions}>
            <Button variant="outline" disabled={busy !== undefined} onClick={() => { setUninstallTarget(undefined) }}>
              {t('cancel')}
            </Button>
            <Button variant="primary" className={css.dangerButton} disabled={busy !== undefined} onClick={() => { onUninstall(uninstallTarget) }}>
              {t('confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
