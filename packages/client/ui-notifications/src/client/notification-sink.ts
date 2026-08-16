/**
 * Platform notification sink: the narrow seam between the notifications
 * service and the OS notification surface. Two implementations exist — the
 * standard Web Notification API (browser) and the Electron preload bridge
 * (desktop shell, native main-process notifications). The factory
 * feature-detects the bridge first, so a page served by the desktop shell
 * never double-asks for web permission.
 */

/** Permission/availability state the settings section displays. */
export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported'
  | 'requesting'

/** One notification the renderer asks the desktop shell to surface. */
export interface DesktopNotificationRequest {
  /** Caller-owned identity echoed back by the click callback. */
  id: string
  /** Notification title. */
  title: string
  /** Optional notification body. */
  body?: string
}

/** The Electron preload bridge surface (see apps/desktop/src/preload.ts). */
export interface DesktopNotificationBridge {
  /** Ask the main process to show a native notification. */
  notify(request: DesktopNotificationRequest): void
  /** Register a click listener; the bridge reports the clicked request id. */
  onNotificationClick(listener: (id: string) => void): () => void
}

/**
 * Read the bridge through a local cast: the authoritative `Window.dshDesktop`
 * type lives in `packages/client/web` and only covers the shell's own members;
 * feature packages narrow it with their own face (the plugin-installer
 * precedent), never by redeclaring the global.
 */
function desktopBridge(): DesktopNotificationBridge | undefined {
  if (typeof window === 'undefined') return undefined
  // The web shell owns `Window.dshDesktop` (DesktopBridge, shell members only);
  // feature packages narrow it through an unknown hop — the two faces share no
  // members, so a direct cast is rejected, and redeclaring the global would
  // collide with the shell's (the plugin-installer precedent).
  return (window as unknown as { dshDesktop?: DesktopNotificationBridge }).dshDesktop
}

/** The sink contract consumed by {@link NotificationsService}. */
export interface NotificationSink {
  /** Whether the environment can surface OS notifications at all. */
  readonly supported: boolean
  /** Current permission state; `unsupported` when the environment cannot notify. */
  permission(): NotificationPermissionState
  /**
   * Ask for notification permission. Resolves to the resulting state; a
   * denied browser prompt stays denied until the user changes site settings.
   */
  requestPermission(): Promise<NotificationPermissionState>
  /**
   * Surface one notification; clicking it must run `onClick`.
   * @param title - notification title.
   * @param body - notification body.
   * @param onClick - click callback (focus the window and open the target session).
   */
  show(title: string, body: string, onClick: () => void): void
}

/** Browser window type carrying the Notification constructor (jsdom stubs it). */
type NotificationApi = typeof Notification

/**
 * Standard browser implementation over `window.Notification`. Missing or
 * throwing constructors degrade to `unsupported`; `show` no-ops unless the
 * permission is granted.
 */
export class BrowserNotificationSink implements NotificationSink {
  private readonly api: NotificationApi | undefined

  constructor() {
    // jsdom and SSR runs may lack the API or throw on construction.
    this.api = typeof Notification === 'function'
      ? Notification
      : undefined
  }

  get supported(): boolean {
    return this.api !== undefined
  }

  permission(): NotificationPermissionState {
    if (this.api === undefined) return 'unsupported'
    return this.api.permission
  }

  async requestPermission(): Promise<NotificationPermissionState> {
    if (this.api === undefined) return 'unsupported'
    return this.api.requestPermission()
  }

  show(title: string, body: string, onClick: () => void): void {
    if (this.api === undefined || this.api.permission !== 'granted') return
    const notification = new this.api(title, { body })
    notification.onclick = () => { onClick() }
  }
}

/**
 * Desktop-shell implementation over the preload bridge. Native notifications
 * need no web permission, so the state is always granted; the click callback
 * rides the bridge's id-echoed click channel (one persistent listener, id
 * lookup per click).
 */
export class DesktopNotificationSink implements NotificationSink {
  private readonly clicks = new Map<string, () => void>()
  private seq = 0

  constructor(private readonly bridge: DesktopNotificationBridge) {
    bridge.onNotificationClick((id) => {
      const onClick = this.clicks.get(id)
      if (onClick !== undefined) this.clicks.delete(id)
      onClick?.()
    })
  }

  readonly supported = true

  permission(): NotificationPermissionState {
    return 'granted'
  }

  requestPermission(): Promise<NotificationPermissionState> {
    return Promise.resolve('granted')
  }

  show(title: string, body: string, onClick: () => void): void {
    const id = `dsh-notification-${this.seq += 1}`
    this.clicks.set(id, onClick)
    this.bridge.notify({ id, title, body })
  }
}

/**
 * Pick the sink for the current environment: the Electron bridge when the
 * desktop shell exposed it, otherwise the browser Notification API.
 * @returns the environment-appropriate sink.
 */
export function createNotificationSink(): NotificationSink {
  const bridge = desktopBridge()
  if (bridge?.notify !== undefined) return new DesktopNotificationSink(bridge)
  return new BrowserNotificationSink()
}
