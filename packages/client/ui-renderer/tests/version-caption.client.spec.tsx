// @vitest-environment jsdom
/**
 * Version caption + version reader: the caption renders the product version
 * pinned to the corner, preferring the desktop bridge's packaged-app version
 * and falling back to the host boot-graph version; it renders nothing when
 * neither carrier has a usable version.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { DshWindow } from '@deepseek-ai/dsh-client-modules/client'
import { appVersion } from '../src/client/app-version.ts'
import { VersionCaption } from '../src/client/VersionCaption.tsx'

const win = window as unknown as DshWindow & Window

function setBoot(version: string): void {
  win.__DSH_BOOT__ = { rev: 'r', version, entries: [] }
}

afterEach(() => {
  cleanup()
  delete win.dshDesktop
  delete win.__DSH_BOOT__
})

describe('appVersion', () => {
  it('returns undefined when neither carrier has a version', () => {
    expect(appVersion()).toBeUndefined()
  })

  it('prefers the desktop bridge version', () => {
    win.dshDesktop = { frame: 'native', productName: 'DSHCode', appVersion: '1.2.3', showMenu: () => {}, restart: () => {} }
    setBoot('9.9.9')
    expect(appVersion()).toBe('1.2.3')
  })

  it('falls back to the boot-graph version when the bridge has none', () => {
    win.dshDesktop = { frame: 'native', productName: 'DSHCode', appVersion: '', showMenu: () => {}, restart: () => {} }
    setBoot('4.5.6')
    expect(appVersion()).toBe('4.5.6')
  })

  it('falls back to the boot-graph version when the bridge is absent', () => {
    setBoot('7.8.9')
    expect(appVersion()).toBe('7.8.9')
  })

  it('ignores a boot graph without a usable version', () => {
    win.__DSH_BOOT__ = { rev: 'r', entries: [] }
    expect(appVersion()).toBeUndefined()
    win.__DSH_BOOT__ = { rev: 'r', version: '', entries: [] }
    expect(appVersion()).toBeUndefined()
    win.__DSH_BOOT__ = null
    expect(appVersion()).toBeUndefined()
  })
})

describe('VersionCaption', () => {
  it('renders nothing without a version', () => {
    const { container } = render(<VersionCaption />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the bridge version with a V prefix', () => {
    win.dshDesktop = { frame: 'native', productName: 'DSHCode', appVersion: '1.0.0', showMenu: () => {}, restart: () => {} }
    render(<VersionCaption />)
    expect(screen.getByText('V1.0.0')).toBeTruthy()
  })

  it('renders the boot-graph version when the bridge is absent', () => {
    setBoot('1.0.0')
    render(<VersionCaption />)
    expect(screen.getByText('V1.0.0')).toBeTruthy()
  })
})
