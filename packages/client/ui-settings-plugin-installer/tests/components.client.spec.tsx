// @vitest-environment jsdom
/**
 * PluginInstallerTab presentation: the merged plugin list — user-plugin rows
 * with saved enablement switches, update badges, install/update flows,
 * confirmed uninstall, the collapsed-by-default built-in section with
 * switch-only rows, the local-only notice, and the restart affordance on the
 * desktop bridge.
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
    loading: '正在读取插件…',
    userPlugins: '用户插件',
    builtinPlugins: '内置插件',
    empty: '尚未安装任何用户插件。',
    search: '搜索插件',
    emptySearch: '没有匹配的插件。',
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
    installHint: '在 GitHub 或 npm 找到插件后，粘贴其 npm 包名或仓库地址安装；应用重启后插件生效。',
    enabled: '已开启',
    disabled: '已关闭',
    enableSwitch: '开启 {name}',
    disableSwitch: '关闭 {name}',
    applying: '正在应用更改…',
    fetching: '正在获取插件信息…',
    downloading: '正在下载…',
    downloadingPercent: '正在下载 {percent}%',
    extracting: '正在解压…',
    writing: '正在写入配置…',
    mixed: '部分开启',
    unavailable: '不可用',
    uninstalled: '已卸载',
    restore: '恢复',
    source: '查看源码',
    updateError: '更改未能应用，请重试。',
    localOnlyTitle: '仅限本机操作',
    localOnlyBody: '为了保护主机配置，插件开关只能从本机打开。',
    failureBadge: '启动失败',
    repair: '让 Agent 修复',
    repairing: '正在创建修复对话…',
    copyError: '复制错误',
    copied: '已复制',
    safeModeBanner: '安全模式：用户插件配置已跳过，插件开关不可用。',
    exitSafeMode: '恢复正常模式并重启',
  }
  let text = copy[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) {
    text = text.replace(`{${name}}`, replacement)
  }
  return text
}

const PLUGIN_A = {
  id: 'a',
  name: '@scope/a',
  version: '1.0.0',
  source: { kind: 'npm' as const, spec: '@scope/a' },
  installedAt: 'x',
  enabled: true,
}
const PLUGIN_B = {
  id: 'b',
  name: '@scope/b',
  version: '1.0.0',
  source: { kind: 'npm' as const, spec: '@scope/b' },
  installedAt: 'x',
  enabled: true,
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const INVENTORY = {
  entries: [
    { entryId: 'a', moduleName: '@scope/a', enabled: true, fiberPhase: 'active' },
    { entryId: 'ui-builtin', moduleName: '@deepseek-ai/dsh-client-ui-builtin', enabled: true, fiberPhase: 'active' },
    { entryId: 'cordis:active', moduleName: 'cordis:active', enabled: true, fiberPhase: 'active' },
  ],
}

function mount(overrides: Partial<PluginInstallerTabProps> = {}) {
  const list = vi.fn().mockResolvedValue([PLUGIN_A])
  const install = vi.fn().mockResolvedValue(PLUGIN_B)
  const update = vi.fn().mockResolvedValue({ ...PLUGIN_A, version: '1.1.0' })
  const uninstall = vi.fn().mockResolvedValue([])
  const setEnabled = vi.fn().mockResolvedValue({ ...PLUGIN_A, enabled: false })
  const checkUpdates = vi.fn().mockResolvedValue([{ id: 'a', current: '1.0.0', latest: '1.1.0' }])
  const status = vi.fn().mockResolvedValue({ kind: 'idle', stage: 'fetch' })
  const failures = vi.fn().mockResolvedValue({ items: [], pluginRoot: '/home/.dsh/profiles', safeMode: false })
  const setSafeMode = vi.fn().mockResolvedValue(undefined)
  const repairPlugin = vi.fn().mockResolvedValue(undefined)
  const controlsList = vi.fn().mockResolvedValue([])
  const controlsSetEnabled = vi.fn().mockResolvedValue([])
  const controlsUninstall = vi.fn().mockResolvedValue([])
  const inventoryList = vi.fn().mockResolvedValue(INVENTORY)

  const props: PluginInstallerTabProps = {
    t,
    isLoopback: true,
    list,
    install,
    update,
    uninstall,
    setEnabled,
    checkUpdates,
    status,
    failures,
    setSafeMode,
    repairPlugin,
    inventoryList,
    controlsList,
    controlsSetEnabled,
    controlsUninstall,
    ...overrides,
  } as never
  const utils = render(<PluginInstallerTab {...props} />)
  return {
    list, install, update, uninstall, setEnabled, checkUpdates, status, failures, setSafeMode, repairPlugin,
    inventoryList, controlsList, controlsSetEnabled, controlsUninstall,
    ...overrides,
    ...utils,
  }
}

describe('PluginInstallerTab', () => {
  it('lists user plugins with update badges and keeps built-ins collapsed by default', async () => {
    const { checkUpdates } = mount()
    expect((await screen.findAllByText('@scope/a')).length).toBeGreaterThan(0)
    expect(screen.getByText('已安装 1.0.0')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '关闭 @scope/a' }).getAttribute('aria-checked')).toBe('true')
    // Built-in rows stay out of the DOM until the disclosure opens.
    expect(screen.queryByText('ui-builtin')).toBeNull()
    expect(screen.getByText('内置插件')).toBeTruthy()
    act(() => { screen.getByText('检查更新').click() })
    await waitFor(() => { expect(checkUpdates).toHaveBeenCalledOnce() })
    expect(await screen.findByText('最新 1.1.0')).toBeTruthy()
  })

  it('expands built-ins, filters them, and shows the empty search state', async () => {
    // A user plugin absent from the inventory still renders enabled.
    mount({
      inventoryList: vi.fn().mockResolvedValue({
        entries: [
          { entryId: 'ui-builtin', moduleName: '@deepseek-ai/dsh-client-ui-builtin', enabled: true, fiberPhase: 'active' },
          { entryId: 'cordis:active', moduleName: 'cordis:active', enabled: false, fiberPhase: null },
        ],
      }),
    })
    await screen.findAllByText('@scope/a')
    expect(screen.getByRole('switch', { name: '关闭 @scope/a' }).getAttribute('aria-checked')).toBe('true')
    act(() => { screen.getByText('内置插件').click() })
    expect((await screen.findAllByText('ui-builtin')).length).toBeGreaterThan(0)
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: '搜索插件' })).toBeTruthy()
    act(() => {
      fireEvent.change(screen.getByRole('searchbox', { name: '搜索插件' }), { target: { value: 'nope' } })
    })
    expect(await screen.findByText('没有匹配的插件。')).toBeTruthy()
    act(() => {
      fireEvent.change(screen.getByRole('searchbox', { name: '搜索插件' }), { target: { value: 'ui-builtin' } })
    })
    await screen.findAllByText('ui-builtin')
  })

  it('installs from the spec box and reloads both lists', async () => {
    const { install, list, inventoryList } = mount()
    await screen.findAllByText('@scope/a')
    const input = screen.getByPlaceholderText('npm 包名（如 @scope/name）或 git 仓库 URL')
    act(() => { fireEvent.change(input, { target: { value: '@scope/b' } }) })
    act(() => { screen.getByText('安装').click() })
    await waitFor(() => { expect(install).toHaveBeenCalledWith('@scope/b') })
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(inventoryList).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('插件变更将在重启应用后生效。')).toBeTruthy()
  })

  it('surfaces install failures with Error and string reasons', async () => {
    const { install } = mount({ install: vi.fn().mockRejectedValue(new Error('registry unreachable')) })
    await screen.findAllByText('@scope/a')
    const input = screen.getByPlaceholderText('npm 包名（如 @scope/name）或 git 仓库 URL')
    act(() => { fireEvent.change(input, { target: { value: '@scope/b' } }) })
    act(() => { screen.getByText('安装').click() })
    expect(await screen.findByText('操作失败：registry unreachable')).toBeTruthy()
    expect(install).toHaveBeenCalled()
    cleanup()
    mount({ install: vi.fn().mockRejectedValue('offline') })
    await screen.findAllByText('@scope/a')
    const secondInput = screen.getByPlaceholderText('npm 包名（如 @scope/name）或 git 仓库 URL')
    act(() => { fireEvent.change(secondInput, { target: { value: '@scope/b' } }) })
    act(() => { screen.getByText('安装').click() })
    expect(await screen.findByText('操作失败：offline')).toBeTruthy()
  })

  it('shows install progress polled from the host', async () => {
    const pendingInstall = deferred<typeof PLUGIN_B>()
    const statusCalls = [
      { kind: 'install' as const, stage: 'fetch' as const },
      { kind: 'install' as const, stage: 'download' as const },
      { kind: 'install' as const, stage: 'download' as const, percent: 42 },
      { kind: 'install' as const, stage: 'extract' as const },
      { kind: 'install' as const, stage: 'write' as const },
    ]
    const { status } = mount({
      install: vi.fn().mockReturnValue(pendingInstall.promise),
      status: vi.fn().mockImplementation(async () => statusCalls.shift() ?? { kind: 'idle', stage: 'fetch' }),
    })
    await screen.findAllByText('@scope/a')
    const input = screen.getByPlaceholderText('npm 包名（如 @scope/name）或 git 仓库 URL')
    act(() => { fireEvent.change(input, { target: { value: '@scope/b' } }) })
    act(() => { screen.getByText('安装').click() })
    expect(await screen.findByText('正在获取插件信息…')).toBeTruthy()
    expect(await screen.findByText('正在下载…')).toBeTruthy()
    expect(await screen.findByText('正在下载 42%')).toBeTruthy()
    expect(await screen.findByText('正在解压…')).toBeTruthy()
    expect(await screen.findByText('正在写入配置…')).toBeTruthy()
    expect(status).toHaveBeenCalled()
    act(() => { pendingInstall.resolve(PLUGIN_B) })
  })

  it('stops polling when a status read fails', async () => {
    const pendingInstall = deferred<typeof PLUGIN_B>()
    const { status } = mount({
      install: vi.fn().mockReturnValue(pendingInstall.promise),
      status: vi.fn().mockRejectedValue(new Error('offline')),
    })
    await screen.findAllByText('@scope/a')
    const input = screen.getByPlaceholderText('npm 包名（如 @scope/name）或 git 仓库 URL')
    act(() => { fireEvent.change(input, { target: { value: '@scope/b' } }) })
    act(() => { screen.getByText('安装').click() })
    await waitFor(() => { expect(status).toHaveBeenCalledTimes(1) })
    expect(await screen.findByText('正在获取插件信息…')).toBeTruthy()
    act(() => { pendingInstall.resolve(PLUGIN_B) })
  })

  it('ignores progress polls that settle after unmount', async () => {
    const statusGate = deferred<{ kind: 'install'; stage: 'download'; percent: number }>()
    const installGate = deferred<typeof PLUGIN_B>()
    const { unmount, status } = mount({
      install: vi.fn().mockReturnValue(installGate.promise),
      status: vi.fn().mockReturnValue(statusGate.promise),
    })
    await screen.findAllByText('@scope/a')
    const input = screen.getByPlaceholderText('npm 包名（如 @scope/name）或 git 仓库 URL')
    act(() => { fireEvent.change(input, { target: { value: '@scope/b' } }) })
    act(() => { screen.getByText('安装').click() })
    await waitFor(() => { expect(status).toHaveBeenCalled() })
    unmount()
    act(() => { statusGate.resolve({ kind: 'install', stage: 'download', percent: 10 }) })
    act(() => { installGate.resolve(PLUGIN_B) })
  })

  it('updates a plugin with a newer version', async () => {
    const { update } = mount()
    await screen.findAllByText('@scope/a')
    act(() => { screen.getByText('检查更新').click() })
    await screen.findByText('最新 1.1.0')
    act(() => { screen.getByText('更新').click() })
    await waitFor(() => { expect(update).toHaveBeenCalledWith('a') })
  })

  it('requires confirmation before uninstall and supports cancel and Escape', async () => {
    const { uninstall } = mount()
    await screen.findAllByText('@scope/a')
    act(() => { screen.getByText('卸载').click() })
    expect(await screen.findByText('确认卸载')).toBeTruthy()
    expect(uninstall).not.toHaveBeenCalled()
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.queryByText('确认卸载')).toBeNull()
    expect(uninstall).not.toHaveBeenCalled()
    act(() => { screen.getByText('卸载').click() })
    act(() => { screen.getByText('取消').click() })
    expect(uninstall).not.toHaveBeenCalled()
    act(() => { screen.getByText('卸载').click() })
    act(() => { screen.getAllByText('确认卸载')[0]!.click() })
    await waitFor(() => { expect(uninstall).toHaveBeenCalledWith('a') })
  })

  it('lists preset products with switches in the user section', async () => {
    const { controlsSetEnabled } = mount({
      controlsList: vi.fn().mockResolvedValue([
        { id: 'genui', name: 'dsh-genui', repository: 'https://github.com/omdsh-dev/dsh-genui', state: 'disabled' },
        { id: 'annotation', name: 'dsh-annotation', repository: 'https://github.com/omdsh-dev/dsh-annotation', state: 'unavailable' },
        { id: 'web-ui', name: 'dsh-web-ui', repository: 'https://github.com/zhu1090093659/dsh-web-ui', state: 'enabled' },
      ]),
    })
    await screen.findAllByText('@scope/a')
    expect(screen.getByText('dsh-genui')).toBeTruthy()
    expect(screen.getByText('dsh-annotation')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '开启 dsh-genui' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: '开启 dsh-annotation' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('switch', { name: '关闭 dsh-web-ui' }).getAttribute('aria-checked')).toBe('true')
    act(() => { screen.getByRole('switch', { name: '开启 dsh-genui' }).click() })
    await waitFor(() => { expect(controlsSetEnabled).toHaveBeenCalledWith('genui', true) })
    expect(await screen.findByText('插件变更将在重启应用后生效。')).toBeTruthy()
  })

  it('surfaces preset switch failures with Error and string reasons', async () => {
    for (const reason of ['nope', new Error('boom')] as const) {
      cleanup()
      mount({
        controlsList: vi.fn().mockResolvedValue([
          { id: 'genui', name: 'dsh-genui', repository: 'https://github.com/omdsh-dev/dsh-genui', state: 'disabled' },
        ]),
        controlsSetEnabled: vi.fn().mockRejectedValue(reason),
      })
      await screen.findAllByText('@scope/a')
      act(() => { screen.getByRole('switch', { name: '开启 dsh-genui' }).click() })
      const expected = reason instanceof Error ? reason.message : reason
      expect(await screen.findByText(`操作失败：${expected}`)).toBeTruthy()
    }
  })

  it('uninstalls a preset product after confirmation', async () => {
    const { controlsUninstall } = mount({
      controlsList: vi.fn().mockResolvedValue([
        { id: 'genui', name: 'dsh-genui', repository: 'https://github.com/omdsh-dev/dsh-genui', state: 'disabled' },
      ]),
      controlsUninstall: vi.fn().mockResolvedValue([]),
    })
    await screen.findAllByText('@scope/a')
    act(() => { screen.getAllByText('卸载')[0]!.click() })
    expect(await screen.findByText('将删除 dsh-genui 的安装目录与配置行，并在重启后生效。')).toBeTruthy()
    expect(controlsUninstall).not.toHaveBeenCalled()
    act(() => { screen.getByText('确认卸载').click() })
    await waitFor(() => { expect(controlsUninstall).toHaveBeenCalledWith('genui') })
    await waitFor(() => { expect(screen.queryByText('dsh-genui')).toBeNull() })
    expect(await screen.findByText('插件变更将在重启应用后生效。')).toBeTruthy()
  })

  it('shows a restore action for uninstalled presets and restores them', async () => {
    const { controlsSetEnabled } = mount({
      controlsList: vi.fn().mockResolvedValue([
        { id: 'web-ui', name: 'dsh-web-ui', repository: 'https://github.com/zhu1090093659/dsh-web-ui', state: 'uninstalled' },
      ]),
      controlsSetEnabled: vi.fn().mockResolvedValue([
        { id: 'web-ui', name: 'dsh-web-ui', repository: 'https://github.com/zhu1090093659/dsh-web-ui', state: 'disabled' },
      ]),
    })
    await screen.findAllByText('@scope/a')
    expect(screen.getByText('已卸载')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: /dsh-web-ui/ })).toBeNull()
    act(() => { screen.getByText('恢复').click() })
    await waitFor(() => { expect(controlsSetEnabled).toHaveBeenCalledWith('web-ui', true) })
    await waitFor(() => { expect(screen.queryByText('已卸载')).toBeNull() })
    expect(screen.getByRole('switch', { name: '开启 dsh-web-ui' })).toBeTruthy()
    expect(await screen.findByText('插件变更将在重启应用后生效。')).toBeTruthy()
  })

  it('persists a user-plugin enablement switch and shows the restart hint', async () => {
    const { setEnabled } = mount()
    await screen.findAllByText('@scope/a')
    act(() => { screen.getByRole('switch', { name: '关闭 @scope/a' }).click() })
    await waitFor(() => { expect(setEnabled).toHaveBeenCalledWith('a', false) })
    expect(screen.getByRole('switch', { name: '开启 @scope/a' }).getAttribute('aria-checked')).toBe('false')
    expect(await screen.findByText('插件变更将在重启应用后生效。')).toBeTruthy()
  })

  it('surfaces switch failures with Error and string reasons', async () => {
    const scenarios: Array<{ reason: unknown }> = [
      { reason: 'nope' },
      { reason: new Error('boom') },
    ]
    for (const scenario of scenarios) {
      cleanup()
      mount({ setEnabled: vi.fn().mockRejectedValue(scenario.reason) })
      await screen.findAllByText('@scope/a')
      act(() => { screen.getByRole('switch', { name: '关闭 @scope/a' }).click() })
      const expected = scenario.reason instanceof Error ? scenario.reason.message : scenario.reason
      expect(await screen.findByText(`操作失败：${expected}`)).toBeTruthy()
    }
  })

  it('disables unrelated switches while one toggle is pending', async () => {
    const { setEnabled } = mount({
      list: vi.fn().mockResolvedValue([PLUGIN_A, PLUGIN_B]),
      setEnabled: vi.fn().mockReturnValue(deferred<typeof PLUGIN_A>().promise),
    })
    await screen.findAllByText('@scope/a')
    act(() => { screen.getByText('内置插件').click() })
    await screen.findAllByText('ui-builtin')
    act(() => { screen.getByRole('switch', { name: '关闭 @scope/a' }).click() })
    expect(await screen.findByText('正在应用更改…')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '关闭 @scope/a' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('switch', { name: '关闭 @scope/b' }).hasAttribute('disabled')).toBe(true)
    expect(setEnabled).toHaveBeenCalledWith('a', false)
    cleanup()
  })

  it('installs on Enter, ignoring empty specs and in-flight installs', async () => {
    const pendingInstall = deferred<typeof PLUGIN_B>()
    const { install } = mount({ install: vi.fn().mockReturnValue(pendingInstall.promise) })
    await screen.findAllByText('@scope/a')
    const input = screen.getByPlaceholderText('npm 包名（如 @scope/name）或 git 仓库 URL')
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(install).not.toHaveBeenCalled()
    act(() => { fireEvent.change(input, { target: { value: '@scope/b' } }) })
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await waitFor(() => { expect(install).toHaveBeenCalledTimes(1) })
    expect(screen.getByRole('switch', { name: '关闭 @scope/a' }).hasAttribute('disabled')).toBe(true)
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(install).toHaveBeenCalledTimes(1)
    act(() => { pendingInstall.resolve(PLUGIN_B) })
    await waitFor(() => { expect(install).toHaveBeenCalledTimes(1) })
  })

  it('ignores initial-load settlement after unmount', async () => {
    const listPending = deferred<never>()
    const inventoryPending = deferred<never>()
    const first = mount({
      list: vi.fn().mockReturnValue(listPending.promise),
      inventoryList: vi.fn().mockReturnValue(inventoryPending.promise),
    })
    first.unmount()
    act(() => { listPending.resolve([] as never) })
    act(() => { inventoryPending.resolve({ entries: [] } as never) })

    const failingList = deferred<never>()
    const failingInventory = deferred<never>()
    const second = mount({
      list: vi.fn().mockReturnValue(failingList.promise),
      inventoryList: vi.fn().mockReturnValue(failingInventory.promise),
    })
    second.unmount()
    act(() => { failingList.reject(new Error('boom')) })
    act(() => { failingInventory.reject(new Error('boom')) })
    expect(screen.queryByText('操作失败：load')).toBeNull()
  })

  it('shows the empty state for an opened built-in section without rows', async () => {
    mount({
      inventoryList: vi.fn().mockResolvedValue({
        entries: [{ entryId: 'a', moduleName: '@scope/a', enabled: true, fiberPhase: 'active' }],
      }),
    })
    await screen.findAllByText('@scope/a')
    act(() => { screen.getByText('内置插件').click() })
    expect(await screen.findByText('尚未安装任何用户插件。')).toBeTruthy()
  })

  it('offers the desktop restart action when the bridge is present', async () => {
    const restart = vi.fn()
    window.dshDesktop = { restart, frame: 'custom', productName: 'DSHCode', appVersion: '', showMenu: () => {} }
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

  it('renders the empty user state and the loading state', async () => {
    mount({ list: vi.fn().mockResolvedValue([]) })
    expect(await screen.findByText('尚未安装任何用户插件。')).toBeTruthy()
    const pending = new Promise<never>(() => {})
    mount({
      list: vi.fn().mockReturnValue(pending),
      inventoryList: vi.fn().mockReturnValue(pending),
    })
    expect(await screen.findByText('正在读取插件…')).toBeTruthy()
  })

  it('shows the local-only notice outside loopback and a load failure otherwise', async () => {
    mount({ isLoopback: false })
    expect(screen.getByText('仅限本机操作')).toBeTruthy()
    mount({
      isLoopback: true,
      list: vi.fn().mockRejectedValue(new Error('offline')),
    })
    expect(await screen.findByText('操作失败：load')).toBeTruthy()
  })

  it('shows the startup-failure badge and opens a repair conversation seeded with the record', async () => {
    const failure = {
      pluginId: 'a',
      kind: 'load-failure' as const,
      message: 'boom at import',
      stack: 'Error: boom at import\n    at a',
      installPath: '/home/.dsh/profiles/node_modules/@scope/a',
      at: '2026-08-14T00:00:00.000Z',
    }
    const repairPlugin = vi.fn().mockResolvedValue(undefined)
    mount({
      failures: vi.fn().mockResolvedValue({
        items: [failure],
        pluginRoot: '/home/.dsh/profiles',
        safeMode: false,
      }),
      repairPlugin,
    })
    expect(await screen.findByText('启动失败')).toBeTruthy()
    expect(screen.getByText('boom at import')).toBeTruthy()
    act(() => { screen.getByText('让 Agent 修复').click() })
    await waitFor(() => {
      expect(repairPlugin).toHaveBeenCalledWith(
        '/home/.dsh/profiles',
        expect.stringContaining('boom at import'),
      )
    })
    const message = repairPlugin.mock.calls[0]?.[1] as string
    expect(message).toContain('插件「a」上次启动失败')
    expect(message).toContain('/home/.dsh/profiles/node_modules/@scope/a')
  })

  it('surfaces a repair failure and copies the failure text on demand', async () => {
    const failure = {
      pluginId: 'a',
      kind: 'hang' as const,
      message: 'hung',
      stack: 'at hang',
      installPath: '/x',
      at: '2026-08-14T00:00:00.000Z',
    }
    const repairPlugin = vi.fn().mockRejectedValue(new Error('session create failed'))
    mount({
      failures: vi.fn().mockResolvedValue({ items: [failure], pluginRoot: '/p', safeMode: false }),
      repairPlugin,
    })
    await screen.findByText('启动失败')
    act(() => { screen.getByText('让 Agent 修复').click() })
    expect(await screen.findByText('操作失败：session create failed')).toBeTruthy()
    expect(repairPlugin).toHaveBeenCalled()

    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
    act(() => { screen.getByText('复制错误').click() })
    await waitFor(() => { expect(clipboard.writeText).toHaveBeenCalledWith('hung\n\nat hang') })
    expect(await screen.findByText('已复制')).toBeTruthy()
  })

  it('shows the safe-mode banner, locks switches, and restores normal mode through the bridge', async () => {
    const restart = vi.fn()
    window.dshDesktop = { restart, frame: 'custom', productName: 'DSHCode', appVersion: '', showMenu: () => {} }
    const { setSafeMode } = mount({
      failures: vi.fn().mockResolvedValue({ items: [], pluginRoot: '/p', safeMode: true }),
    })
    expect(await screen.findByText('安全模式：用户插件配置已跳过，插件开关不可用。')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '关闭 @scope/a' }).hasAttribute('disabled')).toBe(true)
    act(() => { screen.getByText('恢复正常模式并重启').click() })
    await waitFor(() => { expect(setSafeMode).toHaveBeenCalledWith(false) })
    await waitFor(() => { expect(restart).toHaveBeenCalledOnce() })
  })

  it('falls back to the restart hint when leaving safe mode without the bridge', async () => {
    const { setSafeMode } = mount({
      failures: vi.fn().mockResolvedValue({ items: [], pluginRoot: '/p', safeMode: true }),
    })
    await screen.findByText('安全模式：用户插件配置已跳过，插件开关不可用。')
    act(() => { screen.getByText('恢复正常模式并重启').click() })
    await waitFor(() => { expect(setSafeMode).toHaveBeenCalledWith(false) })
    expect(await screen.findByText('插件变更将在重启应用后生效。')).toBeTruthy()
  })
})
