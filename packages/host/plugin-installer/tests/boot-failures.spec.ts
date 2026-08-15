/** Bounded boot-failure ring and safe-mode marker tests. */

import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agePrune,
  bootFailuresPath,
  clearBootFailures,
  MAX_BOOT_FAILURE_MESSAGE,
  MAX_BOOT_FAILURE_RECORDS,
  MAX_BOOT_FAILURE_STACK,
  pruneBootFailures,
  readBootFailures,
  readSafeMode,
  safeModePath,
  setSafeMode,
  writeBootFailure,
  type BootFailureRecord,
} from '../src/boot-failures.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-boot-failures-'))
  tempRoots.push(root)
  return root
}

function record(pluginId: string, at = new Date().toISOString()): BootFailureRecord {
  return { pluginId, kind: 'load-failure', message: `boom ${pluginId}`, stack: `at ${pluginId}`, installPath: `/x/${pluginId}`, at }
}

describe('boot failure records', () => {
  it('reads an absent file as an empty list', async () => {
    expect(readBootFailures(await home())).toEqual([])
  })

  it('writes a record with now-timestamp defaults and truncated fields', async () => {
    const dir = await home()
    const long = 'x'.repeat(MAX_BOOT_FAILURE_MESSAGE + 100)
    const deep = 'y'.repeat(MAX_BOOT_FAILURE_STACK + 100)
    await writeBootFailure(dir, { pluginId: 'a', kind: 'hang', message: long, stack: deep, installPath: '/p/a', at: '' })

    const records = readBootFailures(dir)
    expect(records).toHaveLength(1)
    expect(records[0]?.message).toHaveLength(MAX_BOOT_FAILURE_MESSAGE)
    expect(records[0]?.stack).toHaveLength(MAX_BOOT_FAILURE_STACK)
    expect(records[0]?.kind).toBe('hang')
    expect(records[0]?.at).not.toBe('')
    const persisted = JSON.parse(await readFile(bootFailuresPath(dir), 'utf8')) as { version: number; failures: unknown[] }
    expect(persisted.version).toBe(1)
  })

  it('replaces the previous record of the same plugin at the front', async () => {
    const dir = await home()
    const later = new Date(Date.now() + 60_000).toISOString()
    await writeBootFailure(dir, record('a'))
    await writeBootFailure(dir, record('b'))
    await writeBootFailure(dir, record('a', later))

    const records = readBootFailures(dir)
    expect(records.map(entry => entry.pluginId)).toEqual(['a', 'b'])
    expect(records[0]?.at).toBe(later)
  })

  it('keeps at most the newest records of the ring', async () => {
    const dir = await home()
    for (let index = 0; index < MAX_BOOT_FAILURE_RECORDS + 3; index += 1) {
      await writeBootFailure(dir, record(`p${String(index)}`))
    }
    const records = readBootFailures(dir)
    expect(records).toHaveLength(MAX_BOOT_FAILURE_RECORDS)
    expect(records[0]?.pluginId).toBe(`p${String(MAX_BOOT_FAILURE_RECORDS + 2)}`)
  })

  it('drops oldest records to stay under the whole-file byte cap', async () => {
    const dir = await home()
    const big = 'z'.repeat(MAX_BOOT_FAILURE_STACK)
    for (let index = 0; index < MAX_BOOT_FAILURE_RECORDS; index += 1) {
      await writeBootFailure(dir, { ...record(`big${String(index)}`), message: 'm', stack: big })
    }
    const records = readBootFailures(dir)
    expect(records.length).toBeGreaterThan(0)
    expect(records.length).toBeLessThan(MAX_BOOT_FAILURE_RECORDS)
    expect(records[0]?.pluginId).toBe(`big${String(MAX_BOOT_FAILURE_RECORDS - 1)}`)
  })

  it('clears one plugin and writes nothing when the plugin has no record', async () => {
    const dir = await home()
    await writeBootFailure(dir, record('a'))
    await writeBootFailure(dir, record('b'))
    await clearBootFailures(dir, 'a')
    expect(readBootFailures(dir).map(entry => entry.pluginId)).toEqual(['b'])
    await clearBootFailures(dir, 'a')
    expect(readBootFailures(dir).map(entry => entry.pluginId)).toEqual(['b'])
  })

  it('prunes records older than the retention window and persists the shrink', async () => {
    const dir = await home()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(bootFailuresPath(dir), JSON.stringify({
      version: 1,
      failures: [record('old', '2025-10-01T00:00:00.000Z'), record('new', '2026-01-02T00:00:00.000Z')],
    }), 'utf8')
    const now = Date.parse('2026-02-01T00:00:00.000Z')
    const surviving = await pruneBootFailures(dir, now)
    expect(surviving.map(entry => entry.pluginId)).toEqual(['new'])
    expect(readBootFailures(dir).map(entry => entry.pluginId)).toEqual(['new'])
  })

  it('degrades a missing or malformed file to an empty sweep', async () => {
    const dir = await home()
    expect(await pruneBootFailures(dir)).toEqual([])
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { writeFile } = await import('node:fs/promises')
    await writeFile(bootFailuresPath(dir), '{not json', 'utf8')
    expect(await pruneBootFailures(dir)).toEqual([])
    expect(errorSpy).toHaveBeenCalled()
  })

  it('fails loud on a malformed record file', async () => {
    const dir = await home()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(bootFailuresPath(dir), JSON.stringify({ version: 1, failures: [{ pluginId: 'a' }] }), 'utf8')
    expect(() => readBootFailures(dir)).toThrow(/record 0 is invalid/)
    await writeFile(bootFailuresPath(dir), JSON.stringify({ version: 1, failures: 'nope' }), 'utf8')
    expect(() => readBootFailures(dir)).toThrow(/failures array/)
    await writeFile(bootFailuresPath(dir), JSON.stringify({ version: 1, failures: [null] }), 'utf8')
    expect(() => readBootFailures(dir)).toThrow(/must be a mapping/)
    // Every string field present but an unknown kind still fails validation.
    await writeFile(bootFailuresPath(dir), JSON.stringify({
      version: 1,
      failures: [{ pluginId: 'a', message: 'm', stack: 's', installPath: '/x', at: 't', kind: 'bogus' }],
    }), 'utf8')
    expect(() => readBootFailures(dir)).toThrow(/record 0 is invalid/)
  })

  it('drops records whose timestamp is missing or unparsable', () => {
    const kept = { ...record('kept'), at: '2026-01-01T00:00:00.000Z' }
    const now = Date.parse('2026-02-01T00:00:00.000Z')
    expect(agePrune([kept, { ...record('stale'), at: '2000-01-01T00:00:00.000Z' }, { ...record('broken'), at: 'x' }], now))
      .toEqual([kept])
  })
})

describe('safe-mode marker', () => {
  it('round-trips on and off', async () => {
    const dir = await home()
    expect(readSafeMode(dir)).toBe(false)
    await setSafeMode(dir, true)
    expect(readSafeMode(dir)).toBe(true)
    expect(await readFile(safeModePath(dir), 'utf8')).toContain('enabled')
    await setSafeMode(dir, false)
    expect(readSafeMode(dir)).toBe(false)
  })
})
