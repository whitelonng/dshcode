// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginControlSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { PluginControlSettingsTab } from '../src/client/PluginControlSettingsTab.tsx'
import type {
  PluginControlSettingsTabInjected,
  PluginControlSettingsTabProps,
} from '../src/client/PluginControlSettingsTab.tsx'
import { en, type PluginControlLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: PluginControlLocaleKey, params?: Record<string, unknown>): string => {
  const value = en[key]
  return Object.entries(params ?? {}).reduce(
    (text, [name, replacement]) => text.replace(`{${name}}`, String(replacement)),
    value,
  )
}) as PluginControlSettingsTabProps['t']

const SNAPSHOT = {
  controls: [
    { id: 'genui', name: 'dsh-genui', repository: 'https://example.com/genui', state: 'enabled' },
    { id: 'annotation', name: 'dsh-annotation', repository: 'https://example.com/annotation', state: 'disabled' },
    { id: 'web-ui', name: 'dsh-web-ui', repository: 'https://example.com/web-ui', state: 'mixed' },
    { id: 'missing', name: 'missing-plugin', repository: 'https://example.com/missing', state: 'unavailable' },
  ],
} as unknown as PluginControlSnapshot

function props(
  overrides: Partial<PluginControlSettingsTabInjected> = {},
): PluginControlSettingsTabProps {
  return {
    t,
    isLoopback: true,
    list: async () => SNAPSHOT,
    setEnabled: async () => SNAPSHOT,
    ...overrides,
  } as PluginControlSettingsTabProps
}

describe('PluginControlSettingsTab', () => {
  it('renders aggregate states and applies accessible switches', async () => {
    const listDeferred = Promise.withResolvers<PluginControlSnapshot>()
    const setDeferred = Promise.withResolvers<PluginControlSnapshot>()
    const setEnabled = vi.fn(() => setDeferred.promise)
    render(<PluginControlSettingsTab {...props({ list: () => listDeferred.promise, setEnabled })} />)
    expect(screen.getByText(en.loading)).toBeTruthy()
    await act(async () => { listDeferred.resolve(SNAPSHOT) })

    expect(screen.getByRole('heading', { name: en.heading })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    for (const label of [en.enabled, en.disabled, en.mixed, en.unavailable]) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getAllByRole('link', { name: en.source })).toHaveLength(4)
    expect(screen.getByRole('switch', { name: 'Turn off dsh-genui' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Turn on dsh-annotation' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Turn on dsh-web-ui' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Turn on missing-plugin' })).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('switch', { name: 'Turn off dsh-genui' }))
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith('genui', false) })
    expect(screen.getByText(en.applying)).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Turn on dsh-annotation' })).toHaveProperty('disabled', true)

    const next = {
      controls: SNAPSHOT.controls.map(control => control.id === 'genui' ? { ...control, state: 'disabled' as const } : control),
    }
    await act(async () => { setDeferred.resolve(next) })
    expect(screen.getByRole('switch', { name: 'Turn on dsh-genui' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText(en.applying)).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(en.restartHint)
  })

  it('contains load and mutation failures and retries into the empty state', async () => {
    const list = vi.fn<PluginControlSettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ controls: [] })
    const setEnabled = vi.fn<PluginControlSettingsTabInjected['setEnabled']>()
      .mockRejectedValue(new Error('write detail'))
    render(<PluginControlSettingsTab {...props({ list, setEnabled })} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()

    cleanup()
    render(<PluginControlSettingsTab {...props({ setEnabled })} />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Turn off dsh-genui' }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.updateError)
  })

  it('does not call the privileged route for a remote browser', () => {
    const list = vi.fn<PluginControlSettingsTabInjected['list']>()
    render(<PluginControlSettingsTab {...props({ isLoopback: false, list })} />)
    expect(screen.getByText(en.localOnlyTitle)).toBeTruthy()
    expect(screen.getByText(en.localOnlyBody)).toBeTruthy()
    expect(list).not.toHaveBeenCalled()
  })

  it('ignores late list and mutation settlements after unmount', async () => {
    const listDeferred = Promise.withResolvers<PluginControlSnapshot>()
    const pendingList = render(<PluginControlSettingsTab {...props({ list: () => listDeferred.promise })} />)
    pendingList.unmount()
    await act(async () => { listDeferred.resolve(SNAPSHOT) })

    const rejectedList = Promise.withResolvers<PluginControlSnapshot>()
    const pendingListReject = render(
      <PluginControlSettingsTab {...props({ list: () => rejectedList.promise })} />,
    )
    pendingListReject.unmount()
    await act(async () => { rejectedList.reject(new Error('late list')) })

    const setDeferred = Promise.withResolvers<PluginControlSnapshot>()
    const pendingSet = render(<PluginControlSettingsTab {...props({ setEnabled: () => setDeferred.promise })} />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Turn off dsh-genui' }))
    pendingSet.unmount()
    await act(async () => { setDeferred.resolve(SNAPSHOT) })

    const rejected = Promise.withResolvers<PluginControlSnapshot>()
    const pendingReject = render(<PluginControlSettingsTab {...props({ setEnabled: () => rejected.promise })} />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Turn off dsh-genui' }))
    pendingReject.unmount()
    await act(async () => { rejected.reject(new Error('late')) })
  })
})
