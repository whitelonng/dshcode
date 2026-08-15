/** System-pnpm delegation tests over a mocked child process. */

import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { apply, CHANNEL, Config, inject } from '../src/index.ts'
import type { Config as PluginInstallerConfig } from '../src/index.ts'
import {
  addProfileBundle,
  approvePendingBuilds,
  installViaPnpm,
  profileDirOf,
  readProfileBundles,
  readProfileIdentity,
  removeProfileBundle,
  removeViaPnpm,
  runPnpm,
} from '../src/pnpm.ts'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
const execFileMock = vi.mocked(execFile)

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  execFileMock.mockReset()
})

/** Answer the next pnpm invocation with an exit result. */
function answerPnpm(stdout = '', stderr = '', exitCode = 0): void {
  execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
    const done = callback as unknown as (error: Error | null, result: { stdout: string; stderr: string }) => void
    if (exitCode === 0) {
      done(null, { stdout, stderr })
    } else {
      const error = new Error(`Command failed with exit code ${exitCode}`) as Error & { code: number; stdout: string; stderr: string }
      error.code = exitCode
      error.stdout = stdout
      error.stderr = stderr
      done(error, { stdout, stderr })
    }
    return {} as never
  })
}

/** A temp profile dir with a manifest and workspace file. */
async function profileDir(deps: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pnpm-'))
  tempRoots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: deps,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }), 'utf8')
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\n', 'utf8')
  return root
}

describe('pnpmAvailable', () => {
  // The probe memoizes per module instance, so each case reloads the module.
  it('caches a successful probe', async () => {
    vi.resetModules()
    const mod = await import('../src/pnpm.ts')
    answerPnpm('10.0.0\n')
    await expect(mod.pnpmAvailable()).resolves.toBe(true)
    await expect(mod.pnpmAvailable()).resolves.toBe(true)
    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(execFileMock).toHaveBeenCalledWith(
      'pnpm', ['--version'], expect.objectContaining({ timeout: 10_000 }), expect.any(Function),
    )
  })

  it('finds an absolute pnpm when PATH hides it, and runs it', async () => {
    vi.resetModules()
    const mod = await import('../src/pnpm.ts')
    const seenOptions: Array<{ env?: NodeJS.ProcessEnv }> = []
    execFileMock.mockImplementation((file, args, options, callback) => {
      seenOptions.push(options as { env?: NodeJS.ProcessEnv })
      const done = callback as unknown as (error: Error | null, result: { stdout: string; stderr: string }) => void
      if (file === '/opt/homebrew/bin/pnpm' && args?.[0] === '--version') {
        done(null, { stdout: '10.0.0\n', stderr: '' })
      } else {
        done(new Error('not found'), { stdout: '', stderr: '' })
      }
      return {} as never
    })
    await expect(mod.pnpmAvailable()).resolves.toBe(true)
    expect(execFileMock).toHaveBeenCalledWith(
      '/opt/homebrew/bin/pnpm', ['--version'], expect.objectContaining({ timeout: 10_000 }), expect.any(Function),
    )
    expect(seenOptions[0]?.env?.PATH).toContain('/opt/homebrew/bin')
    answerPnpm('ok\n')
    await mod.runPnpm(['add', 'demo'], '/tmp/profile')
    expect(execFileMock).toHaveBeenCalledWith(
      '/opt/homebrew/bin/pnpm', ['add', 'demo'], expect.objectContaining({ cwd: '/tmp/profile' }), expect.any(Function),
    )
    expect(seenOptions[1]?.env?.PATH).toContain('/opt/homebrew/bin')
  })

  it('caches a failed probe as unavailable after trying every candidate', async () => {
    vi.resetModules()
    const mod = await import('../src/pnpm.ts')
    const probed: string[] = []
    execFileMock.mockImplementation((file, _args, _options, callback) => {
      probed.push(file)
      ;(callback as (error: Error, result: unknown) => void)(new Error('not found'), { stdout: '', stderr: '' })
      return {} as never
    })
    await expect(mod.pnpmAvailable()).resolves.toBe(false)
    await expect(mod.pnpmAvailable()).resolves.toBe(false)
    expect(probed).toEqual(mod.pnpmCandidatePaths())
    expect(probed).toContain('/opt/homebrew/bin/pnpm')
  })
})

describe('runPnpm', () => {
  it('rethrows a spawn failure without an exit code', async () => {
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
      const error = new Error('spawn pnpm ENOENT') as Error & { code: string }
      error.code = 'ENOENT'
      ;(callback as unknown as (error: Error, result: { stdout: string; stderr: string }) => void)(error, { stdout: '', stderr: '' })
      return {} as never
    })
    await expect(runPnpm(['add', 'demo'], '/tmp/profile')).rejects.toThrow('spawn pnpm ENOENT')
  })

  it('truncates oversized output to the bounded tail', async () => {
    answerPnpm('x'.repeat(9 * 1024))
    const result = await runPnpm(['add', 'demo'], '/tmp/profile')
    expect(result.exitCode).toBe(0)
    expect(result.tail.endsWith('…')).toBe(true)
    expect(result.tail.length).toBeLessThan(9 * 1024)
  })

  it('folds a non-zero exit into a result with the bounded tail', async () => {
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
      // No stdout/stderr props: the folded result falls back to empty strings.
      const error = new Error('failed') as Error & { code: number }
      error.code = 1
      ;(callback as unknown as (error: Error, result: { stdout: string; stderr: string }) => void)(error, { stdout: '', stderr: '' })
      return {} as never
    })
    await expect(runPnpm(['add', 'demo'], '/tmp/profile')).resolves.toEqual({ exitCode: 1, tail: '' })
  })
})

describe('approvePendingBuilds', () => {
  it('approves placeholders and leaves real entries alone', async () => {
    const dir = await profileDir()
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nallowBuilds:\n  ssh2: set this to true or false\n  kept: false\n', 'utf8')
    expect(approvePendingBuilds(dir)).toBe(true)
    const text = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8')
    expect(text).toContain('ssh2: true')
    expect(text).toContain('kept: false')
  })

  it('reports no approval for clean, malformed, or missing files', async () => {
    expect(approvePendingBuilds(await profileDir())).toBe(false)
    const dir = await profileDir()
    await writeFile(join(dir, 'pnpm-workspace.yaml'), '{ not yaml\n', 'utf8')
    expect(approvePendingBuilds(dir)).toBe(false)
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'allowBuilds:\n  kept-off: false\n', 'utf8')
    expect(approvePendingBuilds(dir)).toBe(false)
    const root = await mkdtemp(join(tmpdir(), 'dsh-pnpm-missing-'))
    tempRoots.push(root)
    expect(approvePendingBuilds(join(root, 'absent'))).toBe(false)
  })
})

describe('profile manifest and bundles', () => {
  it('appends, dedupes, and removes bundle layer entries', async () => {
    const dir = await profileDir()
    expect(readProfileBundles(dir)).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    await addProfileBundle(dir, '@scope/demo')
    await addProfileBundle(dir, '@scope/demo')
    expect(readProfileBundles(dir)).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@scope/demo'])
    await removeProfileBundle(dir, '@scope/demo')
    expect(readProfileBundles(dir)).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
  })

  it('resolves the profile directory from the patch path', () => {
    expect(profileDirOf('/home/user/.dsh/profiles/web/cordis.patch.yml')).toBe('/home/user/.dsh/profiles/web')
  })
})

/** Answer the next `pnpm add`, writing the dependency like real pnpm would. */
function answerPnpmAdd(dir: string, name: string, stdout = 'ok\n', exitCode = 0): void {
  execFileMock.mockImplementationOnce((_file, _args, _options, callback) => {
    const done = callback as unknown as (error: Error | null, result: { stdout: string; stderr: string }) => void
    if (exitCode === 0) {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      manifest.dependencies = { ...manifest.dependencies, [name]: '^1.0.0' }
      writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest), 'utf8')
      done(null, { stdout, stderr: '' })
    } else {
      const error = new Error('failed') as Error & { code: number; stdout: string; stderr: string }
      error.code = exitCode
      error.stdout = ''
      error.stderr = 'ERR_PNPM_IGNORED_BUILDS ignored builds: ssh2'
      done(error, { stdout: '', stderr: error.stderr })
    }
    return {} as never
  })
}

describe('installViaPnpm', () => {
  it('installs through pnpm and reports the added dependency names', async () => {
    const dir = await profileDir()
    answerPnpmAdd(dir, '@scope/demo')
    const result = await installViaPnpm(dir, '@scope/demo')
    expect(result.names).toEqual(['@scope/demo'])
    expect(execFileMock).toHaveBeenCalledWith('pnpm', ['add', '@scope/demo'], expect.anything(), expect.any(Function))
  })

  it('approves refused build scripts and retries once', async () => {
    const dir = await profileDir()
    answerPnpmAdd(dir, 'demo', 'ok\n', 1)
    // The first failure leaves pnpm's placeholders behind, as pnpm does.
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nallowBuilds:\n  ssh2: set this to true or false\n', 'utf8')
    answerPnpmAdd(dir, 'demo')
    const result = await installViaPnpm(dir, 'demo')
    expect(result.names).toEqual(['demo'])
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('fails loud with the output tail when pnpm keeps failing', async () => {
    const dir = await profileDir()
    answerPnpm('', 'registry unreachable', 1)
    await expect(installViaPnpm(dir, 'demo')).rejects.toThrow('pnpm add failed')
  })

  it('re-adds an already-present git dependency and reports its existing name', async () => {
    const dir = await profileDir({ '@dsh-external/demo': 'github:Nagi-ovo/demo' })
    answerPnpm('Already up to date\n')
    const result = await installViaPnpm(dir, 'github:Nagi-ovo/demo')
    expect(result.names).toEqual(['@dsh-external/demo'])
  })

  it('re-adds an already-present npm dependency by its parsed name', async () => {
    const dir = await profileDir({ '@scope/demo': '^1.0.0' })
    answerPnpm('Already up to date\n')
    const result = await installViaPnpm(dir, '@scope/demo')
    expect(result.names).toEqual(['@scope/demo'])
  })

  it('fails loud when pnpm succeeds yet no dependency matches the spec', async () => {
    const dir = await profileDir()
    answerPnpm('ok\n')
    await expect(installViaPnpm(dir, 'github:missing/demo')).rejects.toThrow('no package was added')
  })
})

describe('readProfileIdentity', () => {
  it('tolerates manifests without dependencies or a version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pnpm-bare-'))
    tempRoots.push(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'dsh-profile-web', private: true }), 'utf8')
    // No dependencies and no bundles: the nullish fallbacks apply everywhere.
    const dir = root
    // Removal on a manifest without a dependencies key falls back to empty.
    await expect(removeViaPnpm(dir, 'ghost')).resolves.toBeUndefined()
    // A successful add that writes nothing and matches no dependency fails.
    answerPnpm('ok\n')
    await expect(installViaPnpm(dir, 'demo')).rejects.toThrow('no package was added')
    // The writing flow then reports the added name as usual.
    answerPnpmAdd(dir, 'demo')
    const result = await installViaPnpm(dir, 'demo')
    expect(result.names).toEqual(['demo'])
    expect(readProfileBundles(dir)).toEqual([])
    await addProfileBundle(dir, 'demo')
    expect(readProfileBundles(dir)).toEqual(['demo'])

    // A manifest without a version falls back to the pnpm placeholder.
    await mkdir(join(dir, 'node_modules', 'noversion'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'noversion', 'package.json'), JSON.stringify({ name: 'noversion' }), 'utf8')
    await expect(readProfileIdentity(dir, 'noversion')).resolves.toMatchObject({ name: 'noversion', version: '0.0.0-pnpm' })
  })

  it('reads the installed identity from the hoisted profile node_modules', async () => {
    const dir = await profileDir()
    await mkdir(join(dir, 'node_modules', '@scope', 'demo'), { recursive: true })
    await writeFile(join(dir, 'node_modules', '@scope', 'demo', 'package.json'), JSON.stringify({ name: '@scope/demo', version: '2.0.0' }), 'utf8')
    await expect(readProfileIdentity(dir, '@scope/demo')).resolves.toMatchObject({ name: '@scope/demo', version: '2.0.0' })
  })

  it('rejects a manifest without a name', async () => {
    const dir = await profileDir()
    await mkdir(join(dir, 'node_modules', 'demo'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'demo', 'package.json'), JSON.stringify({ version: '1.0.0' }), 'utf8')
    await expect(readProfileIdentity(dir, 'demo')).rejects.toThrow('no valid package.json name')
  })
})

describe('removeViaPnpm', () => {
  it('removes a profile dependency and skips unknown names', async () => {
    const dir = await profileDir({ '@scope/demo': '^1.0.0' })
    answerPnpm('ok\n')
    await removeViaPnpm(dir, '@scope/demo')
    expect(execFileMock).toHaveBeenCalledWith('pnpm', ['remove', '@scope/demo'], expect.anything(), expect.any(Function))

    execFileMock.mockClear()
    await removeViaPnpm(dir, 'ghost')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('fails loud when pnpm remove exits non-zero', async () => {
    const dir = await profileDir({ '@scope/demo': '^1.0.0' })
    answerPnpm('', 'dependency locked', 1)
    await expect(removeViaPnpm(dir, '@scope/demo')).rejects.toThrow('pnpm remove failed')
  })
})

/** A minimal gateway harness: loopback handler over a temp home. */
async function gateway(): Promise<{ handler: ConnectionRpcHandler; home: string; patchPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pnpm-gateway-'))
  tempRoots.push(root)
  const home = join(root, 'home')
  const patchPath = join(root, 'cordis.patch.yml')
  await writeFile(patchPath, '[]\n', 'utf8')
  const ctx = new Context()
  let handler: ConnectionRpcHandler | undefined
  const handle = vi.fn<HostConnectionHandle['rpc']['handle']>((channel, next) => {
    expect(channel).toBe(CHANNEL)
    handler = next
    return async () => {}
  })
  ctx.provide('connection', { rpc: { handle, intercept: vi.fn() } })
  ctx.provide('tools', { register: () => () => {}, schemas: () => [] })
  const config: PluginInstallerConfig = { dshHome: home, profilePatchPath: patchPath }
  const fiber = ctx.plugin({ Config, inject, apply }, config)
  await fiber.await()
  if (handler === undefined) throw new Error('plugin-installer handler was not registered')
  return { handler, home, patchPath }
}

async function call<T>(handler: ConnectionRpcHandler, endpoint: string, payload: unknown): Promise<T> {
  const result = await handler(endpoint, payload, new AbortController().signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value as T
}

describe('gateway pnpm delegation', () => {
  it('delegates installs: bundle layer stack and plain insert rows', async () => {
    const g = await gateway()
    const profileDir = dirname(g.patchPath)
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web', private: true, dependencies: {},
      dsh: { profile: { bundles: [] } },
    }), 'utf8')
    await writeFile(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n', 'utf8')
    // A pnpm-capable mock: the probe, add (writes the dep + an installed
    // package), and remove all behave like real pnpm for this test.
    execFileMock.mockImplementation((file, args, _options, callback) => {
      const done = callback as unknown as (error: Error | null, result: { stdout: string; stderr: string }) => void
      void (async () => {
        if (file === 'pnpm' && args?.[0] === '--version') {
          done?.(null, { stdout: '10.0.0\n', stderr: '' })
          return
        }
        if (file === 'pnpm' && args?.[0] === 'add') {
          const spec = args[1]
          if (spec === undefined) throw new Error('fixture: add without a name')
          // Like real pnpm, git specs resolve to the package's real name with
          // the spec recorded verbatim as the dependency value.
          const isGit = spec.startsWith('github:') || spec.startsWith('https://')
          const name = isGit ? '@dsh-external/demo-git' : spec
          const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
          manifest.dependencies = { ...manifest.dependencies, [name]: isGit ? spec : '^1.0.0' }
          await writeFile(join(profileDir, 'package.json'), JSON.stringify(manifest), 'utf8')
          const isBundle = name === '@scope/demo-bundle'
          await mkdir(join(profileDir, 'node_modules', name), { recursive: true })
          await writeFile(join(profileDir, 'node_modules', name, 'package.json'), JSON.stringify({
            name,
            version: '1.0.0',
            main: 'lib/index.js',
            ...(isBundle ? { dsh: { bundle: { patch: './cordis.patch.yml' } } } : {}),
          }), 'utf8')
          await mkdir(join(profileDir, 'node_modules', name, 'lib'), { recursive: true })
          await writeFile(join(profileDir, 'node_modules', name, 'lib', 'index.js'), 'module.exports = {}\n', 'utf8')
          if (isBundle) {
            await writeFile(join(profileDir, 'node_modules', name, 'cordis.patch.yml'),
              '- insert:\n    - id: ui-row\n      name: \'@scope/demo-bundle\'\n', 'utf8')
          }
          done?.(null, { stdout: 'ok\n', stderr: '' })
          return
        }
        if (file === 'pnpm' && args?.[0] === 'remove') {
          done?.(null, { stdout: 'ok\n', stderr: '' })
          return
        }
        done?.(null, { stdout: '', stderr: '' })
      })()
      return {} as never
    })

    // A plain package gets a managed insert row and no bundle layer entry.
    const plain = await call<{ plugin: { id: string; enabled: boolean } }>(g.handler, 'install', { spec: 'demo-plain' })
    expect(plain.plugin).toMatchObject({ id: 'demo-plain', enabled: true })

    // A git spec records as a git source under its resolved name and updates
    // through the same path (the re-add reports the existing dependency name).
    const gitSpec = await call<{ plugin: { id: string; source: { kind: string; spec: string } } }>(
      g.handler, 'install', { spec: 'github:example/demo-git' },
    )
    expect(gitSpec.plugin).toMatchObject({ id: '@dsh-external/demo-git' })
    expect(gitSpec.plugin.source).toMatchObject({ kind: 'git', spec: 'github:example/demo-git' })
    await call(g.handler, 'update', { id: '@dsh-external/demo-git' })
    let patchText = await readFile(g.patchPath, 'utf8')
    expect(patchText).toContain('dsh-plugin-installer: demo-plain')
    expect((JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }).dsh?.profile?.bundles).toEqual([])

    // A bundle joins the layer stack and mounts without an installer row.
    const bundle = await call<{ plugin: { id: string } }>(g.handler, 'install', { spec: '@scope/demo-bundle' })
    expect(bundle.plugin.id).toBe('@scope/demo-bundle')
    patchText = await readFile(g.patchPath, 'utf8')
    expect(patchText).not.toContain('dsh-plugin-installer: @scope/demo-bundle')
    expect((JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }).dsh?.profile?.bundles)
      .toEqual(['@scope/demo-bundle'])

    // Disabling a bundle-layer plugin writes override rows for its patch ids.
    await call(g.handler, 'set-enabled', { id: '@scope/demo-bundle', enabled: false })
    patchText = await readFile(g.patchPath, 'utf8')
    expect(patchText).toContain('# dsh-plugin-bundle: @scope/demo-bundle')
    expect(patchText).toContain('id: ui-row')
    expect(patchText).toContain('disabled: true')
    const listed = await call<{ plugins: Array<{ id: string; enabled: boolean }> }>(g.handler, 'list', {})
    expect(listed.plugins.find(plugin => plugin.id === '@scope/demo-bundle')?.enabled).toBe(false)
    expect(listed.plugins.find(plugin => plugin.id === 'demo-plain')?.enabled).toBe(true)

    // Update re-resolves through pnpm. A plugin whose dependency key was
    // dropped (a migrated flat-fallback install) is re-added by the update,
    // so the name resolves from the newly added dependency.
    const manifestBefore = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
    if (manifestBefore.dependencies !== undefined) delete manifestBefore.dependencies['demo-plain']
    await writeFile(join(profileDir, 'package.json'), JSON.stringify(manifestBefore), 'utf8')
    await call(g.handler, 'update', { id: 'demo-plain' })
    await call(g.handler, 'update', { id: '@scope/demo-bundle' })
    await call(g.handler, 'uninstall', { id: '@scope/demo-bundle' })
    patchText = await readFile(g.patchPath, 'utf8')
    expect(patchText).not.toContain('# dsh-plugin-bundle: @scope/demo-bundle')
    expect((JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }).dsh?.profile?.bundles).toEqual([])

    await call(g.handler, 'uninstall', { id: 'demo-plain' })
    patchText = await readFile(g.patchPath, 'utf8')
    expect(patchText).not.toContain('dsh-plugin-installer: demo-plain')

    // A pnpm run that adds nothing fails the install instead of recording.
    execFileMock.mockImplementation((file, args, _options, callback) => {
      const done = callback as unknown as (error: Error | null, result: { stdout: string; stderr: string }) => void
      if (file === 'pnpm' && args?.[0] === '--version') {
        done?.(null, { stdout: '10.0.0\n', stderr: '' })
        return {} as never
      }
      done?.(null, { stdout: 'ok\n', stderr: '' })
      return {} as never
    })
    const empty = await g.handler('install', { spec: 'demo-ghost' }, new AbortController().signal)
    expect(empty.ok).toBe(false)
    if (empty.ok) throw new Error('unreachable')
    expect(empty.error.message).toContain('no package was added')
  })
})
