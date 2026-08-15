/** Startup-failure attribution and recovery decisions for the desktop shell. */

import { join } from 'node:path'
import {
  clearBootFailures,
  fallbackModulesDir,
  readBootFailures,
  readPluginRowEnabled,
  writeBootFailure,
  type InstalledPluginRecord,
} from '@deepseek-ai/dsh-host-plugin-installer'

/** How long the desktop waits for the profile tree to settle before declaring a hang. */
export const DESKTOP_BOOT_TIMEOUT_MS = 60_000

/** Boot attempts after which the recovery dialog defaults to safe mode. */
export const CONSECUTIVE_FAILURE_THRESHOLD = 3

/** Error raised by the boot watchdog when the tree never settles. */
export class BootHangError extends Error {
  override readonly name = 'BootHangError'
}

/**
 * Race a boot promise against a watchdog timer. The tree keeps running after
 * a timeout; the caller owns teardown (the desktop exits or relaunches).
 * @param promise - the boot operation.
 * @param ms - timeout in milliseconds.
 * @returns the boot result.
 * @throws {BootHangError} when the promise does not settle within `ms`.
 */
export function withBootTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new BootHangError(`desktop boot did not settle within ${String(ms)} ms`))
    }, ms)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // Reject with the original Error so callers keep its identity; a
        // non-Error rejection reason becomes a labelled Error.
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * Extract the human-readable message and stack of a thrown value. A value
 * that is not an Error has no stack of its own; its text stands for both.
 * @param error - the thrown value.
 * @returns the message and stack.
 */
export function failureMessage(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? error.message }
  const text = String(error)
  return { message: text, stack: text }
}

/**
 * Attribute a load failure to the installed plugins whose names appear in
 * the failure text: the Loader's activation audit names every failed entry
 * (`entry.options.name`), so a user-installed plugin that failed to import
 * or activate names itself.
 * @param error - the boot failure.
 * @param installed - the recorded installed plugins.
 * @returns the matching installed plugin ids, in installed-list order.
 */
export function attributeLoadFailure(
  error: unknown,
  installed: readonly InstalledPluginRecord[],
): string[] {
  const { message, stack } = failureMessage(error)
  const text = `${message}\n${stack}`
  return installed
    .map(plugin => plugin.name)
    .filter(name => name !== '' && text.includes(name))
}

/**
 * The plugins suspected of a boot hang: those installed or updated after the
 * last successful boot. Without a known-ok reference no plugin is suspected.
 * @param installed - the recorded installed plugins.
 * @param lastOkAt - ISO timestamp of the last successful boot, when known.
 * @returns the suspect plugin ids, in installed-list order.
 */
export function hangSuspects(
  installed: readonly InstalledPluginRecord[],
  lastOkAt: string | undefined,
): string[] {
  if (lastOkAt === undefined) return []
  const lastOk = Date.parse(lastOkAt)
  if (Number.isNaN(lastOk)) return []
  return installed
    .filter(plugin => Date.parse(plugin.installedAt) > lastOk)
    .map(plugin => plugin.name)
}

/** How a failed boot classifies for the recovery dialog. */
type RecoveryKind = 'attributable' | 'unattributable'

/** The recovery-relevant facts of one failed boot. */
export interface RecoveryDecision {
  /** Whether at least one installed plugin can be blamed and disabled. */
  kind: RecoveryKind
  /** The plugin ids to offer disabling, in installed-list order. */
  pluginIds: string[]
  /** The failure message for the dialog and the record. */
  message: string
  /** The failure stack for the repair agent. */
  stack: string
  /** Whether the boot failed by watchdog timeout rather than a thrown error. */
  hang: boolean
}

/**
 * Decide how to recover one failed boot: attribute it to installed plugins
 * (a thrown load failure names itself; a hang blames plugins installed after
 * the last successful boot) or leave it unattributable.
 * @param input - the thrown error (or watchdog timeout) and the attribution inputs.
 * @returns the recovery decision.
 */
export function recoveryDecision(input: {
  error: unknown
  installed: readonly InstalledPluginRecord[]
  lastOkAt: string | undefined
}): RecoveryDecision {
  const hang = input.error instanceof BootHangError
  const { message, stack } = failureMessage(input.error)
  const pluginIds = hang
    ? hangSuspects(input.installed, input.lastOkAt)
    : attributeLoadFailure(input.error, input.installed)
  return {
    kind: pluginIds.length > 0 ? 'attributable' : 'unattributable',
    pluginIds,
    message,
    stack,
    hang,
  }
}

/**
 * Persist one failure record per blamed plugin, with the install directory
 * derived from the shared module fallback.
 * @param home - the Harness home.
 * @param decision - the recovery decision.
 * @returns resolution after the records settle.
 */
export async function recordBootFailures(home: string, decision: RecoveryDecision): Promise<void> {
  const fallbackDir = fallbackModulesDir(home)
  const now = new Date().toISOString()
  for (const pluginId of decision.pluginIds) {
    await writeBootFailure(home, {
      pluginId,
      kind: decision.hang ? 'hang' : 'load-failure',
      message: decision.message,
      stack: decision.stack,
      installPath: join(fallbackDir, pluginId),
      at: now,
    })
  }
}

/**
 * Drop the recorded failures of every plugin that is enabled again after a
 * successful boot: the plugin loaded, so its old failure no longer applies.
 * @param home - the Harness home.
 * @param profilePatchPath - the profile's user patch layer.
 * @returns resolution after the clears settle.
 */
export async function clearResolvedFailures(home: string, profilePatchPath: string): Promise<void> {
  for (const record of readBootFailures(home)) {
    if (record.pluginId === '') continue
    if (!readPluginRowEnabled(profilePatchPath, record.pluginId)) continue
    await clearBootFailures(home, record.pluginId)
  }
}
