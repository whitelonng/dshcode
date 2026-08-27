/** Basename-location walk behavior: exact matches, exclusions, tiers, bounds, and abort. */

import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCATE_EXCLUDED_DIRECTORIES, locateByName, validateLocateOptions } from '../src/locate.ts'

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-picker-'))
  await mkdir(join(root, 'sub', 'nested'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(root, 'report.txt'), 'a')
  await writeFile(join(root, 'sub', 'report.txt'), 'b')
  await writeFile(join(root, 'sub', 'nested', 'other.txt'), 'c')
  await writeFile(join(root, 'node_modules', 'pkg', 'report.txt'), 'd')
  return root
}

describe('locateByName', () => {
  it('returns absolute paths for every exact-basename file match in walk order', async () => {
    const root = await fixture()
    const hits = await locateByName(root, 'report.txt')
    expect(hits).toEqual([join(root, 'report.txt'), join(root, 'sub', 'report.txt')])
  })

  it('drops leading directories from the needle and ignores directories of the same name', async () => {
    const root = await fixture()
    const hits = await locateByName(root, 'some/prefix/report.txt')
    expect(hits).toEqual([join(root, 'report.txt'), join(root, 'sub', 'report.txt')])
  })

  it('never descends excluded directories by default', async () => {
    const root = await fixture()
    const hits = await locateByName(root, 'report.txt')
    expect(hits.some(path => path.includes('node_modules'))).toBe(false)
  })

  it('replaces the default exclusions with a custom list', async () => {
    const root = await fixture()
    const hits = await locateByName(root, 'report.txt', { excludedDirectories: ['sub'] })
    // `sub` is excluded; node_modules is no longer excluded by the custom list.
    expect(hits).toEqual([join(root, 'report.txt'), join(root, 'node_modules', 'pkg', 'report.txt')])
  })

  it('bounds results with maxResults', async () => {
    const root = await fixture()
    const hits = await locateByName(root, 'report.txt', { maxResults: 1 })
    expect(hits).toEqual([join(root, 'report.txt')])
  })

  it('appends the system-wide tier only when the walk underfills, deduplicated', async () => {
    const root = await fixture()
    const system = [join(root, 'sub', 'report.txt'), join(root, 'elsewhere', 'report.txt')]
    const hits = await locateByName(root, 'report.txt', { maxResults: 4, systemSearch: async () => system })
    expect(hits).toEqual([
      join(root, 'report.txt'),
      join(root, 'sub', 'report.txt'),
      join(root, 'elsewhere', 'report.txt'),
    ])
  })

  it('stops the system-wide tier once the result bound is reached', async () => {
    const root = await fixture()
    const system = [join(root, 'a.txt'), join(root, 'b.txt')]
    const hits = await locateByName(root, 'report.txt', { maxResults: 3, systemSearch: async () => system })
    expect(hits).toEqual([
      join(root, 'report.txt'),
      join(root, 'sub', 'report.txt'),
      join(root, 'a.txt'),
    ])
  })

  it('returns empty for a blank or dot needle without walking', async () => {
    const root = await fixture()
    await expect(locateByName(root, '')).resolves.toEqual([])
    await expect(locateByName(root, '.')).resolves.toEqual([])
    await expect(locateByName(root, '..')).resolves.toEqual([])
  })

  it('returns empty when nothing matches', async () => {
    const root = await fixture()
    await expect(locateByName(root, 'missing.txt')).resolves.toEqual([])
  })

  it('rejects on abort', async () => {
    const root = await fixture()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(locateByName(root, 'report.txt', {}, controller.signal)).rejects.toThrow('cancelled')
  })

  it('stops descending once maxEntries directories were visited', async () => {
    const root = await fixture()
    // Only the root is visited; the sub/ and nested/ matches are never seen.
    const hits = await locateByName(root, 'report.txt', { maxEntries: 1 })
    expect(hits).toEqual([join(root, 'report.txt')])
  })

  it('skips an unreadable directory and keeps matching elsewhere', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-file-picker-locked-'))
    await mkdir(join(root, 'locked'))
    await writeFile(join(root, 'locked', 'report.txt'), 'locked')
    await writeFile(join(root, 'ok.txt'), 'ok')
    await chmod(join(root, 'locked'), 0o000)
    try {
      const hits = await locateByName(root, 'report.txt')
      expect(hits).toEqual([])
    } finally {
      await chmod(join(root, 'locked'), 0o755)
    }
  })
})

describe('validateLocateOptions', () => {
  it('accepts a full valid options object', () => {
    expect(() => { validateLocateOptions({ maxResults: 3, maxEntries: 9, excludedDirectories: ['dist'] }) }).not.toThrow()
  })

  it('rejects a non-positive maxResults', () => {
    expect(() => { validateLocateOptions({ maxResults: 0 }) }).toThrow('maxResults')
  })

  it('rejects a non-positive maxEntries', () => {
    expect(() => { validateLocateOptions({ maxEntries: 0 }) }).toThrow('maxEntries')
  })

  it('rejects an excluded-directory basename carrying a separator', () => {
    expect(() => { validateLocateOptions({ excludedDirectories: ['a/b'] }) }).toThrow('excludedDirectories')
  })
})

describe('defaults', () => {
  it('ships .git and node_modules as default exclusions', () => {
    expect(DEFAULT_LOCATE_EXCLUDED_DIRECTORIES).toEqual(['.git', 'node_modules'])
  })
})
