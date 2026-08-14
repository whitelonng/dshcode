// @vitest-environment jsdom
/** Settings section registration smoke: localized nav row + wire face. */

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
import { ArchiveSessionsSection } from '../src/client/ArchiveSessionsSection.tsx'
import type { ArchiveSessionsSectionInjected } from '../src/client/ArchiveSessionsSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const LIST = { items: [{ sessionId: 's-archived', title: '归档对话' }] }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const call = vi.fn<ConnectionHandle['rpc']['call']>()
    .mockResolvedValue({ ok: true, value: LIST })
  class ConnectionService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'connection')
      Object.assign(this, { isLoopback: true, rpc: { call } })
    }
  }
  new ConnectionService(ctx)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, call }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

function requiredAt<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) throw new Error(`missing fixture value at index ${index}`)
  return value
}

describe('ui-settings-archive browser plugin', () => {
  it('keeps the Host loader entry inert', () => {
    expect(applyHostEntry).toBeTypeOf('function')
    applyHostEntry()
  })

  it('registers the localized archived-sessions section without reading the channel eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = requiredAt(b.slots.entries('settings.section'), 0)
    expect(entry.component).toBe(ArchiveSessionsSection)
    expect(entry.options).toMatchObject({ id: 'archive', order: 30 })
    expect(resolveSlotLabel(entry.options.label)).toBe('归档会话')
    expect(b.call).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => ArchiveSessionsSectionInjected)()
    await expect(injected.list()).resolves.toEqual(LIST.items)
    expect(b.call).toHaveBeenLastCalledWith('/api', 'workspace.listArchived', {})
    await expect(injected.restore('s-archived')).resolves.toBeUndefined()
    expect(b.call).toHaveBeenLastCalledWith('/api', 'workspace.restoreSession', { sessionId: 's-archived' })
    await expect(injected.remove('s-archived')).resolves.toBeUndefined()
    expect(b.call).toHaveBeenLastCalledWith('/api', 'workspace.deleteSession', { sessionId: 's-archived' })

    b.call.mockResolvedValueOnce({
      ok: false,
      error: { code: 'not-archived', message: 'not archived', details: { sessionId: 's-archived' as never } },
    })
    await expect(injected.remove('s-archived')).rejects.toThrow('workspace workspace.deleteSession failed: not-archived: not archived')
    b.call.mockResolvedValueOnce({ ok: true, value: { items: [{ invalid: true }] } })
    await expect(injected.list()).rejects.toThrow('must carry a sessionId')
    await b.ctx.fiber.dispose()
  })

  it('follows locale and survives declaration reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    const first = requiredAt(b.slots.entries('settings.section'), 0)
    b.locale.setLocale('en')
    expect(resolveSlotLabel(first.options.label)).toBe('Archived sessions')

    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.section')[0]?.component).toBe(ArchiveSessionsSection)
    })
    await fiber.dispose()
  })
})
