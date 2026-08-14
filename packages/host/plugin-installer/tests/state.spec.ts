/** Install-state persistence tests. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PluginInstallId } from '../src/types.ts'
import { pluginStatePath, readPluginState, writePluginState } from '../src/state.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-state-'))
  tempRoots.push(root)
  return root
}

const PLUGIN = {
  id: '@example/demo' as PluginInstallId,
  name: '@example/demo',
  version: '1.0.0',
  source: { kind: 'npm' as const, spec: '@example/demo' },
  installedAt: '2026-08-14T00:00:00.000Z',
}

describe('plugin install state', () => {
  it('round-trips the state file through the atomic writer', async () => {
    const root = await home()
    expect(readPluginState(root)).toEqual({ plugins: [] })

    await writePluginState(root, { plugins: [PLUGIN] })
    expect(readPluginState(root)).toEqual({ plugins: [PLUGIN] })
    expect(JSON.parse(await readFile(pluginStatePath(root), 'utf8'))).toEqual({ plugins: [PLUGIN] })
  })

  it('fails loud on a malformed state file', async () => {
    const root = await home()
    await writeFile(pluginStatePath(root), '{ not json', 'utf8')
    expect(() => readPluginState(root)).toThrow()
    await writeFile(pluginStatePath(root), JSON.stringify({ plugins: 'nope' }), 'utf8')
    expect(() => readPluginState(root)).toThrow('must contain a plugins array')
  })
})
