import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import {
  Config,
  PluginControlGateway,
  apply,
  inject,
  type Config as PluginControlConfig,
  type PluginControlSpec,
} from '../src/index.ts'
import { readUninstalledControls, writePluginControlState, writePluginControlUninstalled } from '../src/control-file.ts'

const contexts: Context[] = []
const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const activePlugin: Plugin.Function = () => {}

async function harness(entryCount = 2): Promise<{
  ctx: Context
  entryIds: string[]
  path: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-control-'))
  tempRoots.push(root)
  const path = join(root, 'cordis.patch.yml')
  await writeFile(path, '[]\n')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  const entryIds: string[] = []
  for (let index = 0; index < entryCount; index += 1) {
    entryIds.push(await ctx.loader.create({ name: 'cordis:active' }))
  }
  return { ctx, entryIds, path }
}

function control(
  entryIds: string[],
  options: { id?: string; name?: string; repository?: string; packages?: string[] } = {},
): PluginControlSpec {
  return {
    id: options.id ?? 'fixture',
    name: options.name ?? 'Fixture plugin',
    repository: options.repository ?? 'https://example.com/plugin',
    entryIds,
    packages: options.packages ?? entryIds.map(entryId => `pkg-${entryId}`),
  }
}

function config(path: string, entryIds: string[]): PluginControlConfig {
  return {
    profilePatchPath: path,
    controls: [control(entryIds)],
  }
}

function successfulValue(result: Awaited<ReturnType<ConnectionRpcHandler>>): unknown {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) throw new Error(`missing fixture value at index ${index}`)
  return value
}

describe('PluginControlGateway', () => {
  it('registers one loopback-only channel through the plugin lifecycle', async () => {
    const h = await harness(1)
    let handler: ConnectionRpcHandler | undefined
    const handle = vi.fn<HostConnectionHandle['rpc']['handle']>((channel, next) => {
      expect(channel).toBe('/plugin-control')
      handler = next
      return async () => {}
    })
    h.ctx.provide('connection', { rpc: { handle, intercept: vi.fn() } })

    const fiber = h.ctx.plugin({ Config, inject, apply }, config(h.path, h.entryIds))
    await fiber.await()
    expect(handle).toHaveBeenCalledOnce()
    if (handler === undefined) throw new Error('plugin-control handler was not registered')
    expect(successfulValue(await handler('list', {}, new AbortController().signal))).toMatchObject({
      controls: [{ id: 'fixture', state: 'enabled' }],
    })

    await fiber.dispose()
  })

  it('projects enabled, mixed, disabled, and not-yet-mounted aggregate states', async () => {
    const h = await harness(2)
    const gateway = new PluginControlGateway(h.ctx, config(h.path, h.entryIds))
    expect(gateway.list().controls[0]?.state).toBe('enabled')

    await h.ctx.loader.update(requiredAt(h.entryIds, 0), { disabled: true })
    expect(gateway.list().controls[0]?.state).toBe('mixed')
    await h.ctx.loader.update(requiredAt(h.entryIds, 1), { disabled: true })
    expect(gateway.list().controls[0]?.state).toBe('disabled')

    await h.ctx.loader.remove(requiredAt(h.entryIds, 0))
    await h.ctx.loader.remove(requiredAt(h.entryIds, 1))
    // Rows absent from the Loader mean the product was never enabled: off, not broken.
    expect(gateway.list().controls[0]?.state).toBe('disabled')
  })

  it('reports duplicate mounted local ids as unavailable', async () => {
    const h = await harness(1)
    const gateway = new PluginControlGateway(h.ctx, config(h.path, h.entryIds))
    const entry = h.ctx.loader.resolve(requiredAt(h.entryIds, 0))
    const entries = vi.spyOn(h.ctx.loader, 'entries').mockImplementation(function* () {
      yield entry
      yield entry
    })

    expect(gateway.list().controls[0]?.state).toBe('unavailable')
    const result = await gateway.handle(
      'set-enabled', { pluginId: 'fixture', enabled: false }, new AbortController().signal,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('ambiguous control request unexpectedly succeeded')
    expect(result.error.message).toContain('(2 matches)')
    entries.mockRestore()
  })

  it('preserves user YAML and serializes restart-time settings without mutating the running tree', async () => {
    const h = await harness(2)
    await writeFile(h.path, `# user-owned comment
- id: manual
  config:
    value: !!js ctx.value
`)
    const gateway = new PluginControlGateway(h.ctx, config(h.path, h.entryIds))

    const [disabled, enabled] = await Promise.all([
      gateway.handle('set-enabled', { pluginId: 'fixture', enabled: false }, new AbortController().signal),
      gateway.handle('set-enabled', { pluginId: 'fixture', enabled: true }, new AbortController().signal),
    ])
    expect(disabled.ok).toBe(true)
    expect(enabled.ok).toBe(true)
    expect(gateway.list().controls[0]?.state).toBe('enabled')
    expect(h.entryIds.map(entryId => h.ctx.loader.resolve(entryId).disabled)).toEqual([false, false])

    const text = await readFile(h.path, 'utf8')
    expect(text).toContain('# user-owned comment')
    expect(text).toContain('value: !!js ctx.value')
    expect(text.match(/# dsh-plugin-control: fixture/g)).toHaveLength(1)
    expect(text).toContain('insert:')
    expect(text.match(/disabled: false/g)).toHaveLength(2)
    expect(text).toContain('name: pkg-')
    expect(text).not.toContain('disabled: true')
  })

  it('rejects malformed requests, cancellation, unavailable controls, and invalid YAML without mutation', async () => {
    const h = await harness(1)
    const gateway = new PluginControlGateway(h.ctx, config(h.path, h.entryIds))
    await expect(gateway.handle('list', { extra: true }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(gateway.handle('unknown', {}, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(gateway.handle('set-enabled', { pluginId: '', enabled: true }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })

    const cancelled = new AbortController()
    cancelled.abort(new Error('left'))
    await expect(gateway.handle('set-enabled', { pluginId: 'fixture', enabled: false }, cancelled.signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
    await expect(gateway.handle('uninstall', { pluginId: '' }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(gateway.handle('uninstall', { pluginId: 'fixture' }, cancelled.signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
    const unknown = await gateway.handle(
      'set-enabled', { pluginId: 'missing', enabled: false }, new AbortController().signal,
    )
    expect(unknown.ok).toBe(false)
    if (unknown.ok) throw new Error('unknown control request unexpectedly succeeded')
    expect(unknown.error).toMatchObject({ code: 'internal' })
    expect(unknown.error.message).toContain('unknown')

    await h.ctx.loader.remove(requiredAt(h.entryIds, 0))
    const absentRows = await gateway.handle(
      'set-enabled', { pluginId: 'fixture', enabled: false }, new AbortController().signal,
    )
    expect(absentRows.ok).toBe(true)
    // Disabling an unmounted product writes nothing: absent rows are already off.
    expect(await readFile(h.path, 'utf8')).toBe('[]\n')
    const firstEnable = await gateway.handle(
      'set-enabled', { pluginId: 'fixture', enabled: true }, new AbortController().signal,
    )
    expect(firstEnable.ok).toBe(true)
    const written = await readFile(h.path, 'utf8')
    expect(written).toContain('insert:')
    expect(written).toContain('name: pkg-')
    expect(written).toContain('disabled: false')

    const h2 = await harness(1)
    const invalid = '- id: [not closed\n'
    await writeFile(h2.path, invalid)
    const invalidGateway = new PluginControlGateway(h2.ctx, config(h2.path, h2.entryIds))
    const invalidResult = await invalidGateway.handle(
      'set-enabled', { pluginId: 'fixture', enabled: false }, new AbortController().signal,
    )
    expect(invalidResult.ok).toBe(false)
    if (invalidResult.ok) throw new Error('invalid YAML request unexpectedly succeeded')
    expect(invalidResult.error).toMatchObject({ code: 'internal' })
    expect(invalidResult.error.message).toContain('invalid YAML')
    expect(await readFile(h2.path, 'utf8')).toBe(invalid)
    // list() reads the patch layer for uninstall markers and fails loud too.
    expect(() => { invalidGateway.list() }).toThrow('invalid YAML')
  })

  it('formats queued cancellation reasons without touching the profile', async () => {
    const h = await harness(1)
    const gateway = new PluginControlGateway(h.ctx, config(h.path, h.entryIds))
    for (const [reason, message] of [
      [new AggregateError([], 'empty aggregate'), 'empty aggregate'],
      [new AggregateError([new Error('nested'), 'plain'], 'outer'), 'outer: nested; plain'],
    ] as const) {
      const cancelled = new AbortController()
      const pending = gateway.handle(
        'set-enabled', { pluginId: 'fixture', enabled: false }, cancelled.signal,
      )
      cancelled.abort(reason)
      const result = await pending
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('queued cancelled request unexpectedly succeeded')
      expect(result.error.message).toBe(message)
    }
    expect(await readFile(h.path, 'utf8')).toBe('[]\n')
  })

  it('creates a missing patch, preserves unowned YAML items, and rejects wrong file types', async () => {
    const h = await harness(1)
    const persisted = {
      id: 'fixture',
      rows: h.entryIds.map(entryId => ({ entryId, package: `pkg-${entryId}` })),
    }
    await rm(h.path)
    await writePluginControlState(h.path, persisted, false)
    const created = await readFile(h.path, 'utf8')
    expect(created).toContain('insert:')
    expect(created).toContain('disabled: true')
    expect(created).toContain('name: pkg-')

    await writeFile(h.path, '- scalar\n- id: plain\n')
    await writePluginControlState(h.path, persisted, true)
    const preserved = await readFile(h.path, 'utf8')
    expect(preserved).toContain('- scalar')
    expect(preserved).toContain('id: plain')
    expect(preserved).toContain('disabled: false')

    await writeFile(h.path, '{}\n')
    await expect(writePluginControlState(h.path, persisted, true)).rejects.toThrow('top-level YAML array')

    const directory = `${h.path}.directory`
    await mkdir(directory)
    await expect(writePluginControlState(directory, persisted, true)).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('uninstalls a preset product, hides it from the list, and restores on re-enable', async () => {
    const h = await harness(1)
    const gateway = new PluginControlGateway(h.ctx, config(h.path, h.entryIds))
    const enabled = await gateway.handle(
      'set-enabled', { pluginId: 'fixture', enabled: true }, new AbortController().signal,
    )
    expect(enabled.ok).toBe(true)
    expect(gateway.list().controls).toHaveLength(1)

    const removedResult = await gateway.handle(
      'uninstall', { pluginId: 'fixture' }, new AbortController().signal,
    )
    expect(removedResult.ok).toBe(true)
    if (!removedResult.ok) throw new Error('uninstall request unexpectedly failed')
    const removed = removedResult.value as { controls: Array<{ id: string; name: string; repository: string; state: string }> }
    expect(removed.controls).toEqual([{
      id: 'fixture',
      name: 'Fixture plugin',
      repository: 'https://example.com/plugin',
      state: 'uninstalled',
    }])
    const text = await readFile(h.path, 'utf8')
    expect(text).toContain('uninstalled: true')
    expect(text).toContain('# dsh-plugin-control: fixture')
    expect(text).not.toContain('insert:')
    expect(readUninstalledControls(h.path)).toEqual(new Set(['fixture']))

    // A fresh gateway (a later boot) keeps the product uninstalled.
    const rebooted = new PluginControlGateway(h.ctx, config(h.path, h.entryIds))
    expect(rebooted.list().controls).toEqual([
      { id: 'fixture', name: 'Fixture plugin', repository: 'https://example.com/plugin', state: 'uninstalled' },
    ])

    // Re-enabling clears the uninstall marker and mounts the rows again.
    const restored = await gateway.handle(
      'set-enabled', { pluginId: 'fixture', enabled: true }, new AbortController().signal,
    )
    expect(restored.ok).toBe(true)
    const after = await readFile(h.path, 'utf8')
    expect(after).not.toContain('uninstalled: true')
    expect(after).toContain('insert:')
    expect(gateway.list().controls[0]?.state).toBe('enabled')

    const missing = await gateway.handle(
      'uninstall', { pluginId: 'missing' }, new AbortController().signal,
    )
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('unknown control uninstall unexpectedly succeeded')
    expect(missing.error.message).toContain('unknown')
  })

  it('treats a missing patch as no uninstalls and skips foreign markers', async () => {
    const h = await harness(1)
    const absent = join(h.path, '..', 'absent.yml')
    expect(readUninstalledControls(absent)).toEqual(new Set())

    await writeFile(h.path, `- scalar
- id: plain
# dsh-plugin-control:
- uninstalled: true
# dsh-plugin-control: other
- uninstalled: nope
# dsh-plugin-control: block
- uninstalled: true
  extra: 1
# dsh-plugin-control: scalarfalse
- uninstalled: false
  extra: 1
`)
    expect(readUninstalledControls(h.path)).toEqual(new Set(['block']))

    const directory = `${h.path}.directory`
    await mkdir(directory)
    expect(() => { readUninstalledControls(directory) }).toThrow(/EISDIR|illegal operation/)
    await expect(writePluginControlUninstalled(directory, 'fixture')).rejects.toThrow(/EISDIR|illegal operation/)

    await rm(h.path)
    await writePluginControlUninstalled(h.path, 'fixture')
    expect(await readFile(h.path, 'utf8')).toContain('uninstalled: true')
  })

  it('writes and reads uninstall markers while preserving unowned items', async () => {
    const h = await harness(1)
    await writeFile(h.path, '# user comment\n- id: plain\n')
    await writePluginControlUninstalled(h.path, 'fixture')
    const text = await readFile(h.path, 'utf8')
    expect(text).toContain('# user comment')
    expect(text).toContain('id: plain')
    expect(text).toContain('uninstalled: true')
    expect(readUninstalledControls(h.path)).toEqual(new Set(['fixture']))

    await writeFile(h.path, '{}\n')
    expect(() => readUninstalledControls(h.path)).toThrow('top-level YAML array')
    await expect(writePluginControlUninstalled(h.path, 'fixture')).rejects.toThrow('top-level YAML array')

    await writeFile(h.path, '- id: [not closed\n')
    expect(() => readUninstalledControls(h.path)).toThrow('invalid YAML')
    await expect(writePluginControlUninstalled(h.path, 'fixture')).rejects.toThrow('invalid YAML')
  })

  it('fails loud on ambiguous or unsafe deployment catalogs', async () => {
    const h = await harness(2)
    expect(() => new PluginControlGateway(h.ctx, config('relative.yml', h.entryIds)))
      .toThrow('profilePatchPath must be absolute')
    expect(() => new PluginControlGateway(h.ctx, {
      profilePatchPath: h.path,
      controls: [control(h.entryIds, { id: 'bad id' })],
    })).toThrow('invalid control id')
    expect(() => new PluginControlGateway(h.ctx, {
      profilePatchPath: h.path,
      controls: [control(h.entryIds), control(['other'])],
    })).toThrow('duplicate control id')
    expect(() => new PluginControlGateway(h.ctx, {
      profilePatchPath: h.path,
      controls: [control(h.entryIds, { name: ' padded ' })],
    })).toThrow('surrounding whitespace in its name')
    expect(() => new PluginControlGateway(h.ctx, {
      profilePatchPath: h.path,
      controls: [control(h.entryIds, { repository: 'not a URL' })],
    })).toThrow('invalid repository URL')
    expect(() => new PluginControlGateway(h.ctx, {
      profilePatchPath: h.path,
      controls: [control(h.entryIds, { repository: 'file:///tmp/plugin' })],
    })).toThrow('must use HTTP(S)')
    expect(() => new PluginControlGateway(h.ctx, {
      profilePatchPath: h.path,
      controls: [control([' padded '])],
    })).toThrow('surrounding whitespace in an entry id')
    expect(() => new PluginControlGateway(h.ctx, {
      profilePatchPath: h.path,
      controls: [control(h.entryIds, { packages: ['only-one'] })],
    })).toThrow('one package per entry id')
    expect(() => new PluginControlGateway(h.ctx, {
      profilePatchPath: h.path,
      controls: [control(h.entryIds, { packages: h.entryIds.map(() => ' padded ') })],
    })).toThrow('surrounding whitespace in a package name')
    expect(() => new PluginControlGateway(h.ctx, {
      profilePatchPath: h.path,
      controls: [
        control([requiredAt(h.entryIds, 0)]),
        control([requiredAt(h.entryIds, 0)], { id: 'second' }),
      ],
    })).toThrow('belongs to more than one control')
  })
})
