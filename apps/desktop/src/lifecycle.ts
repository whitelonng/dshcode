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
