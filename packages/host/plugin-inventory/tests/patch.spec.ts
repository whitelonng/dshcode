import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSavedEnablements, writeSavedEnablement } from '../src/patch.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function patchFile(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-inventory-patch-'))
  tempRoots.push(root)
  const path = join(root, 'cordis.patch.yml')
  await writeFile(path, content, 'utf8')
  return path
}

describe('plugin-inventory patch rows', () => {
  it('reads nothing from a missing patch file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-inventory-patch-missing-'))
    tempRoots.push(root)
    expect(readSavedEnablements(join(root, 'absent.yml'))).toEqual([])
  })

  it('writes, replaces, and reads managed enablement rows preserving unowned content', async () => {
    const path = await patchFile(`# my patch layer
- id: existing
  name: '@deepseek-ai/dsh-base'
`)
    await writeSavedEnablement(path, 'ui-demo', false)
    await writeSavedEnablement(path, 'ui-demo', true)

    const text = await readFile(path, 'utf8')
    expect(text).toContain('# my patch layer')
    expect(text).toContain('- id: existing')
    expect(text).toContain('# dsh-plugin-inventory: ui-demo')
    expect(text).toContain('disabled: false')
    expect(readSavedEnablements(path)).toEqual([{ entryId: 'ui-demo', disabled: false }])
  })

  it('reads every managed row including hand-written markers', async () => {
    const path = await patchFile(`# dsh-plugin-inventory: ui-a
- id: ui-a
  disabled: true
# dsh-plugin-inventory: ui-b
- id: ui-b
  disabled: false
# dsh-plugin-inventory:
- id: ui-empty-marker
`)
    expect(readSavedEnablements(path)).toEqual([
      { entryId: 'ui-a', disabled: true },
      { entryId: 'ui-b', disabled: false },
    ])
  })

  it('fails loud on invalid YAML and non-array roots', async () => {
    const broken = await patchFile('{ not an array')
    expect(() => readSavedEnablements(broken)).toThrow('invalid YAML')
    await expect(writeSavedEnablement(broken, 'ui-demo', false)).rejects.toThrow('invalid YAML')

    const map = await patchFile('plugins: []\n')
    expect(() => readSavedEnablements(map)).toThrow('top-level YAML array')
    await expect(writeSavedEnablement(map, 'ui-demo', false)).rejects.toThrow('top-level YAML array')
  })
})
