// @vitest-environment jsdom
/** Settings tab registration smoke: localized tab + wire face. */

import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyHostEntry } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { PluginInstallerTab } from '../src/client/PluginInstallerTab.tsx'
import type { PluginInstallerTabInjected } from '../src/client/PluginInstallerTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const SNAPSHOT = {
  plugins: [{
    id: 'a', name: '@scope/a', version: '1.0.0',
    source: { kind: 'npm', spec: '@scope/a' }, installedAt: 'x', enabled: true,
  }],
}
const INVENTORY = {
  entries: [{ entryId: 'ui-builtin', moduleName: '@deepseek-ai/dsh-client-ui-builtin', enabled: true, fiberPhase: 'active' }],
}
type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const CONTROLS = {
    controls: [{ id: 'genui', name: 'dsh-genui', repository: 'https://github.com/omdsh-dev/dsh-genui', state: 'disabled' }],
  }
  const call = vi.fn<ConnectionHandle['rpc']['call']>()
    .mockImplementation(async (channel, endpoint) => {
      if (channel === '/plugin-control') {
        return { ok: true, value: CONTROLS }
      }
      if (endpoint === 'install' || endpoint === 'update' || endpoint === 'set-enabled') {
        return { ok: true, value: { plugin: SNAPSHOT.plugins[0] } }
      }
      if (endpoint === 'status') {
        return { ok: true, value: { progress: { kind: 'idle', stage: 'fetch' } } }
      }
      return { ok: true, value: SNAPSHOT }
    })
  class ConnectionService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'connection')
      Object.assign(this, { isLoopback: true, rpc: { call } })
    }
  }
  new ConnectionService(ctx)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const inventoryList = vi.fn<() => Promise<RemoteResult<typeof INVENTORY>>>()
    .mockResolvedValue({ ok: true, value: INVENTORY })
  ctx.provide('remote.pluginInventory', { list: inventoryList })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, call, inventoryList }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) throw new Error(`missing fixture value at index ${index}`)
  return value
}

describe('ui-settings-plugin-installer browser plugin', () => {
  it('keeps the Host loader entry inert', () => {
    expect(applyHostEntry).toBeTypeOf('function')
    applyHostEntry()
  })

  it('registers the localized tab without reading channels eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = requiredAt(b.slots.entries('settings.plugins.tab'), 0)
    expect(entry.component).toBe(PluginInstallerTab)
    expect(entry.options).toMatchObject({ id: 'plugins', order: 10 })
    expect(resolveSlotLabel(entry.options.label)).toBe('插件列表')
    expect(b.call).not.toHaveBeenCalled()
    expect(b.inventoryList).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => PluginInstallerTabInjected)()
    expect(injected.isLoopback).toBe(true)
    await expect(injected.list()).resolves.toEqual(SNAPSHOT.plugins)
    expect(b.call).toHaveBeenLastCalledWith('/plugin-installer', 'list', {})
    await expect(injected.install('@scope/b')).resolves.toEqual(SNAPSHOT.plugins[0])
    expect(b.call).toHaveBeenLastCalledWith('/plugin-installer', 'install', { spec: '@scope/b' })
    await expect(injected.update('a')).resolves.toEqual(SNAPSHOT.plugins[0])
    expect(b.call).toHaveBeenLastCalledWith('/plugin-installer', 'update', { id: 'a' })
    await expect(injected.uninstall('a')).resolves.toEqual(SNAPSHOT.plugins)
    expect(b.call).toHaveBeenLastCalledWith('/plugin-installer', 'uninstall', { id: 'a' })
    await expect(injected.setEnabled('a', false)).resolves.toEqual(SNAPSHOT.plugins[0])
    expect(b.call).toHaveBeenLastCalledWith('/plugin-installer', 'set-enabled', { id: 'a', enabled: false })
    b.call.mockResolvedValueOnce({ ok: true, value: { updates: [{ id: 'a', current: '1', latest: '2' }] } })
    await expect(injected.checkUpdates()).resolves.toEqual([{ id: 'a', current: '1', latest: '2' }])
    expect(b.call).toHaveBeenLastCalledWith('/plugin-installer', 'check-updates', {})
    await expect(injected.status()).resolves.toEqual({ kind: 'idle', stage: 'fetch' })
    expect(b.call).toHaveBeenLastCalledWith('/plugin-installer', 'status', {})
    await expect(injected.inventoryList()).resolves.toEqual(INVENTORY)
    expect(b.inventoryList).toHaveBeenCalledOnce()
    await expect(injected.controlsList()).resolves.toEqual([
      { id: 'genui', name: 'dsh-genui', repository: 'https://github.com/omdsh-dev/dsh-genui', state: 'disabled' },
    ])
    expect(b.call).toHaveBeenLastCalledWith('/plugin-control', 'list', {})
    await expect(injected.controlsSetEnabled('genui', true)).resolves.toHaveLength(1)
    expect(b.call).toHaveBeenLastCalledWith('/plugin-control', 'set-enabled', { pluginId: 'genui', enabled: true })
    await expect(injected.controlsUninstall('genui')).resolves.toHaveLength(1)
    expect(b.call).toHaveBeenLastCalledWith('/plugin-control', 'uninstall', { pluginId: 'genui' })
    b.call.mockImplementationOnce(async () => ({
      ok: false,
      error: { code: 'internal', message: 'boom', details: {} },
    }))
    await expect(injected.controlsSetEnabled('genui', false)).rejects.toThrow('plugin-control set-enabled failed: internal: boom')

    b.call.mockResolvedValueOnce({
      ok: false,
      error: { code: 'internal', message: 'boom', details: {} },
    })
    await expect(injected.install('x')).rejects.toThrow('plugin-installer install failed: internal: boom')
    b.inventoryList.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.inventoryList()).rejects.toThrow('pluginInventory.list failed: REMOTE_ERROR: unavailable')
    await b.ctx.fiber.dispose()
  })

  it('follows locale and survives declaration reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    const first = requiredAt(b.slots.entries('settings.plugins.tab'), 0)
    b.locale.setLocale('en')
    expect(resolveSlotLabel(first.options.label)).toBe('Plugin list')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(PluginInstallerTab)
    })
    await fiber.dispose()
  })
})
