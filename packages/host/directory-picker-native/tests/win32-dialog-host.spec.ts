import type { ChildProcess, SpawnOptions } from 'node:child_process'
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
})
