/** Desktop-shell lifecycle and navigation policies independent of Electron globals. */

/** Result of classifying a renderer navigation target. */
export type NavigationDisposition = 'application' | 'external' | 'blocked'

/** Loopback address the desktop-owned HTTP carrier must bind. */
const DESKTOP_WEB_HOST = '127.0.0.1'

/** Port value that delegates collision-free allocation to the operating system. */
const DESKTOP_WEB_PORT = 0

/**
 * Supply the main-module argument that packaged Electron launches omit.
 * Cordis HMR uses this argument to classify the launch module even when the
 * Web profile keeps module reload disabled and uses only config watching.
 * @param argv - mutable process argument vector.
 * @param mainModulePath - absolute path of the Electron main module.
 */
export function ensureMainModuleArgument(argv: string[], mainModulePath: string): void {
  if (argv[1] === undefined) argv[1] = mainModulePath
}

/**
 * Build the immutable Web-profile arguments for a desktop launch.
 * @returns Arguments that bind only to loopback and request an ephemeral port.
 */
export function desktopWebArguments(): readonly string[] {
  return ['--host', DESKTOP_WEB_HOST, '--port', String(DESKTOP_WEB_PORT)]
}

/**
 * Convert the activated WebServer address into the renderer URL while enforcing desktop isolation.
 * @param host - host reported by the activated WebServer service.
 * @param port - actual listening port reported after the operating system binds the socket.
 * @returns The local application URL.
 * @throws when the service did not bind the required loopback host or still reports an invalid port.
 */
export function desktopApplicationUrl(host: string, port: number): string {
  if (host !== DESKTOP_WEB_HOST) {
    throw new Error(`desktop web service bound unexpected host ${JSON.stringify(host)}`)
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop web service reported invalid port ${String(port)}`)
  }
  return `http://${DESKTOP_WEB_HOST}:${String(port)}/`
}

/** The shutdown operation owned by the booted Harness tree. */
export interface DesktopShutdown {
  /** Dispose the tree and settle after all owned resources are quiescent. */
  shutdown(code: number): Promise<void>
}

/** One coalescing desktop quit request. */
export interface QuitCoordinator {
  /** Whether a quit request already owns application teardown. */
  readonly requested: boolean
  /** Start or join teardown, then invoke the native exit callback. */
  request(code: number): Promise<void>
}

/**
 * Classify a requested renderer destination against the local application origin.
 * @param rawUrl - absolute destination supplied by Electron.
 * @param applicationOrigin - exact loopback origin owned by this process.
 * @returns Whether the renderer may navigate, the system browser may open it, or it is rejected.
 */
export function navigationDisposition(
  rawUrl: string,
  applicationOrigin: string,
): NavigationDisposition {
  let destination: URL
  try {
    destination = new URL(rawUrl)
  } catch {
    return 'blocked'
  }
  if (destination.origin === applicationOrigin) return 'application'
  if (destination.protocol === 'https:') return 'external'
  return 'blocked'
}

/**
 * Coordinate native quit requests around the Harness disposer.
 * @param shutdown - controller for the booted Harness tree.
 * @param exit - native process exit callback, called only after disposal settles.
 * @returns A controller that coalesces repeated quit requests.
 */
export function createQuitCoordinator(
  shutdown: DesktopShutdown,
  exit: (code: number) => void,
): QuitCoordinator {
  let pending: Promise<void> | undefined
  return {
    get requested() {
      return pending !== undefined
    },
    request(code) {
      pending ??= shutdown.shutdown(code).then(() => { exit(code) })
      return pending
    },
  }
}

/**
 * One tray menu item template: the Electron `MenuItemConstructorOptions`
 * subset the tray uses, with a zero-argument click callback so tests can
 * invoke it without Electron menu arguments.
 */
export interface TrayMenuTemplateItem {
  label?: string
  type?: 'separator'
  click?: () => void
}

/** The two tray actions the main process wires to window and quit flows. */
export interface TrayActions {
  /** Show and focus the main window, recreating it when it does not exist. */
  show: () => void
  /** Request a real application exit through the Harness shutdown controller. */
  quit: () => void
}

/** Whether a main-window close request hides to the tray or really closes. */
export type CloseDisposition = 'hide' | 'close'

/**
 * Decide a window close request under the tray policy: hide unless a real
 * quit already owns teardown.
 * @param quitArmed - whether a quit request is in flight or already completed.
 * @returns the close disposition the main window must follow.
 */
export function windowCloseDisposition(quitArmed: boolean): CloseDisposition {
  return quitArmed ? 'close' : 'hide'
}

/**
 * Build the tray context-menu template. Product copy is Chinese, matching the
 * embedded Web UI.
 * @param actions - the show and quit callbacks the menu wires.
 * @returns the menu template for `Menu.buildFromTemplate`.
 */
export function buildTrayMenu(actions: TrayActions): TrayMenuTemplateItem[] {
  return [
    { label: '显示主界面', click: actions.show },
    { type: 'separator' },
    { label: '退出', click: actions.quit },
  ]
}

/**
 * Resolve the tray icon file for a platform: the colored app logo everywhere.
 * macOS loads it as a 1x/2x representation pair (`tray16.png`/`tray.png`);
 * Windows and Linux use the 32 px file directly.
 * @param platform - the running platform.
 * @returns the icon filename under the packaged `assets/` directory.
 */
export function trayIconFile(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'tray16.png' : 'tray.png'
}

/** Launch argument marking a custom (hidden) window frame on Windows. */
export const DESKTOP_FRAME_ARG = '--dsh-frame=custom'

/** Launch-argument prefix carrying the URL-encoded product name. */
const DESKTOP_PRODUCT_ARG_PREFIX = '--dsh-product-name='

/** Launch-argument prefix carrying the packaged application version. */
const DESKTOP_VERSION_ARG_PREFIX = '--dsh-app-version='

/** IPC channel the renderer menu button invokes to pop the window menu. */
export const DESKTOP_SHOW_MENU_CHANNEL = 'desktop:show-menu'

/** IPC channel the renderer invokes to restart the application in place. */
export const DESKTOP_RESTART_CHANNEL = 'desktop:restart'

/** IPC channel the renderer invokes to surface one native OS notification. */
export const DESKTOP_NOTIFICATION_CHANNEL = 'desktop:notification'

/** IPC channel the main process pushes a clicked notification's request id back to the renderer. */
export const DESKTOP_NOTIFICATION_CLICK_CHANNEL = 'desktop:notification-click'

/** What the renderer learns about the desktop window frame. */
export interface DesktopBridgePayload {
  /** 'custom' when the window renders its own title-bar row (Windows). */
  readonly frame: 'custom' | 'native'
  /** The application product name shown in the title-bar row. */
  readonly productName: string
  /** The packaged application version ('' when the launch carries no version argument). */
  readonly appVersion: string
}

/**
 * Build the preload launch arguments carrying the product name and the
 * application version (URL-encoded because the renderer receives them
 * verbatim). Passed on every platform; the custom-frame argument is
 * platform-owned and the caller appends it separately (Windows only).
 * @param productName - the application product name.
 * @param appVersion - the packaged application version.
 * @returns the `additionalArguments` shared by every platform.
 */
export function desktopLaunchArguments(productName: string, appVersion: string): string[] {
  return [
    `${DESKTOP_PRODUCT_ARG_PREFIX}${encodeURIComponent(productName)}`,
    `${DESKTOP_VERSION_ARG_PREFIX}${encodeURIComponent(appVersion)}`,
  ]
}

/**
 * Parse the preload bridge payload from the renderer process arguments.
 * @param argv - the renderer `process.argv` (includes `additionalArguments`).
 * @returns the bridge payload; an absent product name or version yields an empty string.
 */
export function desktopBridgePayload(argv: readonly string[], _platform: NodeJS.Platform): DesktopBridgePayload {
  const productArg = argv.find(arg => arg.startsWith(DESKTOP_PRODUCT_ARG_PREFIX))
  const versionArg = argv.find(arg => arg.startsWith(DESKTOP_VERSION_ARG_PREFIX))
  return {
    frame: argv.includes(DESKTOP_FRAME_ARG) ? 'custom' : 'native',
    productName: productArg === undefined ? '' : decodeURIComponent(productArg.slice(DESKTOP_PRODUCT_ARG_PREFIX.length)),
    appVersion: versionArg === undefined ? '' : decodeURIComponent(versionArg.slice(DESKTOP_VERSION_ARG_PREFIX.length)),
  }
}

/**
 * Verify an IPC sender against the application origin before honoring it.
 * @param senderUrl - the sender frame URL (`event.senderFrame.url`), absent
 * when the frame is gone.
 * @param applicationOrigin - the exact application origin.
 * @returns whether the sender is a page of the application.
 */
export function desktopIpcSenderIsApplication(senderUrl: string | undefined, applicationOrigin: string): boolean {
  if (senderUrl === undefined) return false
  try {
    return new URL(senderUrl).origin === applicationOrigin
  } catch {
    return false
  }
}

/** The two actions the title-bar window menu wires. */
export interface WindowMenuActions {
  /** Hide the main window to the tray. */
  hide: () => void
  /** Restart the whole application in place (applies profile/patch changes). */
  restart: () => void
  /** Request a real application exit through the Harness shutdown controller. */
  quit: () => void
}

/**
 * Build the window menu template popped by the title-bar menu button.
 * @param actions - the hide, restart, and quit callbacks the menu wires.
 * @returns the menu template for `Menu.buildFromTemplate`.
 */
export function buildWindowMenu(actions: WindowMenuActions): TrayMenuTemplateItem[] {
  return [
    { label: '隐藏到托盘', click: actions.hide },
    { type: 'separator' },
    { label: '重启应用', click: actions.restart },
    { type: 'separator' },
    { label: '退出', click: actions.quit },
  ]
}
