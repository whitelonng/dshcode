import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SpawnWorker = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

const spawnMock = vi.hoisted(() => vi.fn<SpawnWorker>())

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: spawnMock,
}))

import { spawnDialogWorker } from '../src/win32-dialog-host.ts'

describe('spawnDialogWorker', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockReturnValue({} as ChildProcess)
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('forces the controlled child into Node mode without mutating the parent', () => {
    spawnDialogWorker({ title: 'Packaged Electron guard' })

    expect(spawnMock).toHaveBeenCalledOnce()
    const options = spawnMock.mock.calls[0]?.[2]
    expect({
      title: options?.env?.DSH_DIALOG_TITLE,
      runAsNode: options?.env?.ELECTRON_RUN_AS_NODE,
      windowsHide: options?.windowsHide,
    }).toEqual({
      title: 'Packaged Electron guard',
      runAsNode: '1',
      windowsHide: true,
    })
    expect(process.env.ELECTRON_RUN_AS_NODE).toBe('')
  })

  it('removes inherited flags that disable native TypeScript stripping', () => {
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=256 --no-experimental-strip-types --trace-warnings --no-strip-types')

    spawnDialogWorker({ title: 'NODE_OPTIONS guard' })

    expect(spawnMock).toHaveBeenCalledOnce()
    const options = spawnMock.mock.calls[0]?.[2]
    expect(options?.env?.NODE_OPTIONS).toBe('--max-old-space-size=256 --trace-warnings')
    expect(process.env.NODE_OPTIONS).toBe('--max-old-space-size=256 --no-experimental-strip-types --trace-warnings --no-strip-types')
  })

  it('drops NODE_OPTIONS entirely when it carried only the disabling flag', () => {
    vi.stubEnv('NODE_OPTIONS', '--no-strip-types')

    spawnDialogWorker({ title: 'NODE_OPTIONS sole-flag guard' })

    expect(spawnMock.mock.calls[0]?.[2]?.env?.NODE_OPTIONS).toBeUndefined()
  })

  it('passes no NODE_OPTIONS when the host did not set one', () => {
    vi.stubEnv('NODE_OPTIONS', undefined)

    spawnDialogWorker({ title: 'NODE_OPTIONS unset guard' })

    expect(spawnMock.mock.calls[0]?.[2]?.env?.NODE_OPTIONS).toBeUndefined()
  })

  it('launches the source worker under plain node with no loader flags', () => {
    spawnDialogWorker({ title: 'Source-plane guard' })

    expect(spawnMock).toHaveBeenCalledOnce()
    expect(spawnMock.mock.calls[0]?.[0]).toBe(process.execPath)
    expect(spawnMock.mock.calls[0]?.[1]).toEqual([fileURLToPath(new URL('../src/win32-dialog-worker.ts', import.meta.url))])
  })
})
