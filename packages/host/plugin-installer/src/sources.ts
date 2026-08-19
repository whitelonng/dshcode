/** Discovery-layer storage: `$DSH_HOME/plugin-sources/` source set, TOFU locks, and enumeration snapshots. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {
  EnumerateSnapshot,
  PluginLockEntry,
  PluginSourceRow,
  PluginSourceTrust,
} from './types.ts'

/** Discovery domain root under the Harness home. */
export const DISCOVERY_ROOT = 'plugin-sources'
/** Sources file name under the discovery root. */
export const SOURCES_FILE = 'sources.yml'
/** TOFU lock file name under the discovery root. */
export const LOCK_FILE = 'lock.yml'
const CACHE_DIR = 'cache'
const ENTRIES_FILE = 'entries.json'
const TRUST_LEVELS = new Set<PluginSourceTrust>(['official', 'community', 'untrusted'])

/** The default index source: the dsh-external hub catalog. */
export const DEFAULT_SOURCE_ID = 'hub'
/** The default index source locator. */
export const DEFAULT_SOURCE_LOCATOR = 'https://raw.githubusercontent.com/dsh-external/hub/main/catalog.json'

/**
 * The discovery domain root under a Harness home.
 * @param dshHome - the Harness home.
 * @returns the absolute discovery root.
 */
export function discoveryRoot(dshHome: string): string {
  return join(dshHome, DISCOVERY_ROOT)
}

/**
 * The sources file path.
 * @param dshHome - the Harness home.
 * @returns the absolute sources file path.
 */
export function sourcesPath(dshHome: string): string {
  return join(discoveryRoot(dshHome), SOURCES_FILE)
}

/**
 * The TOFU lock file path.
 * @param dshHome - the Harness home.
 * @returns the absolute lock file path.
 */
export function lockPath(dshHome: string): string {
  return join(discoveryRoot(dshHome), LOCK_FILE)
}

/**
 * The snapshot path of one source.
 * @param dshHome - the Harness home.
 * @param sourceId - the owning source id.
 * @returns the absolute entries file path.
 */
export function cacheEntriesPath(dshHome: string, sourceId: string): string {
  return join(discoveryRoot(dshHome), CACHE_DIR, sourceId, ENTRIES_FILE)
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Normalize and validate one raw source row.
 * @param raw - the row from sources.yml.
 * @param index - the row index (diagnostics only).
 * @returns the normalized source row.
 */
export function normalizeSource(raw: unknown, index: number): PluginSourceRow {
  const row = (raw ?? {}) as Record<string, unknown>
  if (typeof row.id !== 'string' || row.id.trim() === '') {
    throw new Error(`plugin-sources: sources[${index}] missing string "id"`)
  }
  if (typeof row.locator !== 'string' || row.locator.trim() === '') {
    throw new Error(`plugin-sources: sources[${index}] ("${row.id}") missing string "locator"`)
  }
  if (row.trust !== undefined && (typeof row.trust !== 'string' || !TRUST_LEVELS.has(row.trust as PluginSourceTrust))) {
    throw new Error(`plugin-sources: sources[${index}] ("${row.id}") trust must be one of official|community|untrusted`)
  }
  return {
    id: row.id.trim(),
    locator: row.locator.trim(),
    trust: (row.trust as PluginSourceTrust | undefined) ?? 'community',
  }
}

/**
 * Read the source set. An absent file parses as empty with the default hub
 * source seeded; a malformed file fails loud.
 * @param dshHome - the Harness home.
 * @returns the registered sources.
 */
export function readSources(dshHome: string): PluginSourceRow[] {
  const text = readText(sourcesPath(dshHome))
  if (text === null) {
    return [{ id: DEFAULT_SOURCE_ID, locator: DEFAULT_SOURCE_LOCATOR, trust: 'official' }]
  }
  let parsed: unknown
  try {
    parsed = parse(text)
  } catch (error: unknown) {
    throw new Error(`plugin-sources: ${SOURCES_FILE} is not valid YAML: ${String(error)}`)
  }
  if (parsed === null || parsed === undefined) return []
  const root = (parsed as { sources?: unknown }).sources
  if (!Array.isArray(root)) {
    throw new Error(`plugin-sources: ${SOURCES_FILE} must be a YAML object with a "sources" list`)
  }
  return root.map((raw, index) => normalizeSource(raw, index))
}

/**
 * Write the source set atomically under the file lock.
 * @param dshHome - the Harness home.
 * @param sources - the complete source list.
 */
export async function writeSources(dshHome: string, sources: PluginSourceRow[]): Promise<void> {
  mkdirSync(discoveryRoot(dshHome), { recursive: true })
  await withFileLock(sourcesPath(dshHome), async () => {
    const root = { sources }
    await writeFileAtomic(sourcesPath(dshHome), stringify(root), { mode: 0o600 })
  })
}

/**
 * Find one source by id.
 * @param sources - the registered sources.
 * @param id - the source id.
 * @returns the matching source row, or undefined.
 */
export function findSource(sources: PluginSourceRow[], id: string): PluginSourceRow | undefined {
  return sources.find(source => source.id === id)
}

/**
 * Append or replace one source (by id).
 * @param sources - the registered sources.
 * @param source - the source row to upsert.
 * @returns the source list with the row appended or replaced.
 */
export function upsertSource(sources: PluginSourceRow[], source: PluginSourceRow): PluginSourceRow[] {
  const rest = sources.filter(existing => existing.id !== source.id)
  return [...rest, source]
}

/**
 * Read the TOFU locks. An absent file parses as empty; a malformed file
 * fails loud.
 * @param dshHome - the Harness home.
 * @returns the recorded locks.
 */
export function readLock(dshHome: string): PluginLockEntry[] {
  const text = readText(lockPath(dshHome))
  if (text === null) return []
  let parsed: unknown
  try {
    parsed = parse(text)
  } catch (error: unknown) {
    throw new Error(`plugin-sources: ${LOCK_FILE} is not valid YAML: ${String(error)}`)
  }
  if (parsed === null || parsed === undefined) return []
  const root = (parsed as { locks?: unknown }).locks
  if (!Array.isArray(root)) {
    throw new Error(`plugin-sources: ${LOCK_FILE} must be a YAML object with a "locks" list`)
  }
  return root.map((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>
    if (typeof row.canonical !== 'string' || row.canonical.trim() === '') {
      throw new Error(`plugin-sources: locks[${index}] missing string "canonical"`)
    }
    if (row.kind !== 'bundle' && row.kind !== 'plugin') {
      throw new Error(`plugin-sources: locks[${index}] ("${row.canonical}") kind must be bundle|plugin`)
    }
    if (typeof row.ref !== 'string' || row.ref.trim() === '') {
      throw new Error(`plugin-sources: locks[${index}] ("${row.canonical}") missing string "ref"`)
    }
    return {
      canonical: row.canonical.trim(),
      kind: row.kind,
      ref: row.ref.trim(),
      ...(typeof row.hash === 'string' ? { hash: row.hash } : {}),
      recordedAt: typeof row.recordedAt === 'string' ? row.recordedAt : new Date().toISOString(),
    }
  })
}

/**
 * Write the TOFU locks atomically under the file lock.
 * @param dshHome - the Harness home.
 * @param locks - the complete lock list.
 */
export async function writeLock(dshHome: string, locks: PluginLockEntry[]): Promise<void> {
  mkdirSync(discoveryRoot(dshHome), { recursive: true })
  await withFileLock(lockPath(dshHome), async () => {
    const root = { locks }
    await writeFileAtomic(lockPath(dshHome), stringify(root), { mode: 0o600 })
  })
}

/**
 * Find one lock by canonical.
 * @param locks - the recorded locks.
 * @param canonical - the canonical source spec.
 * @returns the matching lock entry, or undefined.
 */
export function findLock(locks: PluginLockEntry[], canonical: string): PluginLockEntry | undefined {
  return locks.find(lock => lock.canonical === canonical)
}

/**
 * Append or replace one lock (by canonical).
 * @param locks - the recorded locks.
 * @param lock - the lock entry to upsert.
 * @returns the lock list with the entry appended or replaced.
 */
export function upsertLock(locks: PluginLockEntry[], lock: PluginLockEntry): PluginLockEntry[] {
  const rest = locks.filter(existing => existing.canonical !== lock.canonical)
  return [...rest, lock]
}

/**
 * Read one source's enumeration snapshot; null when absent or unreadable.
 * @param dshHome - the Harness home.
 * @param sourceId - the owning source id.
 * @returns the snapshot, or null.
 */
export function readSnapshot(dshHome: string, sourceId: string): EnumerateSnapshot | null {
  const text = readText(cacheEntriesPath(dshHome, sourceId))
  if (text === null) return null
  const parsed = JSON.parse(text) as EnumerateSnapshot
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`plugin-sources: cache/${sourceId}/entries.json is not valid`)
  }
  return parsed
}

/**
 * Write one source's enumeration snapshot (derived machine data).
 * @param dshHome - the Harness home.
 * @param sourceId - the owning source id.
 * @param snapshot - the snapshot value to persist.
 */
export function writeSnapshot(dshHome: string, sourceId: string, snapshot: EnumerateSnapshot): void {
  const path = cacheEntriesPath(dshHome, sourceId)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf8')
}

/**
 * Whether a snapshot is younger than the TTL.
 * @param snapshot - the snapshot.
 * @param ttlMs - the freshness window in milliseconds.
 * @param now - the current time (test seam).
 * @returns true when the snapshot fetchedAt is within the window.
 */
export function snapshotFresh(snapshot: EnumerateSnapshot, ttlMs: number, now = Date.now()): boolean {
  const fetched = Date.parse(snapshot.fetchedAt)
  if (Number.isNaN(fetched)) return false
  return now - fetched < ttlMs
}
