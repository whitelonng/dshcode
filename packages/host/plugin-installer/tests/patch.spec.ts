/** Profile patch-layer row management tests. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { insertPluginRow, removePluginRow } from '../src/patch.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function patchFile(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-patch-'))
  tempRoots.push(root)
  const path = join(root, 'cordis.patch.yml')
  await writeFile(path, content, 'utf8')
  return path
}

describe('profile patch rows', () => {
  it('inserts a managed row and preserves unowned content and comments', async () => {
    const path = await patchFile(`# my patch layer
- id: existing
  name: '@deepseek-ai/dsh-base'
`)
    await insertPluginRow(path, '@example/demo')

    const text = await readFile(path, 'utf8')
    expect(text).toContain('# my patch layer')
    expect(text).toContain('- id: existing')
    expect(text).toContain('# dsh-plugin-installer: @example/demo')
    expect(text).toContain('id: "@example/demo"')
  })

  it('is idempotent for an already managed row', async () => {
    const path = await patchFile('[]\n')
    await insertPluginRow(path, '@example/demo')
    const once = await readFile(path, 'utf8')
    await insertPluginRow(path, '@example/demo')
    expect(await readFile(path, 'utf8')).toBe(once)
  })

  it('creates the file when absent and removes only managed rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-patch-missing-'))
    tempRoots.push(root)
    const path = join(root, 'cordis.patch.yml')
    await insertPluginRow(path, 'demo')
    expect(await readFile(path, 'utf8')).toContain('id: demo')

    const withRows = await patchFile(`- id: keep
`)
    await insertPluginRow(withRows, 'demo')
    await removePluginRow(withRows, 'demo')
    const text = await readFile(withRows, 'utf8')
    expect(text).not.toContain('demo')
    expect(text).toContain('id: keep')
  })

  it('fails loud on invalid YAML and tolerates a missing file on removal', async () => {
    const path = await patchFile('{ not an array')
    await expect(insertPluginRow(path, 'demo')).rejects.toThrow('invalid YAML')
    await expect(removePluginRow(path, 'demo')).rejects.toThrow('invalid YAML')

    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-patch-remove-missing-'))
    tempRoots.push(root)
    await removePluginRow(join(root, 'absent.yml'), 'demo')
  })
})
