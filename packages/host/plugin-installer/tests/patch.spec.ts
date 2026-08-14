/** Profile patch-layer row management tests. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { insertPluginRow, readPluginRowEnabled, removePluginRow, setPluginRowEnabled } from '../src/patch.ts'

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
  it('inserts a managed insert row and preserves unowned content and comments', async () => {
    const path = await patchFile(`# my patch layer
- id: existing
  name: '@deepseek-ai/dsh-base'
`)
    await insertPluginRow(path, '@example/demo')

    const text = await readFile(path, 'utf8')
    expect(text).toContain('# my patch layer')
    expect(text).toContain('- id: existing')
    expect(text).toContain('# dsh-plugin-installer: @example/demo')
    expect(text).toContain('insert:')
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
    await expect(setPluginRowEnabled(path, 'demo', false)).rejects.toThrow('invalid YAML')
    expect(() => readPluginRowEnabled(path, 'demo')).toThrow('invalid YAML')

    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-patch-remove-missing-'))
    tempRoots.push(root)
    await removePluginRow(join(root, 'absent.yml'), 'demo')
  })

  it('reads and persists the saved enablement of a managed insert row', async () => {
    const path = await patchFile('[]\n')
    expect(readPluginRowEnabled(path, 'demo')).toBe(true)

    await setPluginRowEnabled(path, 'demo', false)
    expect(readPluginRowEnabled(path, 'demo')).toBe(false)
    expect(await readFile(path, 'utf8')).toContain('insert:')
    expect(await readFile(path, 'utf8')).toContain('disabled: true')
    expect(await readFile(path, 'utf8')).toContain('# dsh-plugin-installer: demo')

    await setPluginRowEnabled(path, 'demo', true)
    expect(readPluginRowEnabled(path, 'demo')).toBe(true)
    expect(await readFile(path, 'utf8')).toContain('disabled: false')
  })

  it('replaces a legacy bare row with the insert format on the next toggle', async () => {
    const path = await patchFile(`# dsh-plugin-installer: demo
- id: demo
  name: demo
  disabled: true
`)
    // The legacy bare row never mounted anything, so it reads as enabled.
    expect(readPluginRowEnabled(path, 'demo')).toBe(true)
    await setPluginRowEnabled(path, 'demo', false)
    const text = await readFile(path, 'utf8')
    expect(text).toContain('insert:')
    expect(text).not.toContain('id: demo\n  name: demo')
    expect(readPluginRowEnabled(path, 'demo')).toBe(false)
  })

  it('treats a missing patch file as an enabled plugin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-patch-enabled-missing-'))
    tempRoots.push(root)
    expect(readPluginRowEnabled(join(root, 'absent.yml'), 'demo')).toBe(true)
  })
})
