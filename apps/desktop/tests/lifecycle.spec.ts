import { describe, expect, it, vi } from 'vitest'
import {
  createQuitCoordinator,
  desktopApplicationUrl,
  desktopWebArguments,
  ensureMainModuleArgument,
  navigationDisposition,
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
