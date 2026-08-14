import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginInventoryGateway, { Config } from '../src/index.ts'
import type { PluginEntryId } from '../src/types.ts'

const contexts: Context[] = []
const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
  patchPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-inventory-'))
  tempRoots.push(root)
  const patchPath = join(root, 'cordis.patch.yml')
  await writeFile(patchPath, '[]\n', 'utf8')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  await ctx.plugin(PluginInventoryGateway, { profilePatchPath: patchPath })
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory, patchPath }
}

describe('PluginInventoryGateway', () => {
  it('publishes list and set-enabled under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'setEnabled', exportName: 'set-enabled', invocation: { kind: 'direct' } },
    ])
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('persists enablement on the patch layer and overlays it on list', async () => {
    const { ctx, inventory, patchPath } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' }) as PluginEntryId

    const disabled = await inventory.setEnabled({ entryId: activeId, enabled: false })
    expect(disabled.entries.find(entry => entry.entryId === activeId)).toMatchObject({
      enabled: false,
      fiberPhase: 'active',
    })
    expect(await readFile(patchPath, 'utf8')).toContain(`dsh-plugin-inventory: ${activeId}`)
    expect(await readFile(patchPath, 'utf8')).toContain('disabled: true')

    const reenabled = await inventory.setEnabled({ entryId: activeId, enabled: true })
    expect(reenabled.entries.find(entry => entry.entryId === activeId)?.enabled).toBe(true)
    expect(await readFile(patchPath, 'utf8')).toContain('disabled: false')
  })

  it('rejects enablement of entries that are not uniquely mounted', async () => {
    const { inventory } = await harness()
    await expect(inventory.setEnabled({ entryId: 'ghost' as PluginEntryId, enabled: false }))
      .rejects.toThrow('not uniquely mounted')
  })

  it('rejects a non-absolute profile patch path at construction', async () => {
    expect(() => new PluginInventoryGateway(new Context(), { profilePatchPath: 'relative.yml' }))
      .toThrow('profilePatchPath must be absolute')
  })

  it('has the namespace-plugin export shape (no stray default)', () => {
    expect(Config).toBeTypeOf('function')
  })
})
