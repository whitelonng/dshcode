/** Discovery storage and enumeration tests. */

import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cacheEntriesPath,
  DEFAULT_SOURCE_ID,
  DEFAULT_SOURCE_LOCATOR,
  findLock,
  findSource,
  normalizeSource,
  readLock,
  readSnapshot,
  readSources,
  snapshotFresh,
  upsertLock,
  upsertSource,
  writeLock,
  writeSnapshot,
  writeSources,
} from '../src/sources.ts'
import { enumerateIndex, hubRepoToPlugin, INDEX_TTL_MS, parseGithubUrl, type FetchLike } from '../src/catalog.ts'
import type { EnumerateSnapshot, PluginSourceRow } from '../src/types.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-sources-'))
  tempRoots.push(root)
  return root
}

describe('readSources', () => {
  it('seeds the default hub source when the file is absent', () => {
    const dir = '/tmp/absent-sources'
    expect(readSources(dir)).toEqual([
      { id: DEFAULT_SOURCE_ID, locator: DEFAULT_SOURCE_LOCATOR, trust: 'official' },
    ])
  })

  it('round-trips the source set and validates rows', async () => {
    const h = await home()
    const sources: PluginSourceRow[] = [
      { id: 'hub', locator: 'https://example.com/catalog.json', trust: 'official' },
      { id: 'local', locator: '/tmp/local.json', trust: 'community' },
    ]
    await writeSources(h, sources)
    expect(readSources(h)).toEqual(sources)

    await writeFile(join(h, 'plugin-sources', 'sources.yml'), 'sources:\n  - id: x\n    locator: /x\n    trust: bogus\n', 'utf8')
    expect(() => readSources(h)).toThrow('trust must be one of official|community|untrusted')
    await writeFile(join(h, 'plugin-sources', 'sources.yml'), '{ not yaml\n', 'utf8')
    expect(() => readSources(h)).toThrow('not valid YAML')
    await writeFile(join(h, 'plugin-sources', 'sources.yml'), 'sources:\n  - locator: /x\n', 'utf8')
    expect(() => readSources(h)).toThrow('missing string "id"')
    await writeFile(join(h, 'plugin-sources', 'sources.yml'), 'sources:\n  - id: x\n', 'utf8')
    expect(() => readSources(h)).toThrow('missing string "locator"')
    await writeFile(join(h, 'plugin-sources', 'sources.yml'), 'sources:\n  - id: x\n    locator: \'\'\n', 'utf8')
    expect(() => readSources(h)).toThrow('missing string "locator"')
    await writeFile(join(h, 'plugin-sources', 'sources.yml'), 'null\n', 'utf8')
    expect(readSources(h)).toEqual([])
    await writeFile(join(h, 'plugin-sources', 'sources.yml'), 'sources: 42\n', 'utf8')
    expect(() => readSources(h)).toThrow('must be a YAML object with a "sources" list')
  })

  it('finds and upserts by id', () => {
    const sources: PluginSourceRow[] = [
      { id: 'a', locator: 'https://example.com/a.json', trust: 'official' },
    ]
    expect(findSource(sources, 'a')?.locator).toBe('https://example.com/a.json')
    expect(findSource(sources, 'b')).toBeUndefined()
    expect(upsertSource(sources, { id: 'a', locator: 'https://example.com/a2.json', trust: 'community' }))
      .toEqual([{ id: 'a', locator: 'https://example.com/a2.json', trust: 'community' }])
    expect(upsertSource(sources, { id: 'b', locator: 'https://example.com/b.json', trust: 'untrusted' })).toHaveLength(2)
  })

  it('normalizes a raw row with a default trust', () => {
    expect(normalizeSource({ id: 'x', locator: '/x.json' }, 0)).toEqual({ id: 'x', locator: '/x.json', trust: 'community' })
    expect(() => normalizeSource(null, 0)).toThrow('missing string "id"')
  })
})

describe('locks', () => {
  it('round-trips, finds, and upserts by canonical', async () => {
    const h = await home()
    await writeLock(h, [{
      canonical: '@scope/demo', kind: 'bundle', ref: 'github:o/r', recordedAt: '2026-08-15T00:00:00.000Z',
    }])
    expect(readLock(h)).toHaveLength(1)
    expect(findLock(readLock(h), '@scope/demo')?.ref).toBe('github:o/r')
    expect(findLock(readLock(h), 'ghost')).toBeUndefined()
    expect(upsertLock(readLock(h), {
      canonical: '@scope/demo', kind: 'plugin', ref: '@scope/demo', recordedAt: '2026-08-15T01:00:00.000Z',
    })).toHaveLength(1)
  })

  it('fails loud on malformed lock files and defaults missing fields', async () => {
    const h = await home()
    await mkdir(join(h, 'plugin-sources'), { recursive: true })
    await writeFile(join(h, 'plugin-sources', 'lock.yml'), 'locks:\n  - canonical: x\n    kind: bogus\n    ref: y\n', 'utf8')
    expect(() => readLock(h)).toThrow('kind must be bundle|plugin')
    await writeFile(join(h, 'plugin-sources', 'lock.yml'), '{ nope\n', 'utf8')
    expect(() => readLock(h)).toThrow('not valid YAML')
    await writeFile(join(h, 'plugin-sources', 'lock.yml'), 'null\n', 'utf8')
    expect(readLock(h)).toEqual([])
    await writeFile(join(h, 'plugin-sources', 'lock.yml'), 'locks: 42\n', 'utf8')
    expect(() => readLock(h)).toThrow('must be a YAML object with a "locks" list')
    await writeFile(join(h, 'plugin-sources', 'lock.yml'), 'locks:\n  - kind: plugin\n    ref: y\n', 'utf8')
    expect(() => readLock(h)).toThrow('missing string "canonical"')
    await writeFile(join(h, 'plugin-sources', 'lock.yml'), 'locks:\n  - canonical: x\n    kind: plugin\n', 'utf8')
    expect(() => readLock(h)).toThrow('missing string "ref"')
    await writeFile(join(h, 'plugin-sources', 'lock.yml'), 'locks:\n  - null\n', 'utf8')
    expect(() => readLock(h)).toThrow('missing string "canonical"')
    // Missing hash and recordedAt fall back to absent and now.
    await writeFile(join(h, 'plugin-sources', 'lock.yml'), 'locks:\n  - canonical: x\n    kind: plugin\n    ref: y\n    hash: 42\n    recordedAt: 42\n', 'utf8')
    const [lock] = readLock(h)
    expect(lock?.hash).toBeUndefined()
    expect(Number.isNaN(Date.parse(lock?.recordedAt ?? ''))).toBe(false)
    await writeFile(join(h, 'plugin-sources', 'lock.yml'), 'locks:\n  - canonical: x\n    kind: plugin\n    ref: y\n    hash: abc\n', 'utf8')
    expect(readLock(h)[0]?.hash).toBe('abc')
  })
})

describe('snapshots', () => {
  it('round-trips and ages snapshots', () => {
    const h = '/tmp/snapshot-home'
    const snapshot: EnumerateSnapshot = { fetchedAt: '2026-08-15T00:00:00.000Z', entries: [] }
    writeSnapshot(h, 'hub', snapshot)
    expect(readSnapshot(h, 'hub')).toEqual(snapshot)
    expect(readSnapshot(h, 'ghost')).toBeNull()
    expect(snapshotFresh(snapshot, INDEX_TTL_MS, Date.parse('2026-08-15T01:00:00.000Z'))).toBe(true)
    expect(snapshotFresh(snapshot, INDEX_TTL_MS, Date.parse('2026-08-16T00:00:00.000Z'))).toBe(false)
    expect(snapshotFresh({ fetchedAt: 'garbage', entries: [] }, INDEX_TTL_MS)).toBe(false)
  })

  it('fails loud on a malformed snapshot', () => {
    const h = '/tmp/snapshot-bad'
    expect(cacheEntriesPath(h, 'x')).toContain('plugin-sources')
    writeSnapshot(h, 'x', { fetchedAt: '2026-08-15T00:00:00.000Z', entries: [] })
    writeFileSync(cacheEntriesPath(h, 'x'), JSON.stringify({ fetchedAt: 'x', entries: 42 }), 'utf8')
    expect(() => readSnapshot(h, 'x')).toThrow('is not valid')
  })
})

describe('catalog transformation', () => {
  it('parses github URLs and transforms hub rows', () => {
    expect(parseGithubUrl('https://github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r' })
    expect(parseGithubUrl('https://github.com/o/r')).toEqual({ owner: 'o', repo: 'r' })
    expect(parseGithubUrl('https://gitlab.com/o/r')).toBeNull()
    expect(hubRepoToPlugin({ name: 'demo', url: 'https://github.com/o/r', bundle: true, skill: true }, 'hub'))
      .toEqual({ id: 'demo', kind: 'bundle', source: 'github:o/r', faces: ['skill', 'bundle'], sourceId: 'hub' })
    expect(hubRepoToPlugin({ name: 'plain', url: 'https://github.com/o/p' }, 'hub'))
      .toEqual({ id: 'plain', kind: 'plugin', source: 'github:o/p', faces: [], sourceId: 'hub' })
    expect(hubRepoToPlugin({ name: 'x' }, 'hub')).toBeNull()
    expect(hubRepoToPlugin({ name: 'x', url: 'https://gitlab.com/o/r' }, 'hub')).toBeNull()
  })
})

describe('enumerateIndex', () => {
  const now = Date.parse('2026-08-15T00:00:00.000Z')

  it('returns a fresh cached snapshot without fetching', async () => {
    const h = await home()
    const snapshot: EnumerateSnapshot = { fetchedAt: '2026-08-15T00:00:00.000Z', entries: [] }
    writeSnapshot(h, 'hub', snapshot)
    let fetched = false
    const spy: FetchLike = async () => { fetched = true; throw new Error('must not fetch') }
    const result = await enumerateIndex(h, { id: 'hub', locator: 'https://example.com/x.json', trust: 'official' }, { now, fetch: spy })
    expect(result).toEqual(snapshot)
    expect(fetched).toBe(false)
  })

  it('fetches a stale snapshot with an ETag and keeps entries on 304', async () => {
    const h = await home()
    const stale: EnumerateSnapshot = { fetchedAt: '2026-08-14T00:00:00.000Z', etag: '"v1"', entries: [] }
    writeSnapshot(h, 'hub', stale)
    const calls: string[] = []
    const spy: FetchLike = async (_url, init) => {
      calls.push(init?.headers?.['If-None-Match'] ?? '')
      return { ok: true, status: 304, etag: '"v1"', json: async () => ({ repos: [] }) }
    }
    const result = await enumerateIndex(h, { id: 'hub', locator: 'https://example.com/x.json', trust: 'official' }, { now, fetch: spy })
    expect(result.entries).toEqual([])
    expect(result.etag).toBe('"v1"')
    expect(calls).toEqual(['"v1"'])
  })

  it('fetches, transforms, and snapshots a full catalog', async () => {
    const h = await home()
    const spy: FetchLike = async () => ({
      ok: true,
      status: 200,
      etag: '"v2"',
      text: async () => '',
      json: async () => ({ repos: [{ name: 'demo', url: 'https://github.com/o/r', description: 'd' }] }),
    })
    const result = await enumerateIndex(h, { id: 'hub', locator: 'https://example.com/x.json', trust: 'official' }, { now, fetch: spy })
    expect(result.entries).toEqual([
      { id: 'demo', kind: 'plugin', source: 'github:o/r', faces: [], description: 'd', sourceId: 'hub' },
    ])
    expect(result.etag).toBe('"v2"')
    expect(readSnapshot(h, 'hub')?.entries).toHaveLength(1)
  })

  it('fetches through the runtime fetch when none is injected', async () => {
    const h = await home()
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ repos: [] }), { status: 200 }))
    const result = await enumerateIndex(h, { id: 'hub', locator: 'https://example.com/x.json', trust: 'official' }, { now })
    expect(result.entries).toEqual([])
    expect(result.etag).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('degrades malformed catalog shapes and null rows', async () => {
    const h = await home()
    const catalog = join(h, 'catalog.json')
    await writeFile(catalog, JSON.stringify({ repos: [null, 42] }), 'utf8')
    expect((await enumerateIndex(h, { id: 'local', locator: catalog, trust: 'untrusted' }, { now })).entries).toEqual([])
    await writeFile(catalog, JSON.stringify({}), 'utf8')
    expect((await enumerateIndex(h, { id: 'local', locator: catalog, trust: 'untrusted' }, { now, refresh: true })).entries).toEqual([])

    const spy: FetchLike = async () => ({ ok: true, status: 200, etag: null, json: async () => ({ repos: [null] }) })
    expect((await enumerateIndex(h, { id: 'remote', locator: 'https://example.com/x.json', trust: 'official' }, { now, fetch: spy })).entries).toEqual([])
    const nonArray: FetchLike = async () => ({ ok: true, status: 200, etag: null, json: async () => ({ repos: 'nope' }) })
    expect((await enumerateIndex(h, { id: 'remote2', locator: 'https://example.com/y.json', trust: 'official' }, { now, fetch: nonArray })).entries).toEqual([])
  })

  it('refreshes a fresh snapshot when refresh is forced', async () => {
    const h = await home()
    const fresh: EnumerateSnapshot = { fetchedAt: '2026-08-15T00:00:00.000Z', entries: [] }
    writeSnapshot(h, 'hub', fresh)
    let fetched = false
    const spy: FetchLike = async () => {
      fetched = true
      return { ok: true, status: 200, etag: null, json: async () => ({ repos: [] }) }
    }
    await enumerateIndex(h, { id: 'hub', locator: 'https://example.com/x.json', trust: 'official' }, { now, fetch: spy, refresh: true })
    expect(fetched).toBe(true)
  })

  it('keeps entries on 304 even when the cached snapshot has no etag', async () => {
    const h = await home()
    const stale: EnumerateSnapshot = { fetchedAt: '2026-08-14T00:00:00.000Z', entries: [] }
    writeSnapshot(h, 'hub', stale)
    const spy: FetchLike = async () => ({ ok: true, status: 304, etag: null, text: async () => '', json: async () => ({ repos: [] }) })
    const result = await enumerateIndex(h, { id: 'hub', locator: 'https://example.com/x.json', trust: 'official' }, { now, fetch: spy })
    expect(result.etag).toBeUndefined()
    expect(result.entries).toEqual([])
  })

  it('parses trailing-slash github URLs and rejects nameless rows', () => {
    expect(parseGithubUrl('https://github.com/o/r/')).toEqual({ owner: 'o', repo: 'r' })
    expect(hubRepoToPlugin({ url: 'https://github.com/o/r' }, 'hub')).toBeNull()
  })

  it('reads a local catalog file and rejects unreachable sources', async () => {
    const h = await home()
    const catalog = join(h, 'catalog.json')
    await writeFile(catalog, JSON.stringify({ repos: [{ name: 'local', url: 'https://github.com/o/l' }] }), 'utf8')
    const local = await enumerateIndex(h, { id: 'local', locator: catalog, trust: 'untrusted' }, { now })
    expect(local.entries).toHaveLength(1)

    const spy: FetchLike = async () => ({ ok: false, status: 404, etag: null, text: async () => '', json: async () => ({}) })
    await expect(enumerateIndex(h, { id: 'dead', locator: 'https://example.com/x.json', trust: 'official' }, { now, fetch: spy }))
      .rejects.toThrow('fetch failed (404)')
  })
})
