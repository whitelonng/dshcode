import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  PluginControlId,
  PluginControlSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginControlLocaleKey } from './locales.ts'
import css from './PluginControlSettingsTab.module.css'

/** Registration-side transport face used by the control tab. */
export interface PluginControlSettingsTabInjected {
  /** Whether this browser has loopback authority to use the control route. */
  isLoopback: boolean
  /** Read the current configured control catalog. */
  list: () => Promise<PluginControlSnapshot>
  /** Persist one control's next-start state and return the updated catalog. */
  setEnabled: (pluginId: PluginControlId, enabled: boolean) => Promise<PluginControlSnapshot>
}

/** Full component props assembled by the Settings slot renderer. */
export type PluginControlSettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginControl'>
  & InjectFace<PluginControlSettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginControlSnapshot }

const STATE_KEYS = {
  enabled: 'enabled',
  disabled: 'disabled',
  mixed: 'mixed',
  unavailable: 'unavailable',
} satisfies Record<PluginControlSnapshot['controls'][number]['state'], PluginControlLocaleKey>

/** Render configured logical products as accessible profile switches. */
export function PluginControlSettingsTab({
  isLoopback,
  list,
  setEnabled,
  t,
}: PluginControlSettingsTabProps): ReactNode {
  const mounted = useRef(true)
  const [request, setRequest] = useState(0)
  const [pending, setPending] = useState<PluginControlId | null>(null)
  const [mutationFailed, setMutationFailed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => () => { mounted.current = false }, [])

  /* jscpd:ignore-start -- This request lifecycle is intentionally local: extracting it would couple independent Settings tabs. */
  useEffect(() => {
    if (!isLoopback) return
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [isLoopback, list, request])
  /* jscpd:ignore-end */

  const retry = (): void => {
    setMutationFailed(false)
    setSaved(false)
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  const change = (pluginId: PluginControlId, enabled: boolean): void => {
    setPending(pluginId)
    setMutationFailed(false)
    setSaved(false)
    void Promise.resolve().then(() => setEnabled(pluginId, enabled)).then(
      (snapshot) => {
        if (!mounted.current) return
        setState({ status: 'ready', snapshot })
        setPending(null)
        setSaved(true)
      },
      () => {
        if (!mounted.current) return
        setMutationFailed(true)
        setPending(null)
      },
    )
  }

  if (!isLoopback) {
    return (
      <div className={css.notice}>
        <strong>{t('localOnlyTitle')}</strong>
        <p>{t('localOnlyBody')}</p>
      </div>
    )
  }

  return (
    <div
      className={css.section}
      data-plugin-control-panel
      aria-busy={state.status === 'loading' || pending !== null}
    >
      <header className={css.heading}>
        <h3>{t('heading')}</h3>
        <p>{t('description')}</p>
      </header>
      {/* jscpd:ignore-start -- Loading/retry markup follows the Settings vocabulary without creating a shared owner. */}
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {/* jscpd:ignore-end */}
      {mutationFailed ? <p className={css.mutationFailure} role="alert">{t('updateError')}</p> : null}
      {pending !== null ? <p className={css.applying} aria-live="polite">{t('applying')}</p> : null}
      {saved ? <p className={css.saved} role="status">{t('restartHint')}</p> : null}
      {state.status === 'ready' && state.snapshot.controls.length === 0
        ? <p className={css.status}>{t('empty')}</p>
        : null}
      {state.status === 'ready' && state.snapshot.controls.length > 0 ? (
        <ul className={css.cards}>
          {state.snapshot.controls.map((control) => {
            const checked = control.state === 'enabled'
            const unavailable = control.state === 'unavailable'
            const switchLabel = t(checked ? 'disableSwitch' : 'enableSwitch', { name: control.name })
            return (
              <li className={css.card} key={control.id} data-plugin-control={control.id}>
                <div className={css.product}>
                  <strong>{control.name}</strong>
                  <a href={control.repository} target="_blank" rel="noreferrer">{t('source')}</a>
                </div>
                <div className={css.control}>
                  <span className={css.state} data-state={control.state}>{t(STATE_KEYS[control.state])}</span>
                  <button
                    className={css.switch}
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-label={switchLabel}
                    disabled={unavailable || pending !== null}
                    onClick={() => { change(control.id, !checked) }}
                  >
                    <span aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
