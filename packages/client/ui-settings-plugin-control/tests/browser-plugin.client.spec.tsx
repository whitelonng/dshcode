// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { PluginControlId } from '@deepseek-ai/dsh-api-remotes/client'
import { apply as applyHostEntry } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { PluginControlSettingsTab } from '../src/client/PluginControlSettingsTab.tsx'
import type { PluginControlSettingsTabInjected } from '../src/client/PluginControlSettingsTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const SNAPSHOT = {
  controls: [{ id: 'genui', name: 'dsh-genui', repository: 'https://example.com/genui', state: 'enabled' }],
} as const

async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const call = vi.fn<ConnectionHandle['rpc']['call']>()
    .mockResolvedValue({ ok: true, value: SNAPSHOT })
  class ConnectionService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'connection')
      Object.assign(this, {
        isLoopback,
        rpc: { call },
      })
    }
  }
  new ConnectionService(ctx)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, call }
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

describe('ui-settings-plugin-control browser plugin', () => {
  it('keeps the Host loader entry inert', () => {
    expect(applyHostEntry).toBeTypeOf('function')
    applyHostEntry()
  })

  it('registers the third localized tab without reading the channel eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = requiredAt(b.slots.entries('settings.plugins.tab'), 0)
    expect(entry.component).toBe(PluginControlSettingsTab)
    expect(entry.options).toMatchObject({ id: 'controls', order: 20 })
    expect(resolveSlotLabel(entry.options.label)).toBe('插件开关')
    expect(b.call).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => PluginControlSettingsTabInjected)()
    expect(injected.isLoopback).toBe(true)
    await expect(injected.list()).resolves.toEqual(SNAPSHOT)
    expect(b.call).toHaveBeenLastCalledWith('/plugin-control', 'list', {})
    await expect(injected.setEnabled('genui' as PluginControlId, false)).resolves.toEqual(SNAPSHOT)
    expect(b.call).toHaveBeenLastCalledWith('/plugin-control', 'set-enabled', {
      pluginId: 'genui', enabled: false,
    })

    b.call.mockResolvedValueOnce({
      ok: false,
      error: { code: 'internal', message: 'failed', details: {} },
    })
    await expect(injected.list()).rejects.toThrow('plugin-control list failed: internal: failed')
    b.call.mockResolvedValueOnce({ ok: true, value: { controls: [{ invalid: true }] } })
    await expect(injected.list()).rejects.toThrow('response contains an invalid control')
    await b.ctx.fiber.dispose()
  })

  it('follows locale, carries remote authority, and survives declaration reload', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    const first = requiredAt(b.slots.entries('settings.plugins.tab'), 0)
    const injected = (first.inject as unknown as () => PluginControlSettingsTabInjected)()
    expect(injected.isLoopback).toBe(false)
    b.locale.setLocale('en')
    expect(resolveSlotLabel(first.options.label)).toBe('Plugin switches')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(PluginControlSettingsTab)
    })
    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
