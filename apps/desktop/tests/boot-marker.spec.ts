/** Boot lifecycle marker tests. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootMarkerPath, readBootMarker, writeBootMarker } from '../src/boot-marker.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-boot-marker-'))
  tempRoots.push(root)
  return root
}

describe('boot marker', () => {
  it('starts a fresh failure streak after a successful boot', async () => {
    const dir = await home()
    const started = await writeBootMarker(dir, 'started')
    expect(started.state).toBe('started')
    expect(started.bootAttempts).toBe(1)
    await writeBootMarker(dir, 'ok')
    const ok = await writeBootMarker(dir, 'ok')
    expect(ok.state).toBe('ok')
    expect(ok.bootAttempts).toBe(0)
    const restarted = await writeBootMarker(dir, 'started')
    expect(restarted.bootAttempts).toBe(1)
  })

  it('counts consecutive failed launches across the started marker', async () => {
    const dir = await home()
    await writeBootMarker(dir, 'started')
    const second = await writeBootMarker(dir, 'started')
    expect(second.bootAttempts).toBe(2)
    const third = await writeBootMarker(dir, 'started')
    expect(third.bootAttempts).toBe(3)
    const persisted = JSON.parse(await readFile(bootMarkerPath(dir), 'utf8')) as { bootAttempts: number; at: string }
    expect(persisted.bootAttempts).toBe(3)
    expect(typeof persisted.at).toBe('string')
  })

  it('reads a missing, corrupt, or invalid marker as absent', async () => {
    const dir = await home()
    expect(readBootMarker(dir)).toBeUndefined()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(bootMarkerPath(dir), '{not json', 'utf8')
    expect(readBootMarker(dir)).toBeUndefined()
    await writeFile(bootMarkerPath(dir), JSON.stringify({ state: 'weird', at: 5 }), 'utf8')
    expect(readBootMarker(dir)).toBeUndefined()
  })

  it('reads a persisted marker with defaults for optional fields', async () => {
    const dir = await home()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(bootMarkerPath(dir), JSON.stringify({ state: 'ok', at: '2026-01-01T00:00:00.000Z' }), 'utf8')
    expect(readBootMarker(dir)).toEqual({ state: 'ok', at: '2026-01-01T00:00:00.000Z', pid: undefined, bootAttempts: 0 })
  })
})
