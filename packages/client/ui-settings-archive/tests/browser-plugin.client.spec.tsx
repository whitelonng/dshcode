// @vitest-environment jsdom
/** Settings section registration smoke: localized nav row + wire face. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import {
  WorkspaceCommandError,
  type ArchivedSessionItem,
  type IWorkspaces,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyHostEntry } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { ArchiveSessionsSection } from '../src/client/ArchiveSessionsSection.tsx'
import type { ArchiveSessionsSectionInjected } from '../src/client/ArchiveSessionsSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const LIST = {
  items: [{ sessionId: 's-archived' as ArchivedSessionItem['sessionId'], title: '归档对话' }],
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const workspaces = {
    listArchived: vi.fn<IWorkspaces['listArchived']>().mockResolvedValue(LIST.items),
    restoreSession: vi.fn<IWorkspaces['restoreSession']>().mockResolvedValue(undefined),
    deleteSession: vi.fn<IWorkspaces['deleteSession']>().mockResolvedValue(undefined),
  }
  ctx.provide('workspaces', workspaces as unknown as IWorkspaces)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, workspaces }
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

  it('registers the localized archived-sessions section without calling the service eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = requiredAt(b.slots.entries('settings.section'), 0)
    expect(entry.component).toBe(ArchiveSessionsSection)
    expect(entry.options).toMatchObject({ id: 'archive', order: 30 })
    expect(resolveSlotLabel(entry.options.label)).toBe('归档会话')
    expect(b.workspaces.listArchived).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => ArchiveSessionsSectionInjected)()
    await expect(injected.list()).resolves.toEqual(LIST.items)
    expect(b.workspaces.listArchived).toHaveBeenLastCalledWith()
    await expect(injected.restore('s-archived')).resolves.toBeUndefined()
    expect(b.workspaces.restoreSession).toHaveBeenLastCalledWith('s-archived')
    await expect(injected.remove('s-archived')).resolves.toBeUndefined()
    expect(b.workspaces.deleteSession).toHaveBeenLastCalledWith('s-archived')

    b.workspaces.deleteSession.mockRejectedValueOnce(new WorkspaceCommandError(
      { code: 'workspace/not-archived', message: 'not archived', details: {} } as RemoteFailure,
      'session delete',
    ))
    const failure = injected.remove('s-archived')
    await expect(failure).rejects
      .toThrow('workspace session delete failed: workspace/not-archived: not archived')
    // The rejection carries the structured Host code so the section can map
    // known failures (workspace/session-active) to actionable copy.
    await expect(failure).rejects.toMatchObject({
      name: 'ArchiveActionError',
      code: 'workspace/not-archived',
    })
    b.workspaces.listArchived.mockResolvedValueOnce([{ invalid: true }] as never)
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
