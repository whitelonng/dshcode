/** Startup-failure attribution, watchdog, and recovery-record tests. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InstalledPluginRecord } from '@deepseek-ai/dsh-host-plugin-installer'
import { bootFailuresPath } from '@deepseek-ai/dsh-host-plugin-installer'
import { readPluginRowEnabled, setPluginRowEnabled } from '@deepseek-ai/dsh-host-plugin-installer'
import {
  attributeLoadFailure,
  BootHangError,
  clearResolvedFailures,
  failureMessage,
  hangSuspects,
  recordBootFailures,
  recoveryDecision,
  withBootTimeout,
} from '../src/recovery.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.useRealTimers()
})

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-recovery-'))
  tempRoots.push(dir)
  return dir
}

function installed(...names: string[]): InstalledPluginRecord[] {
  return names.map(name => ({
    id: name as InstalledPluginRecord['id'],
    name,
    version: '1.0.0',
    source: { kind: 'npm' as const, spec: name },
    installedAt: '2026-08-01T00:00:00.000Z',
  }))
}

describe('failure attribution', () => {
  it('names the installed plugins that appear in a load failure', () => {
    const error = new Error('dsh: 1 entry did not activate\n@scope/broken: boom\n@scope/fine: pending')
    expect(attributeLoadFailure(error, installed('@scope/fine', '@scope/broken', '@scope/other'))).toEqual([
      '@scope/fine', '@scope/broken',
    ])
    expect(attributeLoadFailure(new Error('nothing here'), installed('@scope/other'))).toEqual([])
  })

  it('suspends plugins installed after the last successful boot for a hang', () => {
    const rows = installed('@scope/old', '@scope/new')
    const newer = [...rows]
    newer[1] = { ...newer[1]!, installedAt: '2026-08-10T00:00:00.000Z' }
    expect(hangSuspects(newer, '2026-08-05T00:00:00.000Z')).toEqual(['@scope/new'])
    expect(hangSuspects(rows, '2026-08-05T00:00:00.000Z')).toEqual([])
    expect(hangSuspects(rows, undefined)).toEqual([])
    expect(hangSuspects(rows, 'not-a-date')).toEqual([])
  })

  it('classifies a thrown error as an attributable or unattributable load failure', () => {
    const error = new Error('plugin tree failed to load: @scope/broken: boom')
    expect(recoveryDecision({ error, installed: installed('@scope/broken'), lastOkAt: undefined })).toMatchObject({
      kind: 'attributable',
      pluginIds: ['@scope/broken'],
      hang: false,
      message: 'plugin tree failed to load: @scope/broken: boom',
    })
    expect(recoveryDecision({ error: new Error('host preparation failed'), installed: installed('@scope/broken'), lastOkAt: undefined }))
      .toMatchObject({ kind: 'unattributable', pluginIds: [], hang: false })
  })

  it('classifies a watchdog timeout as a hang blamed on recent installs', () => {
    const rows = installed('@scope/old', '@scope/new')
    rows[1] = { ...rows[1]!, installedAt: '2026-08-10T00:00:00.000Z' }
    const decision = recoveryDecision({
      error: new BootHangError('desktop boot did not settle within 60000 ms'),
      installed: rows,
      lastOkAt: '2026-08-05T00:00:00.000Z',
    })
    expect(decision).toMatchObject({ kind: 'attributable', pluginIds: ['@scope/new'], hang: true })
  })

  it('extracts a message and stack from any thrown value', () => {
    const error = failureMessage(new Error('boom'))
    expect(error.message).toBe('boom')
    expect(error.stack).toContain('boom')
    const fallback = failureMessage('plain string')
    expect(fallback.message).toBe('plain string')
    expect(fallback.stack).toBe('plain string')
  })
})

describe('boot watchdog', () => {
  it('resolves when the boot settles in time', async () => {
    await expect(withBootTimeout(Promise.resolve(42), 1_000)).resolves.toBe(42)
  })

  it('rejects with the original error when the boot fails in time', async () => {
    const error = new Error('boom')
    await expect(withBootTimeout(Promise.reject(error), 1_000)).rejects.toBe(error)
  })

  it('rejects with BootHangError when the boot never settles', async () => {
    vi.useFakeTimers()
    const pending = new Promise<never>(() => {})
    const raced = withBootTimeout(pending, 60_000)
    const assertion = expect(raced).rejects.toBeInstanceOf(BootHangError)
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
  })
})

describe('recovery records', () => {
  it('records one bounded entry per blamed plugin with the fallback install path', async () => {
    const dir = await root()
    await recordBootFailures(dir, {
      kind: 'attributable',
      pluginIds: ['@scope/broken', '@scope/hung'],
      message: 'boom',
      stack: 'at boom',
      hang: false,
    })
    const { readBootFailures } = await import('@deepseek-ai/dsh-host-plugin-installer')
    const records = readBootFailures(dir)
    expect(records.map(record => record.pluginId)).toEqual(['@scope/hung', '@scope/broken'])
    expect(records.every(record => record.kind === 'load-failure' && record.installPath.startsWith(join(dir, 'profiles', 'node_modules'))))
      .toBe(true)
    expect(records[0]?.at).not.toBe('')
  })

  it('records hang kind for a hang decision', async () => {
    const dir = await root()
    await recordBootFailures(dir, { kind: 'attributable', pluginIds: ['@scope/hung'], message: 'hung', stack: 'x', hang: true })
    const { readBootFailures } = await import('@deepseek-ai/dsh-host-plugin-installer')
    expect(readBootFailures(dir)[0]?.kind).toBe('hang')
  })

  it('clears the records of plugins that are enabled again after a successful boot', async () => {
    const dir = await root()
    const patchPath = join(dir, 'cordis.patch.yml')
    await writeFile(patchPath, '[]\n', 'utf8')
    const { writeBootFailure } = await import('@deepseek-ai/dsh-host-plugin-installer')
    await writeBootFailure(dir, { pluginId: 'on-again', kind: 'load-failure', message: 'm', stack: 's', installPath: '/x', at: '' })
    await writeBootFailure(dir, { pluginId: 'still-off', kind: 'load-failure', message: 'm', stack: 's', installPath: '/x', at: '' })
    await setPluginRowEnabled(patchPath, 'on-again', true)
    await setPluginRowEnabled(patchPath, 'still-off', false)

    await clearResolvedFailures(dir, patchPath)

    const { readBootFailures } = await import('@deepseek-ai/dsh-host-plugin-installer')
    const remaining = readBootFailures(dir)
    expect(remaining.map(record => record.pluginId)).toEqual(['still-off'])
    expect(readPluginRowEnabled(patchPath, 'on-again')).toBe(true)
  })

  it('ignores empty plugin ids while clearing resolved failures', async () => {
    const dir = await root()
    const patchPath = join(dir, 'cordis.patch.yml')
    await writeFile(patchPath, '[]\n', 'utf8')
    const { writeBootFailure, readBootFailures } = await import('@deepseek-ai/dsh-host-plugin-installer')
    await writeBootFailure(dir, { pluginId: '', kind: 'late-rejection', message: 'm', stack: 's', installPath: '', at: '' })
    await clearResolvedFailures(dir, patchPath)
    expect(readBootFailures(dir)).toHaveLength(1)
  })

  it('keeps the failures file bounded when the same plugin fails repeatedly', async () => {
    const dir = await root()
    for (let index = 0; index < 12; index += 1) {
      await recordBootFailures(dir, { kind: 'attributable', pluginIds: ['@scope/broken'], message: `attempt ${String(index)}`, stack: 's', hang: false })
    }
    const { readBootFailures } = await import('@deepseek-ai/dsh-host-plugin-installer')
    const records = readBootFailures(dir)
    expect(records).toHaveLength(1)
    expect(records[0]?.message).toBe('attempt 11')
    expect(bootFailuresPath(dir)).toBe(join(dir, 'boot-failures.json'))
  })
})
