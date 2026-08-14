/**
 * Desktop application chrome: the single-row title bar rendered only inside
 * the DSHCode desktop shell on Windows (custom frame). Shows the product
 * name and a menu button in a draggable strip; the native window controls
 * from `titleBarOverlay` occupy the same row. In every other environment —
 * plain browsers, native-frame platforms — the bridge is absent or reports
 * a native frame and the children render unwrapped, so the shared shell
 * output is unchanged. Pure presentation: no subscriptions, no services.
 */
import type { ReactNode } from 'react'
import css from './DesktopTitleBar.module.css'

/** Minimal face of the desktop preload bridge (defined in apps/desktop). */
export interface DesktopBridge {
  /** 'custom' when the window renders its own title-bar row (Windows). */
  readonly frame: 'custom' | 'native'
  /** The application product name shown in the title-bar row. */
  readonly productName: string
  /** Pop the native window menu (hide to tray / restart / quit). */
  showMenu: () => void
  /** Restart the whole application in place (applies profile and patch changes). */
  restart: () => void
}

declare global {
  interface Window {
    /** Present only inside the desktop shell's preload. */
    dshDesktop?: DesktopBridge
  }
}

/**
 * The desktop title-bar chrome. On a custom frame it renders the draggable
 * bar above the application frame; elsewhere the application frame renders
 * unchanged.
 * @param props.children - the assembled application frame.
 */
export function DesktopTitleBar(props: { children?: ReactNode }) {
  const bridge = window.dshDesktop
  if (bridge === undefined || bridge.frame !== 'custom') return <>{props.children}</>
  return (
    <div className={css.shell}>
      <div className={css.titlebar}>
        <div className={css.inner}>
          <span className={css.brand}>{bridge.productName}</span>
          <button
            type="button"
            className={css.menu}
            aria-label="应用菜单"
            title="应用菜单"
            onClick={() => { bridge.showMenu() }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div className={css.body}>{props.children}</div>
    </div>
  )
}
