/**
 * Merged plugin list tab: an install box plus one row per installed user
 * plugin (saved enablement switch, version, update availability, update and
 * uninstall actions) above a collapsed-by-default read-only built-in
 * section (searchable, status only — built-ins carry no switches).
 * Uninstall requires confirmation; installs, updates, and switches end with
 * a restart affordance (the desktop preload bridge restarts the application
 * in place; the web build shows a hint instead). Enablement switches persist
 * to the profile patch layer and apply at the next restart.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconSearchOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  InstalledPluginItem,
  InstallProgressItem,
  PluginControlItem,
  PluginFailureItem,
  PluginFailuresSnapshot,
  PluginUpdateItem,
} from './protocol.ts'
import type { PluginInstallerLocaleKey } from './locales.ts'
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
  /** Whether this browser has loopback authority to use the host routes. */
  isLoopback: boolean
  /** Read the installed snapshot. */
  list: () => Promise<InstalledPluginItem[]>
  /** Install one plugin from an npm spec or git URL. */
  install: (spec: string) => Promise<InstalledPluginItem>
  /** Re-install one plugin from its recorded source. */
  update: (id: string) => Promise<InstalledPluginItem>
  /** Remove one plugin. */
  uninstall: (id: string) => Promise<InstalledPluginItem[]>
  /** Persist one user plugin's next-start enablement. */
  setEnabled: (id: string, enabled: boolean) => Promise<InstalledPluginItem>
  /** Compare installed versions against their sources. */
  checkUpdates: () => Promise<PluginUpdateItem[]>
  /** Read the current install/update progress. */
  status: () => Promise<InstallProgressItem>
  /** Read the recorded boot failures, plugin root, and safe-mode state. */
  failures: () => Promise<PluginFailuresSnapshot>
  /** Persist the safe-mode marker (toggled together with a restart). */
  setSafeMode: (enabled: boolean) => Promise<void>
  /** Start a repair conversation over the plugin install root. */
  repairPlugin: (pluginRoot: string, message: string) => Promise<void>
  /** Read the deployment-configured preset plugin switches. */
  controlsList: () => Promise<PluginControlItem[]>
  /** Persist one preset plugin's next-start enablement. */
  controlsSetEnabled: (pluginId: string, enabled: boolean) => Promise<PluginControlItem[]>
  /** Remove one preset product from the user's list. */
  controlsUninstall: (pluginId: string) => Promise<PluginControlItem[]>
  /** Read the current Loader entry inventory. */
  inventoryList: () => Promise<PluginInventorySnapshot>
}

/** Full component props assembled by the Settings slot renderer. */
export type PluginInstallerTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInstaller'>
  & InjectFace<PluginInstallerTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
    readonly status: 'ready'
    readonly plugins: readonly InstalledPluginItem[]
    readonly snapshot: PluginInventorySnapshot
    readonly controls: readonly PluginControlItem[]
    readonly failures: PluginFailuresSnapshot
  }

/** One row operation in flight. */
type BusyAction = { readonly kind: 'install' | 'update' | 'uninstall' | 'check'; readonly id?: string }

/** One enablement switch in flight: a user plugin or a preset product. */
type ToggleBusy = { readonly kind: 'user' | 'preset'; readonly id: string }

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Locale keys for the preset-product states. */
const CONTROL_STATE_KEYS = {
  enabled: 'enabled',
  disabled: 'disabled',
  mixed: 'mixed',
  unavailable: 'unavailable',
  uninstalled: 'uninstalled',
} as const satisfies Record<PluginControlItem['state'], PluginInstallerLocaleKey>

/** Localized label for one install phase, with percent when the download has one. */
function progressLabel(progress: InstallProgressItem, t: PluginInstallerTabProps['t']): string {
  if (progress.stage === 'fetch') return t('fetching')
  if (progress.stage === 'extract') return t('extracting')
  if (progress.stage === 'write') return t('writing')
  return progress.percent === undefined
    ? t('downloading')
    : t('downloadingPercent', { percent: String(progress.percent) })
}

/** Whether an inventory row matches the local catalog query. */
function matchesEntry(entry: PluginInventorySnapshot['entries'][number], normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/**
 * The seeded first message of a repair conversation: the failure record and
 * the plugin's absolute install path, self-contained so the agent never needs
 * to read files outside its workspace to start.
 * @param failure - the recorded failure of the plugin.
 * @returns the repair prompt text.
 */
function repairMessage(failure: PluginFailureItem): string {
  return `插件「${failure.pluginId}」上次启动失败，当前已被禁用。请修复它。

失败详情：
${failure.message}

原始堆栈：
${failure.stack}

插件安装目录：${failure.installPath}

请检查并修复该插件；修复完成后告诉我如何重新启用。`
}

/**
 * The seeded first message for a failed-install handoff conversation: the
 * install target and the error text, self-contained for the agent.
 * @param spec - the install target (npm package or git URL) that failed.
 * @param reason - the rendered install error.
 * @returns the repair prompt text.
 */
function installRepairMessage(spec: string, reason: string): string {
  return `插件安装失败，请帮我诊断并修复。

安装目标：${spec}

错误信息：
${reason}

请检查该插件并重新安装；完成后告诉我结果。`
}

/** The merged plugin list tab. */
export function PluginInstallerTab(props: PluginInstallerTabProps) {
  const {
    isLoopback,
    list,
    install,
    update,
    uninstall,
    setEnabled,
    checkUpdates,
    status,
    failures,
    setSafeMode,
    repairPlugin,
    inventoryList,
    controlsList,
    controlsSetEnabled,
    controlsUninstall,
  } = props
  const t = props.t
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [spec, setSpec] = useState('')
  const [updates, setUpdates] = useState<ReadonlyMap<string, string>>(new Map())
  const [busy, setBusy] = useState<BusyAction | undefined>(undefined)
  const [toggleBusy, setToggleBusy] = useState<ToggleBusy | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  /** The plugin id whose repair conversation is being opened. */
  const [repairing, setRepairing] = useState<string | undefined>(undefined)
  /** The plugin id whose failure text was just copied. */
  const [copied, setCopied] = useState<string | undefined>(undefined)

  /** One uninstall confirmation in flight: the row kind, its id, and its display name. */
  type UninstallTarget = { readonly kind: 'user' | 'preset'; readonly id: string; readonly name: string }

  const [uninstallTarget, setUninstallTarget] = useState<UninstallTarget | undefined>(undefined)
  const [dirty, setDirty] = useState(false)
  const [builtinOpen, setBuiltinOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** Saved user-plugin enablement written this session (the Loader row applies at restart). */
  const [overlay, setOverlay] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  /** Install/update progress polled from the host while a mutation runs. */
  const [progress, setProgress] = useState<InstallProgressItem>({ kind: 'idle', stage: 'fetch' })

  useEffect(() => {
    if (busy === undefined || (busy.kind !== 'install' && busy.kind !== 'update')) {
      setProgress({ kind: 'idle', stage: 'fetch' })
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      const next = await status().catch(() => undefined)
      if (stopped || next === undefined) return
      setProgress(next)
      timer = setTimeout(() => { void poll() }, 400)
    }
    timer = setTimeout(() => { void poll() }, 100)
    return () => {
      stopped = true
      /* v8 ignore next 1 -- the effect assigns the timer before ever returning the cleanup */
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [busy, status])

  useEffect(() => {
    let cancelled = false
    Promise.all([list(), inventoryList(), controlsList(), failures()]).then(([plugins, snapshot, controls, failureSnapshot]) => {
      if (!cancelled) setView({ status: 'ready', plugins, snapshot, controls, failures: failureSnapshot })
    }).catch(() => {
      if (!cancelled) setView({ status: 'error' })
    })
    return () => { cancelled = true }
  }, [list, inventoryList, controlsList, failures])

  const plugins = useMemo(() => view.status === 'ready' ? view.plugins : [], [view])
  const snapshot = useMemo(() => view.status === 'ready' ? view.snapshot : undefined, [view])
  const controls = useMemo(() => view.status === 'ready' ? view.controls : [], [view])
  const failureSnapshot = useMemo(() => view.status === 'ready' ? view.failures : undefined, [view])

  /** Saved enablement of one user plugin: this session's writes win over the host-computed saved state. */
  const userEnabled = (plugin: InstalledPluginItem): boolean =>
    overlay.get(plugin.id) ?? plugin.enabled

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const builtinEntries = useMemo(() => {
    if (snapshot === undefined) return []
    const userPluginIds = new Set(plugins.map(plugin => plugin.id))
    return snapshot.entries.filter(entry => !userPluginIds.has(entry.entryId))
  }, [snapshot, plugins])
  const filteredBuiltins = useMemo(
    () => builtinEntries.filter(entry => matchesEntry(entry, normalizedQuery)),
    [builtinEntries, normalizedQuery],
  )

  const reload = async (): Promise<void> => {
    const [plugins, snapshot, controls, failureSnapshot] = await Promise.all([list(), inventoryList(), controlsList(), failures()])
    setView({ status: 'ready', plugins, snapshot, controls, failures: failureSnapshot })
  }

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

  /** The install spec whose latest attempt failed; arms the handoff action. */
  const [failedSpec, setFailedSpec] = useState<string | undefined>(undefined)

  const onInstall = (): void => {
    const target = spec.trim()
    void run({ kind: 'install' }, async () => {
      try {
        await install(target)
        setFailedSpec(undefined)
        setSpec('')
        await reload()
      } catch (reason) {
        setFailedSpec(target)
        throw reason
      }
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

  const onUninstall = (target: UninstallTarget): void => {
    void run({ kind: 'uninstall', id: target.id }, async () => {
      await uninstall(target.id)
      setUninstallTarget(undefined)
      await reload()
    })
  }

  const onPresetUninstall = (target: UninstallTarget): void => {
    void run({ kind: 'uninstall', id: target.id }, async () => {
      const next = await controlsUninstall(target.id)
      setView((current) => {
        /* v8 ignore next 1 -- switches render only while ready; the view cannot be stale here */
        if (current.status !== 'ready') return current
        return { status: 'ready', plugins: current.plugins, snapshot: current.snapshot, controls: next, failures: current.failures }
      })
      setUninstallTarget(undefined)
    })
  }

  const onCheck = (): void => {
    void run({ kind: 'check' }, async () => {
      const found = await checkUpdates()
      setUpdates(new Map(found.map(item => [item.id, item.latest])))
    })
  }

  const onUserToggle = (id: string, enabled: boolean): void => {
    setToggleBusy({ kind: 'user', id })
    setError(undefined)
    void setEnabled(id, enabled).then((plugin) => {
      setOverlay(previous => new Map([...previous, [plugin.id, plugin.enabled]]))
      setToggleBusy(undefined)
      setDirty(true)
    }).catch((reason: unknown) => {
      setError(t('failed', { reason: reason instanceof Error ? reason.message : String(reason) }))
      setToggleBusy(undefined)
    })
  }

  const onPresetToggle = (id: string, enabled: boolean): void => {
    setToggleBusy({ kind: 'preset', id })
    setError(undefined)
    void controlsSetEnabled(id, enabled).then((next) => {
      setView((current) => {
        /* v8 ignore next 1 -- switches render only while ready; the view cannot be stale here */
        if (current.status !== 'ready') return current
        return { status: 'ready', plugins: current.plugins, snapshot: current.snapshot, controls: next, failures: current.failures }
      })
      setToggleBusy(undefined)
      setDirty(true)
    }).catch((reason: unknown) => {
      setError(t('failed', { reason: reason instanceof Error ? reason.message : String(reason) }))
      setToggleBusy(undefined)
    })
  }

  const restart = (): void => {
    desktopBridge()?.restart()
  }

  /** Open a repair conversation seeded with the failure record. */
  const onRepair = (failure: PluginFailureItem): void => {
    if (failureSnapshot === undefined) return
    setRepairing(failure.pluginId)
    setError(undefined)
    void repairPlugin(failureSnapshot.pluginRoot, repairMessage(failure)).then(() => {
      setRepairing(undefined)
    }).catch((reason: unknown) => {
      setRepairing(undefined)
      setError(t('failed', { reason: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /** Hand the latest failed install off to a repair conversation over the install root. */
  const onRepairInstall = (): void => {
    if (failedSpec === undefined || view.status !== 'ready') return
    setRepairing(failedSpec)
    void repairPlugin(view.failures.pluginRoot, installRepairMessage(failedSpec, error ?? '')).then(() => {
      setRepairing(undefined)
      setError(undefined)
      setFailedSpec(undefined)
    }).catch((reason: unknown) => {
      setRepairing(undefined)
      setError(t('failed', { reason: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  /** Copy the failure text for a manual repair conversation. */
  const onCopy = (failure: PluginFailureItem): void => {
    const text = `${failure.message}\n\n${failure.stack}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(failure.pluginId)
    }).catch(() => {
      setError(t('failed', { reason: 'clipboard unavailable' }))
    })
  }

  /** Leave safe mode and restart so the user patch layers load again. */
  const onExitSafeMode = (): void => {
    void setSafeMode(false).then(() => {
      if (desktopBridge() !== undefined) {
        restart()
      } else {
        setDirty(true)
      }
    }).catch((reason: unknown) => {
      setError(t('failed', { reason: reason instanceof Error ? reason.message : String(reason) }))
    })
  }

  if (!isLoopback) {
    return (
      <div className={css.notice}>
        <strong>{t('localOnlyTitle')}</strong>
        <p>{t('localOnlyBody')}</p>
      </div>
    )
  }

  if (view.status === 'loading') return <div className={css.state}>{t('loading')}</div>
  if (view.status === 'error') return <div className={css.state}>{t('failed', { reason: 'load' })}</div>

  /** Whether every enablement switch is locked while another mutation runs. */
  const safeMode = failureSnapshot?.safeMode ?? false
  const toggleDisabled = (): boolean => busy !== undefined || toggleBusy !== undefined || safeMode

  return (
    <div className={css.section} data-plugin-panel aria-busy={busy !== undefined || toggleBusy !== undefined}>
      {safeMode && (
        <div className={css.safeModeBanner} data-safe-mode>
          <span>{t('safeModeBanner')}</span>
          <Button variant="primary" disabled={busy !== undefined} onClick={onExitSafeMode}>
            {t('exitSafeMode')}
          </Button>
        </div>
      )}
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
      {(busy?.kind === 'install' || busy?.kind === 'update') && (
        <div className={css.progressRow} role="status">
          <div className={css.progressTrack}>
            <div
              className={css.progressBar}
              data-indeterminate={progress.percent === undefined ? 'true' : undefined}
              style={progress.percent === undefined ? undefined : { width: `${progress.percent}%` }}
            />
          </div>
          <span className={css.progressLabel}>{progressLabel(progress, t)}</span>
        </div>
      )}
      {error !== undefined && (
        <div className={css.errorRow}>
          <span className={css.error}>{error}</span>
          {failedSpec !== undefined && (
            <Button variant="outline" disabled={repairing !== undefined} onClick={onRepairInstall}>
              {repairing !== undefined ? t('repairing') : t('repair')}
            </Button>
          )}
        </div>
      )}
      {toggleBusy !== undefined && <p className={css.applying} aria-live="polite">{t('applying')}</p>}
      <div className={css.actionsRow}>
        <Button variant="outline" disabled={busy !== undefined} onClick={onCheck}>
          {busy?.kind === 'check' ? t('checking') : t('checkUpdates')}
        </Button>
        {updates.size === 0 && busy === undefined && plugins.length > 0 && <span className={css.ok}>{t('noUpdates')}</span>}
      </div>

      <section className={css.group} aria-labelledby="dsh-user-plugins-heading">
        <h3 className={css.sectionTitle} id="dsh-user-plugins-heading">{t('userPlugins')}</h3>
        {plugins.length === 0 && controls.length === 0
          ? <div className={css.state}>{t('empty')}</div>
          : (
            <ul className={css.list}>
              {controls.map((control) => {
                const checked = control.state === 'enabled'
                const unavailable = control.state === 'unavailable'
                const uninstalled = control.state === 'uninstalled'
                return (
                  <li key={control.id} className={css.row} data-preset-plugin={control.id}>
                    <div className={css.meta}>
                      <div className={css.name}>{control.name}</div>
                      <div className={css.sub}>
                        <a className={css.source} href={control.repository} target="_blank" rel="noreferrer">
                          {t('source')}
                        </a>
                      </div>
                    </div>
                    <div className={css.actions}>
                      <span className={css.state} data-state={control.state}>
                        {t(CONTROL_STATE_KEYS[control.state])}
                      </span>
                      {uninstalled ? (
                        <Button
                          variant="primary"
                          disabled={busy !== undefined || toggleBusy !== undefined}
                          onClick={() => { onPresetToggle(control.id, true) }}
                        >
                          {t('restore')}
                        </Button>
                      ) : (
                        <>
                          <button
                            className={css.switch}
                            type="button"
                            role="switch"
                            aria-checked={checked}
                            aria-label={t(checked ? 'disableSwitch' : 'enableSwitch', { name: control.name })}
                            disabled={unavailable || toggleDisabled()}
                            onClick={() => { onPresetToggle(control.id, !checked) }}
                          >
                            <span aria-hidden="true" />
                          </button>
                          <Button
                            variant="outline"
                            disabled={busy !== undefined}
                            onClick={() => { setUninstallTarget({ kind: 'preset', id: control.id, name: control.name }) }}
                          >
                            {t('uninstall')}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
              {plugins.map((plugin) => {
                const enabled = userEnabled(plugin)
                const failure = failureSnapshot?.items.find(item => item.pluginId === plugin.id)
                return (
                  <li key={plugin.id} className={css.row} data-user-plugin={plugin.id}>
                    <div className={css.meta}>
                      <div className={css.name}>{plugin.name}</div>
                      <div className={css.sub}>
                        {t('version', { version: plugin.version })}
                        {updates.has(plugin.id) && (() => {
                          const latest = updates.get(plugin.id)
                          /* v8 ignore next 1 -- badges render only when the map holds the id */
                          if (latest === undefined) return null
                          return <span className={css.latest}>{t('latest', { version: latest })}</span>
                        })()}
                      </div>
                      <div className={css.sub}>{plugin.source.spec}</div>
                      {failure !== undefined && (
                        <div className={css.failure} data-plugin-failure={plugin.id}>
                          <span className={css.badge}>{t('failureBadge')}</span>
                          <span className={css.failureMessage} title={failure.message}>{failure.message}</span>
                          <div className={css.failureActions}>
                            <Button
                              variant="primary"
                              disabled={busy !== undefined || repairing !== undefined}
                              onClick={() => { onRepair(failure) }}
                            >
                              {repairing === plugin.id ? t('repairing') : t('repair')}
                            </Button>
                            <Button
                              variant="outline"
                              disabled={busy !== undefined}
                              onClick={() => { onCopy(failure) }}
                            >
                              {copied === plugin.id ? t('copied') : t('copyError')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className={css.actions}>
                      <span className={css.state} data-state={enabled ? 'enabled' : 'disabled'}>
                        {t(enabled ? 'enabled' : 'disabled')}
                      </span>
                      <button
                        className={css.switch}
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={t(enabled ? 'disableSwitch' : 'enableSwitch', { name: plugin.name })}
                        disabled={toggleDisabled()}
                        onClick={() => { onUserToggle(plugin.id, !enabled) }}
                      >
                        <span aria-hidden="true" />
                      </button>
                      {updates.has(plugin.id) && (
                        <Button variant="primary" disabled={busy !== undefined} onClick={() => { onUpdate(plugin.id) }}>
                          {busy?.kind === 'update' && busy.id === plugin.id ? t('updating') : t('update')}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        disabled={busy !== undefined}
                        onClick={() => { setUninstallTarget({ kind: 'user', id: plugin.id, name: plugin.name }) }}
                      >
                        {t('uninstall')}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
      </section>

      <section className={css.group} aria-labelledby="dsh-builtin-plugins-heading">
        <button
          className={css.disclosure}
          id="dsh-builtin-plugins-heading"
          type="button"
          aria-expanded={builtinOpen}
          onClick={() => { setBuiltinOpen(open => !open) }}
        >
          <h3 className={css.sectionTitle}>{t('builtinPlugins')}</h3>
          <span className={css.count} data-plugin-count={filteredBuiltins.length}>{filteredBuiltins.length}</span>
          <IconChevronDownOutline14
            className={builtinOpen ? css.chevronOpen : css.chevron}
            size={14}
            aria-hidden="true"
          />
        </button>
        {builtinOpen && (
          <>
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
            {filteredBuiltins.length === 0
              ? <div className={css.state}>{normalizedQuery.length > 0 ? t('emptySearch') : t('empty')}</div>
              : (
                <ul className={css.list}>
                  {filteredBuiltins.map((entry) => {
                    const enabled = entry.enabled
                    const title = moduleShortName(entry.moduleName)
                    return (
                      <li key={entry.entryId} className={css.row} data-plugin-entry={entry.entryId}>
                        <div className={css.meta}>
                          <div className={css.name} title={entry.moduleName}>{title}</div>
                        </div>
                        <span className={css.state} data-state={enabled ? 'enabled' : 'disabled'}>
                          {t(enabled ? 'enabled' : 'disabled')}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
          </>
        )}
      </section>

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
          closeLabel={t('close')}
          onClose={() => { setUninstallTarget(undefined) }}
        >
          <p className={css.confirmBody}>{t('uninstallConfirmBody', { name: uninstallTarget.name })}</p>
          <div className={css.modalActions}>
            <Button variant="outline" disabled={busy !== undefined} onClick={() => { setUninstallTarget(undefined) }}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              className={css.dangerButton}
              disabled={busy !== undefined}
              onClick={() => {
                if (uninstallTarget.kind === 'preset') onPresetUninstall(uninstallTarget)
                else onUninstall(uninstallTarget)
              }}
            >
              {t('confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
