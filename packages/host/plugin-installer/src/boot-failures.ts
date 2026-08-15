/**
 * Bounded boot-failure records and the safe-mode marker under the Harness
 * home. The record file is a per-plugin ring: writes replace the plugin's
 * previous record, keep at most {@link MAX_BOOT_FAILURE_RECORDS}, truncate
 * fields, age out records older than {@link BOOT_FAILURE_RETENTION_MS}, and
 * stay under a whole-file byte cap — so the file is bounded by construction
 * and needs no background cleanup task. The desktop shell and the installer
 * gateway share this module; a corrupted file fails loud except where the
 * caller documents a diagnostic-only degradation.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Failure kinds the recovery path records. */
export type BootFailureKind = 'load-failure' | 'hang' | 'late-rejection'

/** One recorded startup failure attributable to an installed plugin. */
export interface BootFailureRecord {
  /** Installed plugin id (package name); empty for unattributable failures. */
  pluginId: string
  /** How the failure surfaced: a load error, a boot timeout, or a late rejection. */
  kind: BootFailureKind
  /** Truncated failure summary shown in dialogs and the plugin list. */
  message: string
  /** Truncated original stack kept for the repair agent. */
  stack: string
  /** Absolute install directory of the plugin, when known; empty otherwise. */
  installPath: string
  /** ISO timestamp of the failure. */
  at: string
}

/** Durable failures-file shape. */
export interface BootFailuresFile {
  version: 1
  failures: BootFailureRecord[]
}

/** Failures filename under the Harness home. */
export const BOOT_FAILURES_FILENAME = 'boot-failures.json'

/** Safe-mode marker filename under the Harness home. */
export const SAFE_MODE_FILENAME = 'safe-mode'

/** Ring cap: how many failure records the file keeps (newest first). */
export const MAX_BOOT_FAILURE_RECORDS = 8

/** Per-record message cap (dialog and list summaries). */
export const MAX_BOOT_FAILURE_MESSAGE = 2_000

/** Per-record stack cap (repair-agent input). */
export const MAX_BOOT_FAILURE_STACK = 16_000

/**
 * Whole-file cap: the ring drops oldest records until the file fits. The
 * per-record caps alone bound the file near 145 KB at the ring maximum, so
 * this hard bound only engages for maximally large records.
 */
const MAX_BOOT_FAILURES_BYTES = 100_000

/** Record retention: older records are swept at write and read time. */
const BOOT_FAILURE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Resolve the failures-file path under a Harness home.
 * @param home - the Harness home.
 * @returns the absolute failures-file path.
 */
export function bootFailuresPath(home: string): string {
  return join(home, BOOT_FAILURES_FILENAME)
}

/**
 * Resolve the safe-mode marker path under a Harness home.
 * @param home - the Harness home.
 * @returns the absolute marker path.
 */
export function safeModePath(home: string): string {
  return join(home, SAFE_MODE_FILENAME)
}

/**
 * Whether the safe-mode marker exists.
 * @param home - the Harness home.
 * @returns true when the marker file is present.
 */
export function readSafeMode(home: string): boolean {
  return existsSync(safeModePath(home))
}

/**
 * Create or remove the safe-mode marker.
 * @param home - the Harness home.
 * @param enabled - whether safe mode should be active at the next launch.
 * @returns resolution after the marker write settles.
 */
export async function setSafeMode(home: string, enabled: boolean): Promise<void> {
  const path = safeModePath(home)
  if (enabled) {
    mkdirSync(dirname(path), { recursive: true })
    await writeFileAtomic(path, 'enabled\n', { mode: 0o600 })
  } else {
    await rm(path, { force: true })
  }
}

/** Cap one text field at its record limit. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

/** Validate one parsed record, failing loud on a corrupted file. */
function parseRecord(value: unknown, index: number): BootFailureRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`plugin-installer: boot failure record ${String(index)} must be a mapping`)
  }
  const record = value as Record<string, unknown>
  if (typeof record.pluginId !== 'string' || typeof record.message !== 'string'
    || typeof record.stack !== 'string' || typeof record.installPath !== 'string'
    || typeof record.at !== 'string'
    || (record.kind !== 'load-failure' && record.kind !== 'hang' && record.kind !== 'late-rejection')) {
    throw new Error(`plugin-installer: boot failure record ${String(index)} is invalid`)
  }
  return record as unknown as BootFailureRecord
}

/**
 * Read the recorded failures; an absent file parses as an empty list, a
 * malformed file throws (fail loud — a corrupt diagnostics file must be
 * repaired, not silently dropped).
 * @param home - the Harness home.
 * @returns the recorded failures, newest first.
 */
export function readBootFailures(home: string): BootFailureRecord[] {
  const path = bootFailuresPath(home)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const parsed = JSON.parse(raw) as Partial<BootFailuresFile>
  if (!Array.isArray(parsed.failures)) {
    throw new Error(`plugin-installer: ${path} must contain a failures array`)
  }
  return parsed.failures.map((record, index) => parseRecord(record, index))
}

/**
 * Drop records whose timestamp is missing or older than the retention window.
 * @param records - the records to sweep.
 * @param now - the sweep instant (epoch ms).
 * @returns the surviving records.
 */
export function agePrune(records: readonly BootFailureRecord[], now: number): BootFailureRecord[] {
  return records.filter((record) => {
    const at = Date.parse(record.at)
    return !Number.isNaN(at) && now - at <= BOOT_FAILURE_RETENTION_MS
  })
}

/** Drop oldest records until the serialized file fits the byte cap (keeps at least one). */
function fitByteCap(records: readonly BootFailureRecord[]): BootFailureRecord[] {
  const result = [...records]
  while (result.length > 1
    && Buffer.byteLength(JSON.stringify({ version: 1, failures: result } satisfies BootFailuresFile)) > MAX_BOOT_FAILURES_BYTES) {
    result.pop()
  }
  return result
}

/** Serialize the ring under the failures-file path. */
async function writeBootFailures(home: string, failures: BootFailureRecord[]): Promise<void> {
  const path = bootFailuresPath(home)
  mkdirSync(dirname(path), { recursive: true })
  await writeFileAtomic(path, JSON.stringify({ version: 1, failures } satisfies BootFailuresFile, undefined, 2) + '\n', { mode: 0o600 })
}

/**
 * Record one failure, replacing any previous record for the same plugin.
 * The record is truncated to the field caps and the ring keeps at most
 * {@link MAX_BOOT_FAILURE_RECORDS} newest records within retention.
 * @param home - the Harness home.
 * @param record - the failure to record; `at` defaults to now when empty.
 * @returns resolution after the atomic write settles.
 */
export async function writeBootFailure(home: string, record: BootFailureRecord): Promise<void> {
  const now = Date.now()
  const next: BootFailureRecord[] = [
    {
      pluginId: record.pluginId,
      kind: record.kind,
      message: truncate(record.message, MAX_BOOT_FAILURE_MESSAGE),
      stack: truncate(record.stack, MAX_BOOT_FAILURE_STACK),
      installPath: record.installPath,
      at: record.at === '' ? new Date(now).toISOString() : record.at,
    },
    ...agePrune(readBootFailures(home), now).filter(existing => existing.pluginId !== record.pluginId),
  ].slice(0, MAX_BOOT_FAILURE_RECORDS)
  await writeBootFailures(home, fitByteCap(next))
}

/**
 * Remove every recorded failure for one plugin (uninstall or a successful
 * re-enable). A plugin with no record writes nothing.
 * @param home - the Harness home.
 * @param pluginId - the plugin whose records to drop.
 * @returns resolution after the atomic write settles.
 */
export async function clearBootFailures(home: string, pluginId: string): Promise<void> {
  const existing = readBootFailures(home)
  const remaining = existing.filter(record => record.pluginId !== pluginId)
  if (remaining.length === existing.length) return
  await writeBootFailures(home, remaining)
}

/**
 * Sweep the ring for records older than the retention window and persist the
 * shrink. A missing or malformed file degrades to an empty list without
 * failing the caller (a diagnostics file must never block startup recovery).
 * @param home - the Harness home.
 * @param now - the sweep instant (epoch ms), injectable for tests.
 * @returns the surviving records after the sweep.
 */
export async function pruneBootFailures(home: string, now: number = Date.now()): Promise<BootFailureRecord[]> {
  let existing: BootFailureRecord[]
  try {
    existing = readBootFailures(home)
  } catch (error) {
    console.error(`plugin-installer: cannot sweep ${bootFailuresPath(home)}: ${String(error)}`)
    return []
  }
  const surviving = agePrune(existing, now)
  if (surviving.length === existing.length) return surviving
  await writeBootFailures(home, surviving)
  return surviving
}
