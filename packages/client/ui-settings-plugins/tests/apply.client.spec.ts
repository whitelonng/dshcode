/** What the browser half registers, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {
  ConfigurablePluginsTabInjected, PluginsSettingsSectionInjected,
} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const describeCredentials = vi.fn(() => Promise.resolve({ rpcId: 'c', result: { ok: false, error: {} } }))
  // The section binds its scopes through the Settings surface's service, and
  // forwarded Host events reach it through the same `$dispatch` handoff the
  // connection sink makes.
  new TestRemote(ctx)
  ctx.provide('connection', {
    isLoopback: true,
    api: {
      settings: { describe: vi.fn(() => Promise.resolve({ rpcId: 's', result: { ok: false, error: {} } })) },
      credentials: { describe: describeCredentials },
    },
  } as never)
  await ctx.plugin(SettingsScopeBinder).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describeCredentials }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugins apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('registers one Plugins section and declares the tab and card slots', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect(section.options).toMatchObject({ id: 'plugins', order: 15 })
    // The nav label is a locale-following thunk; owners resolve it at read time.
    expect(resolveSlotLabel(section.options.label)).toBe('插件')
    expect(slots.spec('settings.plugins.tab')).toMatchObject({ kind: 'list', scope: 'root' })
    const tab = slots.entries('settings.plugins.tab')[0]!
    expect(tab.options).toMatchObject({ id: 'configurable', order: 0 })
    expect(resolveSlotLabel(tab.options.label)).toBe('插件配置')
    expect(slots.spec('settings.plugin.item')).toMatchObject({ kind: 'list', scope: 'root' })
  })

  it('registers one card per host-plane section it ships, in a stable order', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(slots.entries('settings.plugin.item').map(entry => entry.options.id))
      .toEqual(['bash', 'agent-loop', 'web-search'])
  })

  it('injects a live tab projection, a card count, and one business face per card', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    const sectionFace = (section.inject as unknown as () => PluginsSettingsSectionInjected)()
    const initialTabs = sectionFace.hooks.tabs.getSnapshot()
    expect(initialTabs).toEqual([
      { id: 'configurable', order: 0, label: '插件配置' },
    ])
    expect(sectionFace.hooks.tabs.getSnapshot()).toBe(initialTabs)

    const listener = vi.fn()
    const unsubscribe = sectionFace.hooks.tabs.subscribe(listener)
    slots.register({ name: 'settings.plugins.tab', id: 'plain' } as never, () => null)
    expect(sectionFace.hooks.tabs.getSnapshot()).toEqual([
      { id: 'configurable', order: 0, label: '插件配置' },
      { id: 'plain', order: 0, label: '' },
    ])
    unsubscribe()

    const tab = slots.entries('settings.plugins.tab')[0]!
    expect((tab.inject as unknown as () => ConfigurablePluginsTabInjected)()).toEqual({ cardCount: 3 })
    for (const entry of slots.entries('settings.plugin.item')) {
      const face = (entry as { inject?: () => unknown }).inject?.() as { hooks: Record<string, unknown> }
      // Each card injects exactly one snapshot store plus its own actions.
      expect(Object.keys(face.hooks)).toHaveLength(1)
    }
  })

  it('re-reads the credential when the Host reports the watched reference changed', async () => {
    const { ctx, slots, describeCredentials } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalled() })
    describeCredentials.mockClear()

    // A key written on another surface changes no settings section, so this
    // event is the only thing that reaches the card.
    ctx.remote.$dispatch('credentials/updated', ['DEEPSEEK_API_KEY'])

    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalledTimes(1) })
  })

  it('ignores a credential change for a reference no card watches', async () => {
    const { ctx, slots, describeCredentials } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeCredentials).toHaveBeenCalled() })
    describeCredentials.mockClear()

    ctx.remote.$dispatch('credentials/updated', ['SOME_OTHER_KEY'])
    await Promise.resolve()

    expect(describeCredentials).not.toHaveBeenCalled()
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  })

  it('collapses every contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.plugin.item')).toHaveLength(3)

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(slots.spec('settings.plugins.tab')).toBeUndefined()
    expect(slots.spec('settings.plugin.item')).toBeUndefined()
  })
})
