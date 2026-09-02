// @ts-nocheck -- alpha.4 sync: product test migration pending
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply } from '../src/index.ts'
import { NOTIFICATIONS_SETTINGS_NAMESPACE } from '../src/notifications-settings.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-notifications host', () => {
  it('registers, validates, and disposes the durable notifications namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = NOTIFICATIONS_SETTINGS_NAMESPACE
    const descriptor = () => ctx.settings.describe().find(row => row.ns === ns)
    expect(descriptor()?.value).toEqual({ approvals: true, completions: true })
    await ctx.settings.update(ns, { approvals: false })
    expect(descriptor()?.value).toEqual({ approvals: false, completions: true })
    await expect(ctx.settings.update(ns, { approvals: 'sometimes' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('stays quiet without the settings service', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    await fiber.dispose()
  })
})
