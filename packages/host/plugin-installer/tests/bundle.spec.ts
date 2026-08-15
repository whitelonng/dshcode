/** Bundle-style plugin patch-row management tests. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bundlePatchPath,
  mergeBundleRows,
  readBundleLayerEnabled,
  removeBundleRows,
  setBundleLayerEnabled,
  setBundleRowsEnabled,
} from '../src/bundle.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function patchFile(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-bundle-patch-'))
  tempRoots.push(root)
  const path = join(root, 'cordis.patch.yml')
  await writeFile(path, content, 'utf8')
  return path
}

/** A second temp file (the installed bundle plugin's own patch). */
async function bundleFile(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-bundle-own-patch-'))
  tempRoots.push(root)
  const path = join(root, 'cordis.patch.yml')
  await writeFile(path, content, 'utf8')
  return path
}

describe('bundlePatchPath', () => {
  it('resolves the declared dsh.bundle.patch against the installed directory', () => {
    const manifest = { name: '@scope/demo', dsh: { bundle: { patch: './cordis.patch.yml' } } }
    expect(bundlePatchPath(manifest, '/installed/@scope/demo')).toBe('/installed/@scope/demo/cordis.patch.yml')
  })

  it('returns undefined for plain plugins and malformed declarations', () => {
    expect(bundlePatchPath({ name: '@scope/demo' }, '/installed')).toBeUndefined()
    expect(bundlePatchPath({ name: '@scope/demo', dsh: {} }, '/installed')).toBeUndefined()
    expect(bundlePatchPath({ name: '@scope/demo', dsh: { bundle: {} } }, '/installed')).toBeUndefined()
    expect(bundlePatchPath({ name: '@scope/demo', dsh: { bundle: { patch: 42 } } }, '/installed')).toBeUndefined()
    expect(bundlePatchPath({ name: '@scope/demo', dsh: { bundle: { patch: '' } } }, '/installed')).toBeUndefined()
  })
})

describe('bundle patch rows', () => {
  it('merges unclaimed insert rows with the bundle marker and preserves unowned content', async () => {
    const path = await patchFile(`# my patch layer
- id: existing
  name: '@deepseek-ai/dsh-base'
`)
    const bundle = await bundleFile(`# from self
- insert:
    - id: ui-compat
      name: '@scope/demo'
- insert:
    - id: ui-new
      name: '@scope/dep-a'
`)
    await mergeBundleRows(path, bundle, '@scope/demo')

    const text = await readFile(path, 'utf8')
    expect(text).toContain('# my patch layer')
    expect(text).toContain('id: existing')
    expect(text).toContain('# dsh-plugin-bundle: @scope/demo')
    expect(text).toContain('id: ui-compat')
    expect(text).toContain('id: ui-new')
    expect(text).toContain("name: '@scope/dep-a'")
  })

  it('skips insert rows whose ids the profile patch already claims', async () => {
    const path = await patchFile(`# dsh-plugin-control: web-ui
[{ insert: [ { id: ui-taken, name: "@scope/dep-b", disabled: true } ] }]
`)
    const bundle = await bundleFile(`- insert:
    - id: ui-taken
      name: '@scope/dep-b'
    - id: ui-fresh
      name: '@scope/dep-a'
`)
    await mergeBundleRows(path, bundle, '@scope/demo')

    const text = await readFile(path, 'utf8')
    // The preset row stays the single owner of ui-taken; only ui-fresh merges.
    expect(text.match(/ui-taken/g)).toHaveLength(1)
    expect(text).toContain('id: ui-fresh')
  })

  it('re-merges replace the plugin\'s earlier rows and keep the file idempotent', async () => {
    const path = await patchFile('[]\n')
    const first = await bundleFile(`- insert:
    - id: ui-old
      name: '@scope/dep-a'
`)
    const second = await bundleFile(`- insert:
    - id: ui-old
      name: '@scope/dep-a'
    - id: ui-newer
      name: '@scope/dep-b'
`)
    await mergeBundleRows(path, first, '@scope/demo')
    await mergeBundleRows(path, second, '@scope/demo')

    const text = await readFile(path, 'utf8')
    expect(text.match(/dsh-plugin-bundle: @scope\/demo/g)).toHaveLength(1)
    expect(text).toContain('id: ui-newer')
  })

  it('appends bare override rows verbatim', async () => {
    const path = await patchFile('[]\n')
    const bundle = await bundleFile(`- insert:
    - id: ui-new
      name: '@scope/dep-a'
- id: some-app-entry
  disabled: true
`)
    await mergeBundleRows(path, bundle, '@scope/demo')

    const text = await readFile(path, 'utf8')
    expect(text).toContain('id: some-app-entry')
    expect(text).toContain('disabled: true')
  })

  it('round-trips !!js expressions from the bundle patch', async () => {
    const path = await patchFile('[]\n')
    const bundle = await bundleFile(`- insert:
    - id: ui-js
      name: '@scope/dep-a'
      config:
        root: !!js process.env.X
`)
    await mergeBundleRows(path, bundle, '@scope/demo')

    const text = await readFile(path, 'utf8')
    expect(text).toContain('!!js process.env.X')
  })

  it('fails loud when the declared bundle patch file is missing', async () => {
    const path = await patchFile('[]\n')
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-bundle-patch-missing-'))
    tempRoots.push(root)
    await expect(mergeBundleRows(path, join(root, 'cordis.patch.yml'), '@scope/demo'))
      .rejects.toThrow('bundle patch')
    await expect(mergeBundleRows(path, join(root, 'cordis.patch.yml'), '@scope/demo'))
      .rejects.toThrow('is missing')
  })

  it('removes only the plugin\'s own bundle rows', async () => {
    const path = await patchFile('[]\n')
    const ours = await bundleFile(`- insert:
    - id: ui-ours
      name: '@scope/dep-a'
`)
    const theirs = await bundleFile(`- insert:
    - id: ui-theirs
      name: '@scope/dep-b'
`)
    await mergeBundleRows(path, ours, '@scope/demo')
    await mergeBundleRows(path, theirs, '@scope/other')

    await removeBundleRows(path, '@scope/demo')
    const text = await readFile(path, 'utf8')
    expect(text).not.toContain('# dsh-plugin-bundle: @scope/demo')
    expect(text).toContain('# dsh-plugin-bundle: @scope/other')
    expect(text).toContain('id: ui-theirs')
    expect(text).not.toContain('id: ui-ours')
  })

  it('toggles the disabled flag on every merged row', async () => {
    const path = await patchFile('[]\n')
    const bundle = await bundleFile(`- insert:
    - id: ui-a
      name: '@scope/dep-a'
    - id: ui-b
      name: '@scope/dep-b'
`)
    await mergeBundleRows(path, bundle, '@scope/demo')

    await setBundleRowsEnabled(path, '@scope/demo', false)
    let text = await readFile(path, 'utf8')
    expect(text.match(/disabled: true/g)).toHaveLength(2)
    expect(text.match(/id: ui-a/g)).toHaveLength(1)

    await setBundleRowsEnabled(path, '@scope/demo', true)
    text = await readFile(path, 'utf8')
    expect(text.match(/disabled: false/g)).toHaveLength(2)
  })

  it('tolerates removal without bundle rows and a missing patch file', async () => {
    const path = await patchFile(`- id: keep
`)
    // No rows merged for this plugin: removal is a no-op.
    const text = await readFile(path, 'utf8')
    await removeBundleRows(path, '@scope/demo')
    expect(await readFile(path, 'utf8')).toBe(text)

    // A missing patch file is also a no-op.
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-bundle-remove-missing-'))
    tempRoots.push(root)
    await removeBundleRows(join(root, 'absent.yml'), '@scope/demo')
  })

  it('propagates non-missing read failures unchanged', async () => {
    const path = await patchFile('[]\n')
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-bundle-read-error-'))
    tempRoots.push(root)
    // A directory at the patch path is a read failure (EISDIR), not a missing file.
    const directory = join(root, 'cordis.patch.yml')
    await mkdir(directory)
    await expect(mergeBundleRows(path, directory, '@scope/demo'))
      .rejects.toThrow('EISDIR')
    await expect(removeBundleRows(directory, '@scope/demo'))
      .rejects.toThrow('EISDIR')
  })

  it('toggles the disabled flag on merged bare rows', async () => {
    const path = await patchFile('[]\n')
    const bundle = await bundleFile(`- insert:
    - id: ui-a
      name: '@scope/dep-a'
- id: some-app-entry
`)
    await mergeBundleRows(path, bundle, '@scope/demo')
    await setBundleRowsEnabled(path, '@scope/demo', false)
    const text = await readFile(path, 'utf8')
    expect(text.match(/disabled: true/g)).toHaveLength(2)
  })

  it('skips non-map items and id-less rows in both files', async () => {
    // The profile patch carries a scalar item and an insert with a scalar row;
    // the bundle patch carries the same shapes plus an id-less row. None of
    // them claim or merge anything, and the valid row still lands.
    const path = await patchFile(`- 42
- insert:
    - 42
- id: keep
  name: '@deepseek-ai/dsh-base'
`)
    const bundle = await bundleFile(`- 42
- insert:
    - 42
    - name: no-id
- insert:
    - id: ui-ok
      name: '@scope/dep-a'
`)
    await mergeBundleRows(path, bundle, '@scope/demo')

    const text = await readFile(path, 'utf8')
    expect(text).toContain('# dsh-plugin-bundle: @scope/demo')
    expect(text).toContain('id: ui-ok')
    expect(text).not.toContain('no-id')
    expect(text).toContain('id: keep')
  })
})

describe('bundle layer enablement', () => {
  it('writes override rows for the bundle patch ids and removes them on enable', async () => {
    const path = await patchFile('[]\n')
    const bundle = await bundleFile(`- insert:
    - id: ui-a
      name: '@scope/demo'
`)
    await setBundleLayerEnabled(path, bundle, '@scope/demo', false)
    let text = await readFile(path, 'utf8')
    expect(text).toContain('# dsh-plugin-bundle: @scope/demo')
    expect(text).toContain('id: ui-a')
    expect(text).toContain('disabled: true')
    expect(readBundleLayerEnabled(path, '@scope/demo')).toBe(false)

    await setBundleLayerEnabled(path, bundle, '@scope/demo', true)
    text = await readFile(path, 'utf8')
    expect(text).not.toContain('# dsh-plugin-bundle: @scope/demo')
    expect(readBundleLayerEnabled(path, '@scope/demo')).toBe(true)
  })

  it('skips non-map and id-less rows and tolerates a missing patch', async () => {
    const path = await patchFile('[]\n')
    const bundle = await bundleFile(`- 42
- insert:
    - 42
    - name: no-id
`)
    // No usable ids: disabling is a no-op.
    await setBundleLayerEnabled(path, bundle, '@scope/demo', false)
    expect(await readFile(path, 'utf8')).toBe('[]\n')
    // A missing bundle patch is also a no-op.
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-bundle-layer-missing-'))
    tempRoots.push(root)
    await setBundleLayerEnabled(path, join(root, 'absent.yml'), '@scope/demo', false)

    // A directory at the patch path is a read failure, not a missing file.
    const directory = join(root, 'cordis.patch.yml')
    await mkdir(directory)
    await expect(setBundleLayerEnabled(path, directory, '@scope/demo', false)).rejects.toThrow('EISDIR')
  })

  it('ignores merged insert-form rows when reading enablement and tolerates errors', async () => {
    const path = await patchFile('[]\n')
    const merged = await bundleFile(`- insert:
    - id: ui-merged
      name: '@scope/demo'
`)
    await mergeBundleRows(path, merged, '@scope/demo')
    // A merged insert-form marker row never carries the disabled override.
    expect(readBundleLayerEnabled(path, '@scope/demo')).toBe(true)

    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-bundle-layer-read-'))
    tempRoots.push(root)
    expect(readBundleLayerEnabled(join(root, 'absent.yml'), '@scope/demo')).toBe(true)
    const directory = join(root, 'cordis.patch.yml')
    await mkdir(directory)
    expect(() => readBundleLayerEnabled(directory, '@scope/demo')).toThrow('EISDIR')
  })
})
