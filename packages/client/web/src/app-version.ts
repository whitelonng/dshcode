/**
 * The running product version as a display fact for the shell chrome. Two
 * carriers, in precedence order: the desktop preload bridge carries the
 * packaged application's own version (the version the user downloaded —
 * authoritative for the desktop artifact), and a browser-served GUI falls
 * back to the host's boot graph version (`window.__DSH_BOOT__`, injected
 * before the shell bundle runs; wire single source: WebBootGraph in
 * dsh-client-modules). The shell owns the `Window.dshDesktop` declaration
 * (DesktopTitleBar.tsx), so the bridge read needs no cast; the boot graph
 * stays wire-raw `unknown` until the kernel parses it, so the caption read
 * narrows the one member it consumes.
 */
import type { DshWindow } from '@deepseek-ai/dsh-client-modules/client'

/**
 * Resolve the product version to display.
 * @returns the version string, or undefined when neither carrier has one
 * (isolated tests; callers render nothing).
 */
export function appVersion(): string | undefined {
  const bridge = window.dshDesktop
  if (bridge !== undefined && bridge.appVersion !== '') return bridge.appVersion
  const boot = (window as unknown as DshWindow).__DSH_BOOT__
  if (typeof boot !== 'object' || boot === null) return undefined
  const version = (boot as Record<string, unknown>).version
  return typeof version === 'string' && version !== '' ? version : undefined
}
