// @vitest-environment jsdom
/**
 * PluginInstallerTab presentation smoke: list rendering with update badges,
 * install and update flows, confirmed uninstall, and the restart affordance
 * on the desktop bridge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PluginInstallerTab, type PluginInstallerTabProps } from '../src/client/PluginInstallerTab.tsx'

afterEach(() => {
  cleanup()
  delete window.dshDesktop
})

const t = (key: string, params?: Record<string, string>): string => {
  const copy: Record<string, string> = {
    install: '安装',
    installing: '安装中…',
    empty: '尚未安装任何用户插件。',
    version: '已安装 {version}',
    latest: '最新 {version}',
    update: '更新',
    updating: '更新中…',
    uninstall: '卸载',
    uninstallConfirmTitle: '卸载插件',
    uninstallConfirmBody: '将删除 {name} 的安装目录与配置行，并在重启后生效。',
    confirm: '确认卸载',
    cancel: '取消',
    checkUpdates: '检查更新',
    checking: '检查中…',
    noUpdates: '所有插件都是最新版本。',
    restartHint: '插件变更将在重启应用后生效。',
    restart: '重启应用',
    failed: '操作失败：{reason}',
    installPlaceholder: 'npm 包名（如 @scope/name）或 git 仓库 URL',
    installHint: '安装会写入当前 profile 的 patch 层；应用重启后插件生效。',
  }
  let text = copy[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) {
    text = text.replace(`{${name}}`, replacement)
  }
  return text
}

function mount(overrides: Partial<PluginInstallerTabProps> = {}) {
  const list = vi.fn().mockResolvedValue([
    { id: 'a', name: '@scope/a', version: '1.0.0', source: { kind: 'npm' as const, spec: '@scope/a' }, installedAt: 'x' },
  ])
  const install = vi.fn().mockResolvedValue({ id: 'b', name: '@scope/b', version: '1.0.0', source: { kind: 'npm' as const, spec: '@scope/b' }, installedAt: 'x' })
  const update = vi.fn().mockResolvedValue({ id: 'a', name: '@scope/a', version: '1.1.0', source: { kind: 'npm' as const, spec: '@scope/a' }, installedAt: 'x' })
  const uninstall = vi.fn().mockResolvedValue([])
  const checkUpdates = vi.fn().mockResolvedValue([{ id: 'a', current: '1.0.0', latest: '1.1.0' }])
  const props: PluginInstallerTabProps = {
    t,
    list,
    install,
    update,
    uninstall,
    checkUpdates,
    ...overrides,
  } as never
  const utils = render(<PluginInstallerTab {...props} />)
  return { list, install, update, uninstall, checkUpdates, ...utils }
}

describe('PluginInstallerTab', () => {
  it('lists installed plugins and their update badges', async () => {
    const { checkUpdates } = mount()
    expect((await screen.findAllByText('@scope/a')).length).toBeGreaterThan(0)
    expect(screen.getByText('已安装 1.0.0')).toBeTruthy()
    act(() => { screen.getByText('检查更新').click() })
    await waitFor(() => { expect(checkUpdates).toHaveBeenCalledOnce() })
    expect(await screen.findByText('最新 1.1.0')).toBeTruthy()
  })

  it('installs from the spec box and reloads', async () => {
    const { install, list } = mount()
    await screen.findAllByText('@scope/a')
    const input = screen.getByPlaceholderText('npm 包名（如 @scope/name）或 git 仓库 URL')
    act(() => { fireEvent.change(input, { target: { value: '@scope/b' } }) })
    act(() => { screen.getByText('安装').click() })
    await waitFor(() => { expect(install).toHaveBeenCalledWith('@scope/b') })
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText('插件变更将在重启应用后生效。')).toBeTruthy()
  })

  it('updates a plugin with a newer version', async () => {
    const { update } = mount()
    await screen.findAllByText('@scope/a')
    act(() => { screen.getByText('检查更新').click() })
    await screen.findByText('最新 1.1.0')
    act(() => { screen.getByText('更新').click() })
    await waitFor(() => { expect(update).toHaveBeenCalledWith('a') })
  })

  it('requires confirmation before uninstall', async () => {
    const { uninstall } = mount()
    await screen.findAllByText('@scope/a')
    act(() => { screen.getByText('卸载').click() })
    expect(await screen.findByText('确认卸载')).toBeTruthy()
    expect(uninstall).not.toHaveBeenCalled()
    act(() => { screen.getByText('确认卸载').click() })
    await waitFor(() => { expect(uninstall).toHaveBeenCalledWith('a') })
  })

  it('offers the desktop restart action when the bridge is present', async () => {
    const restart = vi.fn()
    window.dshDesktop = { restart, frame: 'custom', productName: 'DSHCode', showMenu: () => {} }
    const { install, list } = mount()
    await screen.findAllByText('@scope/a')
    const input = screen.getByPlaceholderText('npm 包名（如 @scope/name）或 git 仓库 URL')
    act(() => { fireEvent.change(input, { target: { value: '@scope/b' } }) })
    act(() => { screen.getByText('安装').click() })
    await waitFor(() => { expect(install).toHaveBeenCalled() })
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    act(() => { screen.getByText('重启应用').click() })
    expect(restart).toHaveBeenCalledOnce()
  })

  it('renders the empty state', async () => {
    mount({ list: vi.fn().mockResolvedValue([]) })
    expect(await screen.findByText('尚未安装任何用户插件。')).toBeTruthy()
  })
})
