import { describe, expect, it, vi } from 'vitest'
import {
  buildTrayMenu,
  buildWindowMenu,
  createQuitCoordinator,
  desktopApplicationUrl,
  desktopBridgePayload,
  desktopIpcSenderIsApplication,
  desktopLaunchArguments,
  desktopWebArguments,
  ensureMainModuleArgument,
  navigationDisposition,
  trayIconFile,
  windowCloseDisposition,
} from '../src/lifecycle.ts'

describe('desktop web service policy', () => {
  it('binds loopback on an OS-assigned port and accepts only the activated address', () => {
    expect(desktopWebArguments()).toEqual(['--host', '127.0.0.1', '--port', '0'])
    expect(desktopApplicationUrl('127.0.0.1', 43_127)).toBe('http://127.0.0.1:43127/')
    expect(() => desktopApplicationUrl('0.0.0.0', 43_127)).toThrow('unexpected host')
    expect(() => desktopApplicationUrl('127.0.0.1', 0)).toThrow('invalid port')
  })

  it('supplies only a packaged launch that omitted the main-module argument', () => {
    const packaged = ['/Applications/DSHCode.app/Contents/MacOS/DSHCode']
    ensureMainModuleArgument(packaged, '/Applications/DSHCode.app/Contents/Resources/app/lib/main.js')
    expect(packaged[1]).toBe('/Applications/DSHCode.app/Contents/Resources/app/lib/main.js')

    const development = ['/path/to/electron', '/workspace/apps/desktop']
    ensureMainModuleArgument(development, '/workspace/apps/desktop/lib/main.js')
    expect(development[1]).toBe('/workspace/apps/desktop')
  })
})

describe('desktop navigation policy', () => {
  const origin = 'http://127.0.0.1:43127'

  it('keeps same-origin navigation in the application', () => {
    expect(navigationDisposition(`${origin}/settings`, origin)).toBe('application')
  })

  it('opens only HTTPS destinations externally', () => {
    expect(navigationDisposition('https://deepseek.com/', origin)).toBe('external')
    expect(navigationDisposition('http://example.com/', origin)).toBe('blocked')
    expect(navigationDisposition('file:///tmp/secret', origin)).toBe('blocked')
    expect(navigationDisposition('not a url', origin)).toBe('blocked')
  })
})

describe('desktop quit coordination', () => {
  it('coalesces requests and exits only after Harness teardown settles', async () => {
    let settle: (() => void) | undefined
    const shutdown = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    const exit = vi.fn()
    const coordinator = createQuitCoordinator({ shutdown }, exit)

    const first = coordinator.request(0)
    const repeated = coordinator.request(1)
    expect(coordinator.requested).toBe(true)
    expect(first).toBe(repeated)
    expect(shutdown).toHaveBeenCalledOnce()
    expect(exit).not.toHaveBeenCalled()

    settle?.()
    await first
    expect(exit).toHaveBeenCalledWith(0)
  })
})

describe('desktop tray and close-to-tray policy', () => {
  it('hides a window close unless a real quit owns teardown', () => {
    expect(windowCloseDisposition(false)).toBe('hide')
    expect(windowCloseDisposition(true)).toBe('close')
  })

  it('builds the tray menu with show and quit actions', () => {
    const show = vi.fn()
    const quit = vi.fn()
    const menu = buildTrayMenu({ show, quit })

    expect(menu.map(item => item.type === 'separator' ? '---' : item.label)).toEqual(['显示主界面', '---', '退出'])
    const [showItem, , quitItem] = menu
    if (showItem === undefined || quitItem === undefined
      || showItem.type === 'separator' || quitItem.type === 'separator') {
      throw new Error('menu items must be actions')
    }
    showItem.click?.()
    expect(show).toHaveBeenCalledOnce()
    quitItem.click?.()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('selects the 16 px logo on macOS and the 32 px one elsewhere', () => {
    expect(trayIconFile('darwin')).toBe('tray16.png')
    expect(trayIconFile('win32')).toBe('tray.png')
    expect(trayIconFile('linux')).toBe('tray.png')
  })
})

describe('desktop preload bridge policy', () => {
  it('round-trips the custom-frame launch arguments with an encoded product name', () => {
    const args = desktopLaunchArguments('DSHCode')
    expect(args[0]).toBe('--dsh-frame=custom')
    expect(desktopBridgePayload(args, 'win32')).toEqual({ frame: 'custom', productName: 'DSHCode' })
  })

  it('defaults to a native frame and an empty product name without the arguments', () => {
    expect(desktopBridgePayload([], 'darwin')).toEqual({ frame: 'native', productName: '' })
    expect(desktopBridgePayload(['--some-other=flag'], 'linux')).toEqual({ frame: 'native', productName: '' })
  })

  it('accepts only application-origin IPC senders', () => {
    const origin = 'http://127.0.0.1:43127'
    expect(desktopIpcSenderIsApplication(`${origin}/settings`, origin)).toBe(true)
    expect(desktopIpcSenderIsApplication('https://evil.example/', origin)).toBe(false)
    expect(desktopIpcSenderIsApplication(undefined, origin)).toBe(false)
    expect(desktopIpcSenderIsApplication('not a url', origin)).toBe(false)
  })

  it('builds the window menu with hide, restart, and quit actions', () => {
    const hide = vi.fn()
    const restart = vi.fn()
    const quit = vi.fn()
    const menu = buildWindowMenu({ hide, restart, quit })

    expect(menu.map(item => item.type === 'separator' ? '---' : item.label))
      .toEqual(['隐藏到托盘', '---', '重启应用', '---', '退出'])
    const [hideItem, , restartItem, , quitItem] = menu
    if (hideItem === undefined || restartItem === undefined || quitItem === undefined
      || hideItem.type === 'separator' || restartItem.type === 'separator' || quitItem.type === 'separator') {
      throw new Error('menu items must be actions')
    }
    hideItem.click?.()
    expect(hide).toHaveBeenCalledOnce()
    restartItem.click?.()
    expect(restart).toHaveBeenCalledOnce()
    quitItem.click?.()
    expect(quit).toHaveBeenCalledOnce()
  })
})
