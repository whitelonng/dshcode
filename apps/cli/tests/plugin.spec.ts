/** `dsh plugin` pnpm-forwarding and build-approval tests. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
const spawnMock = vi.mocked(spawnSync)

import { approvePendingBuilds, runPlugin } from '../src/plugin.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  spawnMock.mockReset()
  vi.restoreAllMocks()
})

/** A temp profile directory with the generated pnpm-workspace.yaml. */
async function profileDir(workspace: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-cli-'))
  tempRoots.push(root)
  const dir = join(root, 'profiles', 'web')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }), 'utf8')
  await writeFile(join(dir, 'pnpm-workspace.yaml'), workspace, 'utf8')
  return dir
}

/** A completed spawnSync result. */
function result(status: number): ReturnType<typeof spawnSync> {
  return { status, error: undefined, ...({} as object) } as unknown as ReturnType<typeof spawnSync>
}

describe('approvePendingBuilds', () => {
  it('turns pnpm placeholders into approvals and leaves real entries alone', async () => {
    const dir = await profileDir(`packages:
  - .
allowBuilds:
  cloudflared: set this to true or false
  ssh2: set this to true or false
  kept-off: false
`)
    expect(approvePendingBuilds(dir)).toBe(true)
    const text = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8')
    expect(text).toContain('cloudflared: true')
    expect(text).toContain('ssh2: true')
    expect(text).toContain('kept-off: false')
  })

  it('reports no approval for clean, malformed, or missing workspace files', async () => {
    expect(approvePendingBuilds(await profileDir('packages:\n  - .\n'))).toBe(false)
    expect(approvePendingBuilds(await profileDir('{ not yaml\n'))).toBe(false)
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-cli-missing-'))
    tempRoots.push(root)
    expect(approvePendingBuilds(join(root, 'absent'))).toBe(false)
  })
})

describe('runPlugin', () => {
  it('approves refused build scripts and retries once before reconciling', async () => {
    const dir = await profileDir(`packages:
  - .
allowBuilds:
  ssh2: set this to true or false
`)
    const home = join(dir, '..', '..')
    const savedHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      spawnMock
        .mockReturnValueOnce(result(1))
        .mockReturnValueOnce(result(0))
      expect(runPlugin('web', ['add', '@scope/demo'])).toBe(0)
      expect(spawnMock).toHaveBeenCalledTimes(2)
      const workspace = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8')
      expect(workspace).toContain('ssh2: true')
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
      if (savedHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = savedHome
    }
  })

  it('returns the pnpm failure when no build approval is pending', async () => {
    const dir = await profileDir('packages:\n  - .\n')
    const home = join(dir, '..', '..')
    const savedHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      spawnMock.mockReturnValueOnce(result(1))
      expect(runPlugin('web', ['add', '@scope/demo'])).toBe(1)
      expect(spawnMock).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
      if (savedHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = savedHome
    }
  })
})
