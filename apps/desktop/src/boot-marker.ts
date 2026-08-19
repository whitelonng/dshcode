/** Boot lifecycle marker for the desktop shell: `started` vs `ok` per launch. */

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Marker filename under the Harness home. */
const BOOT_MARKER_FILENAME = 'boot-marker.json'

/** One persisted boot lifecycle record. */
export interface BootMarker {
  /** 'started' when a launch began but no `ok` write followed (crash or hang). */
  state: 'started' | 'ok'
  /** ISO timestamp of the last write. */
  at: string
  /** Process id of the run that wrote it. */
  pid?: number
  /** Consecutive startup attempts that never reached `ok`. */
  bootAttempts: number
}

/**
 * Resolve the marker path under a Harness home.
 * @param home - the Harness home.
 * @returns the absolute marker path.
 */
export function bootMarkerPath(home: string): string {
  return join(home, BOOT_MARKER_FILENAME)
}

/**
 * Read the previous boot marker. Absent, unreadable, or unparsable markers
 * mean "no prior boot record" and degrade to first-run behavior; a marker
 * can only be malformed by an external write, which must not block recovery.
 * @param home - the Harness home.
 * @returns the marker, or undefined when none is readable.
 */
export function readBootMarker(home: string): BootMarker | undefined {
  let raw: string
  try {
    raw = readFileSync(bootMarkerPath(home), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BootMarker>
    if (parsed.state !== 'started' && parsed.state !== 'ok') return undefined
    if (typeof parsed.at !== 'string') return undefined
    return {
      state: parsed.state,
      at: parsed.at,
      ...typeof parsed.pid === 'number' ? { pid: parsed.pid } : {},
      bootAttempts: typeof parsed.bootAttempts === 'number' ? parsed.bootAttempts : 0,
    }
  } catch {
    return undefined
  }
}

/**
 * Persist one boot lifecycle state. Writing `ok` resets the consecutive
 * failure counter; writing `started` continues it across failed launches
 * (a previous `ok` starts a fresh streak of 1).
 * @param home - the Harness home.
 * @param state - the state to persist.
 * @returns the marker as persisted.
 */
export async function writeBootMarker(home: string, state: 'started' | 'ok'): Promise<BootMarker> {
  const previous = readBootMarker(home)
  const marker: BootMarker = {
    state,
    at: new Date().toISOString(),
    pid: process.pid,
    bootAttempts: state === 'ok'
      ? 0
      : previous === undefined || previous.state === 'ok'
        ? 1
        : previous.bootAttempts + 1,
  }
  const path = bootMarkerPath(home)
  mkdirSync(dirname(path), { recursive: true })
  await writeFileAtomic(path, JSON.stringify(marker, undefined, 2) + '\n', { mode: 0o600 })
  return marker
}
