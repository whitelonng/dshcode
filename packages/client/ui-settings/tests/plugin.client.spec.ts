/**
 * The settings domain base plugin's own mounting behavior: it stands up
 * `ctx.settingsScope` over one shared describe mirror, keeps that mirror
 * fresh on settings-document and connection-reset invalidations, and retires
 * both the service and the subscriptions with its fiber.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { SettingsSchemaService } from '../src/client/schema.ts'
import { SettingsScopeBinder } from '../src/client/settings-scope.ts'

/** Boot the browser half over a fake loopback connection and test remote. */
function bench() {
  const describeCall = vi.fn().mockResolvedValue({
    rpcId: 'plugin-bench' as never,
    result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [] } },
  })
  const ctx = new Context()
  ctx.provide('connection', {
    api: { settings: { describe: describeCall } },
    isLoopback: true,
  } as never)
  new TestRemote(ctx)
  return { ctx, describeCall, fiber: ctx.plugin({ inject: [...inject], apply }) }
}

describe('settings domain base plugin', () => {
  it('mounts the scope service under settingsScope and reads once eagerly', async () => {
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    expect(ctx.get('settingsScope')).toBeInstanceOf(SettingsScopeBinder)
    expect(ctx.get('settingsSchema')).toBeInstanceOf(SettingsSchemaService)
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
  })

  it('refreshes the mirror on document commits and connection resets, once each', async () => {
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    ctx.remote.$dispatch('settings/document-updated', ['ui-test', 0])
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(2) })
    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(3) })
  })

  it('fiber disposal retires the service and its invalidation subscriptions', async () => {
    const { ctx, describeCall, fiber } = bench()
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalledTimes(1) })
    await fiber.dispose()
    expect(ctx.get('settingsScope')).toBeUndefined()
    expect(ctx.get('settingsSchema')).toBeUndefined()
    ctx.remote.$dispatch('settings/document-updated', ['ui-test', 0])
    ctx.emit('connection/reset')
    await Promise.resolve()
    expect(describeCall).toHaveBeenCalledTimes(1)
  })
})
