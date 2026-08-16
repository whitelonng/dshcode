// @vitest-environment jsdom
/**
 * DesktopTitleBar chrome smoke: without the desktop preload bridge or on a
 * native frame (plain browsers and macOS keep the system title bar) the
 * application frame renders unwrapped; on a custom frame (Windows) the
 * draggable bar renders the product name plus a menu button wired to the
 * bridge popup above the frame.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DesktopTitleBar } from '@deepseek-ai/dsh-client-web/src/DesktopTitleBar.tsx'

afterEach(() => {
  cleanup()
  delete window.dshDesktop
})

describe('DesktopTitleBar', () => {
  it('renders the children without the desktop bridge', () => {
    render(<DesktopTitleBar><div data-testid="frame" /></DesktopTitleBar>)
    expect(screen.getByTestId('frame')).toBeTruthy()
  })

  it('renders the children without the title bar on a native frame', () => {
    window.dshDesktop = { frame: 'native', productName: 'DSHCode', appVersion: '', showMenu: () => {}, restart: () => {} }
    render(<DesktopTitleBar><div data-testid="frame" /></DesktopTitleBar>)
    expect(screen.getByTestId('frame')).toBeTruthy()
    expect(screen.queryByText('DSHCode')).toBeNull()
  })

  it('renders the product name above the children and wires the menu button on a custom frame', () => {
    const showMenu = vi.fn()
    window.dshDesktop = { frame: 'custom', productName: 'DSHCode', appVersion: '', showMenu, restart: () => {} }
    render(<DesktopTitleBar><div data-testid="frame" /></DesktopTitleBar>)
    expect(screen.getByText('DSHCode')).toBeTruthy()
    expect(screen.getByTestId('frame')).toBeTruthy()
    screen.getByLabelText('应用菜单').click()
    expect(showMenu).toHaveBeenCalledOnce()
  })
})
