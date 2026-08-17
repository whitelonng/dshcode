/** End-to-end gateway tests over a mocked registry and a real temp home. */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { apply, CHANNEL, Config, inject, readInstalledIdentity, resolvePackageEntry, assertPackageEntry } from '../src/index.ts'
import type { Config as PluginInstallerConfig } from '../src/index.ts'
import { writeBootFailure, readSafeMode } from '../src/boot-failures.ts'
import { installPackageDependencies } from '../src/dependencies.ts'
import { fetchWithTimeout, installNpmPackage } from '../src/registry.ts'
import * as tar from 'tar'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
const execFileMock = vi.mocked(execFile)

const tempRoots: string[] = []
const contexts: Context[] = []

// Every gateway test runs through the pnpm probe; a bare mock would leave the
// probe promise pending forever, so fail it fast unless a test overrides.
beforeEach(() => {
  execFileMock.mockImplementation((_file, _args, _options, callback) => {
    const done = callback as unknown as (error: Error | null, result: { stdout: string; stderr: string }) => void
    done(new Error('pnpm unavailable'), { stdout: '', stderr: '' })
    return {} as never
  })
})

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.unstubAllGlobals()
})

const REGISTRY = 'https://reg.example/'

/** Build a fixture npm tarball whose package root is `package/`. */
async function fixtureTarball(
  dir: string,
  version: string,
  manifest?: Record<string, unknown>,
  extraFiles?: Record<string, string>,
): Promise<Buffer> {
  const pkg = join(dir, 'pkg')
  await mkdir(join(pkg, 'lib'), { recursive: true })
  const name = typeof manifest?.name === 'string' ? manifest.name : '@scope/demo'
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name, version, main: 'lib/index.js', ...manifest }), 'utf8')
  await writeFile(join(pkg, 'lib', 'index.js'), 'module.exports = 1\n', 'utf8')
  for (const [path, content] of Object.entries(extraFiles ?? {})) {
    await mkdir(join(pkg, path, '..'), { recursive: true })
    await writeFile(join(pkg, path), content, 'utf8')
  }
  const tarball = join(dir, 'demo.tgz')
  await tar.create({ gzip: true, cwd: dir, file: tarball }, ['pkg'])
  return Buffer.from(await readFile(tarball))
}

/** Stub global fetch with a packument + per-version tarballs for one package. */
function stubRegistry(directory: string, versions: string[], latest: string): void {
  const tarballs = new Map<string, Promise<Buffer>>()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
    if (url.pathname === '/@scope%2Fdemo') {
      return new Response(JSON.stringify({
        'dist-tags': { latest },
        versions: Object.fromEntries(versions.map(version => [
          version, { dist: { tarball: `${REGISTRY}demo-${version}.tgz` } },
        ])),
      }), { status: 200 })
    }
    const match = /^\/demo-(.+)\.tgz$/.exec(url.pathname)
    if (match === null) return new Response('not found', { status: 404 })
    const version = match[1]!
    const cached = tarballs.get(version)
    if (cached !== undefined) {
      const bytes = new Uint8Array(await cached)
      return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
    }
    const tarball = fixtureTarball(join(directory, `v-${version}`), version)
    tarballs.set(version, tarball)
    const bytes = new Uint8Array(await tarball)
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
  })
}

/** Stub global fetch with packuments + tarballs for several packages at once. */
function stubRegistryPackages(
  directory: string,
  packages: Array<{ name: string; versions: string[]; manifest?: Record<string, unknown>; files?: Record<string, string> }>,
): void {
  const packuments = new Map<string, string>()
  const tarballs = new Map<string, {
    dir: string
    version: string
    manifest?: Record<string, unknown> | undefined
    files?: Record<string, string> | undefined
  }>()
  for (const pkg of packages) {
    packuments.set(`/${pkg.name.replace('/', '%2F')}`, JSON.stringify({
      'dist-tags': { latest: pkg.versions[pkg.versions.length - 1] },
      versions: Object.fromEntries(pkg.versions.map(version => [
        version, { dist: { tarball: `${REGISTRY}tarballs/${pkg.name.replace('/', '-')}-${version}.tgz` } },
      ])),
    }))
    for (const version of pkg.versions) {
      tarballs.set(`/tarballs/${pkg.name.replace('/', '-')}-${version}.tgz`, {
        dir: directory, version, manifest: pkg.manifest, files: pkg.files,
      })
    }
  }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
    const packument = packuments.get(url.pathname)
    if (packument !== undefined) return new Response(packument, { status: 200 })
    const tarball = tarballs.get(url.pathname)
    if (tarball === undefined) return new Response('not found', { status: 404 })
    const buffer = await fixtureTarball(
      join(tarball.dir, `v-${tarball.version}`), tarball.version, tarball.manifest, tarball.files,
    )
    const bytes = new Uint8Array(buffer)
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
  })
}

/**
 * Build a gateway harness against a temp home. `registry` defaults to the
 * test registry; pass null to leave the key out (the gateway then falls back
 * to `npm_config_registry`, then the default registry).
 */
async function harness(
  registry: string | null = REGISTRY,
  githubMirror?: string,
  disableControlsOnInstall?: Array<{ id: string; matches: string[] }>,
): Promise<{
  ctx: Context
  handler: ConnectionRpcHandler
  home: string
  patchPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-'))
  tempRoots.push(root)
  const home = join(root, 'home')
  const patchPath = join(root, 'cordis.patch.yml')
  await writeFile(patchPath, '[]\n', 'utf8')
  const ctx = new Context()
  contexts.push(ctx)
  let handler: ConnectionRpcHandler | undefined
  const handle = vi.fn<HostConnectionHandle['rpc']['handle']>((channel, next) => {
    expect(channel).toBe(CHANNEL)
    handler = next
    return async () => {}
  })
  ctx.provide('connection', { rpc: { handle, intercept: vi.fn() } })
  ctx.provide('tools', { register: () => () => {}, schemas: () => [] })
  const config: PluginInstallerConfig = {
    dshHome: home,
    profilePatchPath: patchPath,
    ...(registry === null ? {} : { registry }),
    ...(githubMirror === undefined ? {} : { githubMirror }),
    ...(disableControlsOnInstall === undefined ? {} : { disableControlsOnInstall }),
  }
  const fiber = ctx.plugin({ Config, inject, apply }, config)
  await fiber.await()
  if (handler === undefined) throw new Error('plugin-installer handler was not registered')
  return { ctx, handler, home, patchPath }
}

async function call<T>(handler: ConnectionRpcHandler, endpoint: string, payload: unknown): Promise<T> {
  const result = await handler(endpoint, payload, new AbortController().signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value as T
}

describe('plugin-installer gateway', () => {
  it('installs from npm, lists, updates, and uninstalls through the patch layer', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-fixture-'))
    tempRoots.push(fixtureDir)
    stubRegistry(fixtureDir, ['0.9.0', '1.0.0'], '1.0.0')

    const h = await harness()
    const installed = await call<{ plugin: { id: string; version: string } }>(h.handler, 'install', { spec: '@scope/demo' })
    expect(installed.plugin.id).toBe('@scope/demo')
    expect(installed.plugin.version).toBe('1.0.0')
    expect(existsSync(join(h.home, 'profiles', 'node_modules', '@scope', 'demo', 'lib', 'index.js'))).toBe(true)

    const listed = await call<{ plugins: Array<{ id: string; version: string }> }>(h.handler, 'list', {})
    expect(listed.plugins.map(plugin => plugin.id)).toEqual(['@scope/demo'])

    const patchText = await readFile(h.patchPath, 'utf8')
    expect(patchText).toContain('dsh-plugin-installer: @scope/demo')
    expect(patchText).toContain('@scope/demo')

    // A newer latest makes check-updates report and update apply it.
    stubRegistry(fixtureDir, ['0.9.0', '1.0.0', '1.1.0'], '1.1.0')
    const updates = await call<{ updates: Array<{ id: string; latest: string }> }>(h.handler, 'check-updates', {})
    expect(updates.updates).toEqual([{ id: '@scope/demo', current: '1.0.0', latest: '1.1.0' }])

    const updated = await call<{ plugin: { version: string } }>(h.handler, 'update', { id: '@scope/demo' })
    expect(updated.plugin.version).toBe('1.1.0')

    const afterUninstall = await call<{ plugins: unknown[] }>(h.handler, 'uninstall', { id: '@scope/demo' })
    expect(afterUninstall.plugins).toEqual([])
    expect(existsSync(join(h.home, 'profiles', 'node_modules', '@scope', 'demo'))).toBe(false)
    expect(await readFile(h.patchPath, 'utf8')).not.toContain('dsh-plugin-installer: @scope/demo')
  })

  it('rejects unknown ids and invalid payloads with typed errors', async () => {
    const h = await harness()
    const missing = await h.handler('update', { id: 'ghost' }, new AbortController().signal)
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('unreachable')
    expect(missing.error.message).toContain('not installed')

    const invalid = await h.handler('install', { spec: '' }, new AbortController().signal)
    expect(invalid.ok).toBe(false)
    if (invalid.ok) throw new Error('unreachable')
    expect(invalid.error.code).toBe('bad-request')

    const unknown = await h.handler('nope', {}, new AbortController().signal)
    expect(unknown.ok).toBe(false)
    if (unknown.ok) throw new Error('unreachable')
    expect(unknown.error.code).toBe('bad-request')

    const badToggle = await h.handler('set-enabled', { id: 'ghost', enabled: 'yes' }, new AbortController().signal)
    expect(badToggle.ok).toBe(false)
    if (badToggle.ok) throw new Error('unreachable')
    expect(badToggle.error.code).toBe('bad-request')
  })

  it('rejects prose and pasted URLs before any registry request', async () => {
    const h = await harness()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const pasted = await h.handler('install', {
      spec: '嘿嘿，也欢迎大家试试我的生成式UI https://github.com/dsh-external/dsh-genui 和批注功能插件 https://github.com/dsh-external/dsh-annotation',
    }, new AbortController().signal)
    expect(pasted.ok).toBe(false)
    if (pasted.ok) throw new Error('unreachable')
    expect(pasted.error.message).toContain('invalid install spec')
    expect(pasted.error.message).toContain('one npm package name')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('persists enablement changes on the managed patch row', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-toggle-'))
    tempRoots.push(fixtureDir)
    stubRegistry(fixtureDir, ['1.0.0'], '1.0.0')

    const h = await harness()
    const installed = await call<{ plugin: { enabled: boolean } }>(h.handler, 'install', { spec: '@scope/demo' })
    expect(installed.plugin.enabled).toBe(true)

    const disabled = await call<{ plugin: { enabled: boolean } }>(
      h.handler, 'set-enabled', { id: '@scope/demo', enabled: false },
    )
    expect(disabled.plugin.enabled).toBe(false)
    expect(await readFile(h.patchPath, 'utf8')).toContain('disabled: true')
    const listed = await call<{ plugins: Array<{ enabled: boolean }> }>(h.handler, 'list', {})
    expect(listed.plugins[0]?.enabled).toBe(false)

    await call(h.handler, 'set-enabled', { id: '@scope/demo', enabled: true })
    expect(await readFile(h.patchPath, 'utf8')).toContain('disabled: false')
    const reenabled = await call<{ plugins: Array<{ enabled: boolean }> }>(h.handler, 'list', {})
    expect(reenabled.plugins[0]?.enabled).toBe(true)

    const missing = await h.handler('set-enabled', { id: 'ghost', enabled: false }, new AbortController().signal)
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('unreachable')
    expect(missing.error.message).toContain('not installed')
  })

  it('reports download progress from the tarball content length', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-progress-'))
    tempRoots.push(fixtureDir)
    const tarball = await fixtureTarball(fixtureDir, '1.0.0')
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(tarball), {
      status: 200,
      headers: { 'content-length': String(tarball.byteLength) },
    }))
    const packument = {
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { dist: { tarball: 'https://reg.example/demo.tgz' } } },
    }
    const seen: number[] = []
    await installNpmPackage('demo', '1.0.0', packument, join(fixtureDir, 'out'), undefined, (percent) => { seen.push(percent) })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(100)
  })

  it('reports the running mutation through status and resets to idle', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-status-'))
    tempRoots.push(fixtureDir)
    const tarball = await fixtureTarball(fixtureDir, '1.0.0')
    let releaseTarball!: () => void
    const gate = new Promise<void>((resolve) => { releaseTarball = resolve })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      if (url.pathname === '/@scope%2Fdemo') {
        return new Response(JSON.stringify({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { dist: { tarball: 'https://reg.example/demo.tgz' } } },
        }), { status: 200 })
      }
      await gate
      return new Response(new Uint8Array(tarball), {
        status: 200,
        headers: { 'content-length': String(tarball.byteLength) },
      })
    })
    const h = await harness()
    const installing = call(h.handler, 'install', { spec: '@scope/demo' })
    await vi.waitFor(async () => {
      const status = await call<{ progress: { kind: string } }>(h.handler, 'status', {})
      expect(status.progress.kind).toBe('install')
    })
    releaseTarball()
    await installing
    const idle = await call<{ progress: { kind: string } }>(h.handler, 'status', {})
    expect(idle.progress.kind).toBe('idle')
  })

  it('turns a stalled registry request into a timeout error instead of hanging', async () => {
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        /* v8 ignore next -- the signal always carries a reason on abort */
        const reason: unknown = init.signal?.reason
        reject(reason instanceof Error ? reason : new Error('aborted'))
      })
    }))
    await expect(fetchWithTimeout('https://reg.example/packument', {}, 20))
      .rejects.toThrow('plugin-installer: registry request timed out after 20ms')
  })

  it('rethrows non-timeout registry failures unchanged', async () => {
    const failure = new Error('registry unreachable')
    vi.stubGlobal('fetch', () => Promise.reject(failure))
    await expect(fetchWithTimeout('https://reg.example/packument', {}, 20)).rejects.toBe(failure)
  })

  it('serves boot failures with the plugin root and toggles safe mode', async () => {
    const h = await harness()
    await writeBootFailure(h.home, {
      pluginId: '@scope/demo', kind: 'load-failure', message: 'boom', stack: 'at demo', installPath: '/x', at: '',
    })
    const snapshot = await call<{ items: unknown[]; pluginRoot: string; safeMode: boolean }>(h.handler, 'failures', {})
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.pluginRoot).toBe(join(h.home, 'profiles'))
    expect(snapshot.safeMode).toBe(false)

    const enabled = await call<{ safeMode: boolean }>(h.handler, 'set-safe-mode', { enabled: true })
    expect(enabled.safeMode).toBe(true)
    expect(readSafeMode(h.home)).toBe(true)
    const after = await call<{ safeMode: boolean }>(h.handler, 'failures', {})
    expect(after.safeMode).toBe(true)

    const disabled = await call<{ safeMode: boolean }>(h.handler, 'set-safe-mode', { enabled: false })
    expect(disabled.safeMode).toBe(false)
    expect(readSafeMode(h.home)).toBe(false)

    const bad = await h.handler('set-safe-mode', { enabled: 'yes' }, new AbortController().signal)
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error('unreachable')
    expect(bad.error.code).toBe('bad-request')
  })

  it('clears recorded failures when the plugin is uninstalled', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-uninstall-failures-'))
    tempRoots.push(fixtureDir)
    stubRegistry(fixtureDir, ['1.0.0'], '1.0.0')

    const h = await harness()
    await call(h.handler, 'install', { spec: '@scope/demo' })
    await writeBootFailure(h.home, {
      pluginId: '@scope/demo', kind: 'hang', message: 'hung', stack: 'at demo', installPath: '/x', at: '',
    })
    const before = await call<{ items: unknown[] }>(h.handler, 'failures', {})
    expect(before.items).toHaveLength(1)

    await call(h.handler, 'uninstall', { id: '@scope/demo' })
    const after = await call<{ items: unknown[] }>(h.handler, 'failures', {})
    expect(after.items).toEqual([])
  })

  it('installs a bundle-style plugin: dependency tree, merged rows, enablement sync, uninstall', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-bundle-'))
    tempRoots.push(fixtureDir)
    const bundlePatch = `# from self
- insert:
    - id: ui-compat
      name: '@scope/demo'
- insert:
    - id: ui-new
      name: '@scope/dep-a'
`
    stubRegistryPackages(fixtureDir, [
      {
        name: '@scope/demo',
        versions: ['1.0.0'],
        manifest: {
          name: '@scope/demo',
          dsh: { bundle: { patch: './cordis.patch.yml' } },
          dependencies: { '@scope/dep-a': '2.0.0', '@scope/dep-b': '1.0.0' },
        },
        files: { 'cordis.patch.yml': bundlePatch },
      },
      {
        name: '@scope/dep-a',
        versions: ['2.0.0'],
        manifest: { name: '@scope/dep-a', dependencies: { '@scope/grand': '3.0.0' } },
      },
      // dep-b declares a self-dependency (skipped by the walk) and a diamond
      // edge onto grand (queued twice, installed once).
      {
        name: '@scope/dep-b',
        versions: ['1.0.0'],
        manifest: { name: '@scope/dep-b', dependencies: { '@scope/dep-b': '1.0.0', '@scope/grand': '3.0.0' } },
      },
      { name: '@scope/grand', versions: ['3.0.0'], manifest: { name: '@scope/grand' } },
    ])

    // A preset row already claims ui-taken; the merge must not duplicate it.
    const h = await harness()
    await writeFile(h.patchPath, `# dsh-plugin-control: web-ui
[{ insert: [ { id: ui-taken, name: "@scope/dep-b", disabled: true } ] }]
`, 'utf8')
    // Pre-existing fallback copies with broken versions are reinstalled to the
    // resolved target (a non-string version and an empty string both count as
    // "not installed").
    const fallback = join(h.home, 'profiles', 'node_modules')
    await mkdir(join(fallback, '@scope', 'dep-b'), { recursive: true })
    await writeFile(join(fallback, '@scope', 'dep-b', 'package.json'), JSON.stringify({ name: '@scope/dep-b', version: 42 }), 'utf8')
    await mkdir(join(fallback, '@scope', 'grand'), { recursive: true })
    await writeFile(join(fallback, '@scope', 'grand', 'package.json'), JSON.stringify({ name: '@scope/grand', version: '' }), 'utf8')

    const installed = await call<{ plugin: { id: string; version: string } }>(h.handler, 'install', { spec: '@scope/demo' })
    expect(installed.plugin.id).toBe('@scope/demo')
    expect(installed.plugin.version).toBe('1.0.0')

    // The transitive dependency tree landed in the fallback.
    for (const dep of ['@scope/dep-a', '@scope/dep-b', '@scope/grand']) {
      const manifest = JSON.parse(await readFile(join(fallback, dep, 'package.json'), 'utf8')) as { name: string }
      expect(manifest.name).toBe(dep)
    }
    const depA = JSON.parse(await readFile(
      join(fallback, '@scope', 'dep-a', 'package.json'), 'utf8',
    )) as { version: string }
    expect(depA.version).toBe('2.0.0')
    const grand = JSON.parse(await readFile(join(fallback, '@scope', 'grand', 'package.json'), 'utf8')) as { version: string }
    expect(grand.version).toBe('3.0.0')

    // Bundle rows merged; the preset-claimed id stayed single-owned.
    let patchText = await readFile(h.patchPath, 'utf8')
    expect(patchText).toContain('# dsh-plugin-bundle: @scope/demo')
    expect(patchText).toContain('id: ui-compat')
    expect(patchText).toContain('id: ui-new')
    expect(patchText.match(/ui-taken/g)).toHaveLength(1)

    // set-enabled mirrors the flag onto the merged rows.
    await call(h.handler, 'set-enabled', { id: '@scope/demo', enabled: false })
    patchText = await readFile(h.patchPath, 'utf8')
    expect(patchText).toContain('# dsh-plugin-bundle: @scope/demo')
    expect(patchText.match(/disabled: true/g)?.length).toBeGreaterThanOrEqual(2)

    // An update re-installs the root, refreshes the dependency tree (matching
    // copies are kept), and re-merges the rows idempotently.
    await call(h.handler, 'set-enabled', { id: '@scope/demo', enabled: true })
    await call(h.handler, 'update', { id: '@scope/demo' })
    patchText = await readFile(h.patchPath, 'utf8')
    expect(patchText.match(/dsh-plugin-bundle: @scope\/demo/g)).toHaveLength(2)
    const depAAfter = JSON.parse(await readFile(
      join(fallback, '@scope', 'dep-a', 'package.json'), 'utf8',
    )) as { version: string }
    expect(depAAfter.version).toBe('2.0.0')

    // Uninstall removes the installer and bundle rows but keeps the preset row.
    await call(h.handler, 'install', { spec: '@scope/dep-b' })
    await call(h.handler, 'uninstall', { id: '@scope/demo' })
    patchText = await readFile(h.patchPath, 'utf8')
    expect(patchText).not.toContain('dsh-plugin-bundle: @scope/demo')
    expect(patchText).not.toContain('dsh-plugin-installer: @scope/demo')
    expect(patchText).toContain('dsh-plugin-control: web-ui')
    expect(patchText).toContain('ui-taken')
    const remaining = await call<{ plugins: Array<{ id: string }> }>(h.handler, 'list', {})
    expect(remaining.plugins.map(plugin => plugin.id)).toEqual(['@scope/dep-b'])
    // Installed dependency packages stay in the fallback (untracked support files).
    expect(existsSync(join(h.home, 'profiles', 'node_modules', '@scope', 'dep-a'))).toBe(true)
  })

  it('reports a missing package.json with a typed error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-identity-'))
    tempRoots.push(root)
    await expect(readInstalledIdentity(root, 'git repository https://github.com/example/demo'))
      .rejects.toThrow('has no package.json')

    // A directory at the manifest path is a read failure, not a missing file.
    await mkdir(join(root, 'package.json'))
    await expect(readInstalledIdentity(root, 'git repository https://github.com/example/demo'))
      .rejects.toThrow('EISDIR')
    await rm(join(root, 'package.json'), { recursive: true, force: true })

    // A manifest without a name is invalid identity.
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }), 'utf8')
    await expect(readInstalledIdentity(root, 'npm package @scope/demo'))
      .rejects.toThrow('has no valid package.json name')

    // An empty version falls back to the git placeholder.
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@scope/demo', version: '' }), 'utf8')
    await expect(readInstalledIdentity(root, 'npm package @scope/demo'))
      .resolves.toMatchObject({ name: '@scope/demo', version: '0.0.0-git' })
  })

  it('resolves the declared package entry across manifest forms', () => {
    expect(resolvePackageEntry({ name: 'demo' })).toBe('index.js')
    expect(resolvePackageEntry({ main: 'lib/index.js' })).toBe('lib/index.js')
    expect(resolvePackageEntry({ main: '' })).toBe('index.js')
    expect(resolvePackageEntry({ exports: './lib/index.js' })).toBe('./lib/index.js')
    expect(resolvePackageEntry({ exports: { '.': './lib/index.js', './client': './lib/client.js' } })).toBe('./lib/index.js')
    expect(resolvePackageEntry({ exports: { './client': './lib/client.js' } })).toBe('index.js')
  })

  it('fails loud when the resolved entry point is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-entry-'))
    tempRoots.push(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo', main: 'lib/index.js' }), 'utf8')
    expect(() => { assertPackageEntry(root, 'lib/index.js', 'git repository https://github.com/example/demo') })
      .toThrow('has no entry point lib/index.js')
    expect(() => { assertPackageEntry(root, 'lib/index.js', 'git repository https://github.com/example/demo') })
      .toThrow('does not commit its build output')
    await mkdir(join(root, 'lib'), { recursive: true })
    await writeFile(join(root, 'lib', 'index.js'), 'module.exports = {}\n', 'utf8')
    expect(() => { assertPackageEntry(root, 'lib/index.js', 'git repository https://github.com/example/demo') }).not.toThrow()
  })

  it('installs a dependency tree without a progress callback', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-dep-standalone-'))
    tempRoots.push(fixtureDir)
    stubRegistryPackages(fixtureDir, [
      { name: '@scope/dep-a', versions: ['2.0.0'], manifest: { name: '@scope/dep-a' } },
    ])
    const h = await harness()
    await installPackageDependencies(
      { dependencies: { '@scope/dep-a': '2.0.0' } },
      join(h.home, 'profiles', 'node_modules'),
      REGISTRY,
    )
    const manifest = JSON.parse(await readFile(
      join(h.home, 'profiles', 'node_modules', '@scope', 'dep-a', 'package.json'), 'utf8',
    )) as { version: string }
    expect(manifest.version).toBe('2.0.0')
  })

  it('treats a dependency-free manifest as an empty tree', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-dep-empty-'))
    tempRoots.push(fixtureDir)
    stubRegistryPackages(fixtureDir, [{ name: '@scope/dep-a', versions: ['2.0.0'] }])
    const h = await harness()
    await expect(installPackageDependencies(
      {}, join(h.home, 'profiles', 'node_modules'), REGISTRY,
    )).resolves.toBeUndefined()
    expect(existsSync(join(h.home, 'profiles', 'node_modules', '@scope', 'dep-a'))).toBe(false)
  })

  it('installs a bundle-style plugin from a git repository end to end', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-git-'))
    tempRoots.push(fixtureDir)
    let head = 'abc123def4567890abcdef1234567890abcdef12'
    stubRegistryPackages(fixtureDir, [
      { name: '@scope/dep-a', versions: ['2.0.0'], manifest: { name: '@scope/dep-a' } },
    ])
    const registryFetch = globalThis.fetch
    // The codeload tarball for https://github.com/example/gitdemo: a root
    // `gitdemo-HEAD/` directory with the bundle manifest.
    const repoDir = join(fixtureDir, 'gitdemo-HEAD')
    await mkdir(join(repoDir, 'lib'), { recursive: true })
    await writeFile(join(repoDir, 'package.json'), JSON.stringify({
      name: '@scope/gitdemo',
      version: '1.0.0',
      main: 'lib/index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      dependencies: { '@scope/dep-a': '2.0.0' },
    }), 'utf8')
    await writeFile(join(repoDir, 'lib', 'index.js'), 'module.exports = 1\n', 'utf8')
    await writeFile(join(repoDir, 'cordis.patch.yml'),
      '- insert:\n    - id: ui-git\n      name: \'@scope/dep-a\'\n', 'utf8')
    const tarballFile = join(fixtureDir, 'repo.tgz')
    await tar.create({ gzip: true, cwd: fixtureDir, file: tarballFile }, ['gitdemo-HEAD'])
    const tarballBuffer = await readFile(tarballFile)
    const tarballBytes = new Uint8Array(new ArrayBuffer(tarballBuffer.byteLength))
    tarballBytes.set(tarballBuffer)
    // GitHub URLs install through the codeload tarball and the commits API;
    // registry requests keep flowing to the registry stub. This test covers
    // the self-rolled path: the pnpm probe stays unavailable.
    const seen: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      seen.push(url)
      if (url.startsWith('https://api.github.com/repos/example/gitdemo/commits/')) {
        return new Response(JSON.stringify({ sha: head }), { status: 200 })
      }
      if (url.startsWith('https://codeload.github.com/example/gitdemo/tar.gz/')) {
        return new Response(tarballBytes, { status: 200 })
      }
      return registryFetch(input)
    })

    const h = await harness()
    const installed = await call<{ plugin: { id: string; version: string; commit: string } }>(
      h.handler, 'install', { spec: 'https://github.com/example/gitdemo' },
    )
    expect(installed.plugin).toMatchObject({ id: '@scope/gitdemo', version: '1.0.0', commit: head })
    expect(seen).toContain('https://codeload.github.com/example/gitdemo/tar.gz/HEAD')
    expect(seen).toContain('https://api.github.com/repos/example/gitdemo/commits/HEAD')
    // The tarball path needs no git binary: no clone ran.
    expect(execFileMock).not.toHaveBeenCalledWith('git', expect.anything(), expect.anything(), expect.any(Function))

    // Identity validation, dependency tree, and merged bundle rows all ran.
    const depA = JSON.parse(await readFile(
      join(h.home, 'profiles', 'node_modules', '@scope', 'dep-a', 'package.json'), 'utf8',
    )) as { version: string }
    expect(depA.version).toBe('2.0.0')
    const patchText = await readFile(h.patchPath, 'utf8')
    expect(patchText).toContain('# dsh-plugin-bundle: @scope/gitdemo')
    expect(patchText).toContain('id: ui-git')

    // A moved remote HEAD reports an update; updating re-downloads and re-merges.
    head = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const updates = await call<{ updates: Array<{ id: string; latest: string }> }>(h.handler, 'check-updates', {})
    expect(updates.updates).toEqual([{ id: '@scope/gitdemo', current: '1.0.0', latest: 'deadbeefdead' }])
    await call(h.handler, 'update', { id: '@scope/gitdemo' })
    expect(await readFile(h.patchPath, 'utf8')).toContain('id: ui-git')
  })

  it('routes GitHub downloads and commit lookups through a configured mirror', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-mirror-'))
    tempRoots.push(fixtureDir)
    const tarball = await fixtureTarball(fixtureDir, '1.0.0', { name: '@scope/mirror-demo' })
    const bytes = new Uint8Array(new ArrayBuffer(tarball.byteLength))
    bytes.set(tarball)
    const seen: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      seen.push(url)
      if (url.includes('codeload.github.com')) return new Response(bytes, { status: 200 })
      if (url.includes('/commits/')) {
        return new Response(JSON.stringify({ sha: 'abc123def4567890abcdef1234567890abcdef12' }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })
    const h = await harness(REGISTRY, 'https://gh-proxy.com')
    const installed = await call<{ plugin: { id: string } }>(
      h.handler, 'install', { spec: 'https://github.com/example/mirror-demo' },
    )
    expect(installed.plugin.id).toBe('@scope/mirror-demo')
    expect(seen).toEqual([
      'https://gh-proxy.com/https://codeload.github.com/example/mirror-demo/tar.gz/HEAD',
      'https://gh-proxy.com/https://api.github.com/repos/example/mirror-demo/commits/HEAD',
    ])
  })

  it('rejects a non-http(s) mirror at load', async () => {
    await expect(harness(REGISTRY, 'gh-proxy.com')).rejects.toThrow('githubMirror must be an http(s) URL prefix')
  })

  it('rejects a git install whose package has no entry point', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-noentry-'))
    tempRoots.push(fixtureDir)
    const repoDir = join(fixtureDir, 'noentry-HEAD')
    await mkdir(repoDir, { recursive: true })
    await writeFile(join(repoDir, 'package.json'), JSON.stringify({
      name: '@scope/noentry', version: '1.0.0', main: 'lib/index.js',
    }), 'utf8')
    const tarballFile = join(fixtureDir, 'repo.tgz')
    await tar.create({ gzip: true, cwd: fixtureDir, file: tarballFile }, ['noentry-HEAD'])
    const tarballBuffer = await readFile(tarballFile)
    const tarballBytes = new Uint8Array(new ArrayBuffer(tarballBuffer.byteLength))
    tarballBytes.set(tarballBuffer)
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('codeload.github.com')) return new Response(tarballBytes, { status: 200 })
      if (url.includes('/commits/')) {
        return new Response(JSON.stringify({ sha: 'abc123def4567890abcdef1234567890abcdef12' }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })
    const h = await harness()
    const result = await h.handler('install', { spec: 'https://github.com/example/noentry' }, new AbortController().signal)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.message).toContain('has no entry point lib/index.js')
    expect(result.error.message).toContain('does not commit its build output')
  })

  it('rejects an npm install whose package has no entry point', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-npm-noentry-'))
    tempRoots.push(fixtureDir)
    stubRegistryPackages(fixtureDir, [
      { name: '@scope/noentry', versions: ['1.0.0'], manifest: { name: '@scope/noentry', main: 'lib/missing.js' } },
    ])
    const h = await harness()
    const result = await h.handler('install', { spec: '@scope/noentry' }, new AbortController().signal)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.message).toContain('has no entry point lib/missing.js')
  })

  it('accepts a pasted full dsh command and installs its spec', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-paste-'))
    tempRoots.push(fixtureDir)
    stubRegistryPackages(fixtureDir, [
      { name: '@scope/demo', versions: ['1.0.0'], manifest: { name: '@scope/demo' } },
    ])
    const h = await harness()
    const installed = await call<{ plugin: { id: string } }>(
      h.handler, 'install', { spec: 'dsh plugin --profile web add @scope/demo' },
    )
    expect(installed.plugin.id).toBe('@scope/demo')
  })

  it('disables a conflicting built-in product when a matching plugin installs', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-conflict-'))
    tempRoots.push(fixtureDir)
    stubRegistryPackages(fixtureDir, [
      { name: '@linxin666/dsh-web-ui-all', versions: ['0.1.15'], manifest: { name: '@linxin666/dsh-web-ui-all' } },
    ])
    const h = await harness(REGISTRY, undefined, [{ id: 'web-ui', matches: ['dsh-web-ui'] }])
    await writeFile(h.patchPath, `[
# dsh-plugin-control: web-ui
{ insert: [ { id: ui-skin-center, name: '@linxin666/dsh-client-ui-skin-center', disabled: false } ] }
]
`, 'utf8')
    const installed = await call<{ plugin: { id: string } }>(
      h.handler, 'install', { spec: '@linxin666/dsh-web-ui-all' },
    )
    expect(installed.plugin.id).toBe('@linxin666/dsh-web-ui-all')
    const text = await readFile(h.patchPath, 'utf8')
    expect(text).toContain("id: ui-skin-center, name: '@linxin666/dsh-client-ui-skin-center', disabled: true")
  })

  it('leaves a non-matching install alone under conflict rules', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-noconflict-'))
    tempRoots.push(fixtureDir)
    stubRegistryPackages(fixtureDir, [
      { name: '@scope/demo', versions: ['1.0.0'], manifest: { name: '@scope/demo' } },
    ])
    const h = await harness(REGISTRY, undefined, [{ id: 'web-ui', matches: ['dsh-web-ui'] }])
    await writeFile(h.patchPath, `[
# dsh-plugin-control: web-ui
{ insert: [ { id: ui-skin-center, name: '@linxin666/dsh-client-ui-skin-center', disabled: false } ] }
]
`, 'utf8')
    await call(h.handler, 'install', { spec: '@scope/demo' })
    const text = await readFile(h.patchPath, 'utf8')
    expect(text).toContain("id: ui-skin-center, name: '@linxin666/dsh-client-ui-skin-center', disabled: false")
  })

  it('rejects a whitespace-only install spec', async () => {
    const h = await harness()
    const result = await h.handler('install', { spec: '   ' }, new AbortController().signal)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.message).toContain('install spec must not be empty')
  })

  it('rejects uninstall of an unknown plugin and cancelled requests', async () => {
    const h = await harness()
    const missing = await h.handler('uninstall', { id: 'ghost' }, new AbortController().signal)
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('unreachable')
    expect(missing.error.message).toContain('not installed')

    const aborted = new AbortController()
    aborted.abort()
    const cancelled = await h.handler('install', { spec: '@scope/demo' }, aborted.signal)
    expect(cancelled.ok).toBe(false)
    if (cancelled.ok) throw new Error('unreachable')
    expect(cancelled.error.code).toBe('cancelled')
  })

  it('surfaces AggregateError failures through the gateway message', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-aggregate-'))
    tempRoots.push(fixtureDir)
    vi.stubGlobal('fetch', () => Promise.reject(new AggregateError([new Error('first'), new Error('second')], 'agg')))
    const h = await harness()
    const result = await h.handler('install', { spec: '@scope/demo' }, new AbortController().signal)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.message).toContain('agg: first; second')

    // An AggregateError without details folds to its own message.
    vi.stubGlobal('fetch', () => Promise.reject(new AggregateError([], 'bare-agg')))
    const bare = await h.handler('install', { spec: '@scope/demo' }, new AbortController().signal)
    expect(bare.ok).toBe(false)
    if (bare.ok) throw new Error('unreachable')
    expect(bare.error.message).toContain('bare-agg')

    // A non-Error rejection stringifies.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercising the non-Error rejection path on purpose
    vi.stubGlobal('fetch', () => Promise.reject('plain boom'))
    const plain = await h.handler('install', { spec: '@scope/demo' }, new AbortController().signal)
    expect(plain.ok).toBe(false)
    if (plain.ok) throw new Error('unreachable')
    expect(plain.error.message).toContain('plain boom')
  })

  it('falls back to npm_config_registry and then the default registry', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      seen.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      return new Response('nope', { status: 404 })
    })
    const saved = process.env.npm_config_registry
    process.env.npm_config_registry = 'https://env.example/'
    try {
      const h = await harness(null)
      await expect(call(h.handler, 'install', { spec: '@scope/demo' })).rejects.toThrow()
      expect(seen[0]).toContain('https://env.example/@scope%2Fdemo')
      seen.length = 0
      delete process.env.npm_config_registry
      const h2 = await harness(null)
      await expect(call(h2.handler, 'install', { spec: '@scope/demo' })).rejects.toThrow()
      expect(seen[0]).toContain('https://registry.npmjs.org/@scope%2Fdemo')
    } finally {
      if (saved === undefined) delete process.env.npm_config_registry
      else process.env.npm_config_registry = saved
    }
  })

  it('extracts a tarball without a content-length header', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-no-length-'))
    tempRoots.push(fixtureDir)
    const tarball = await fixtureTarball(fixtureDir, '1.0.0')
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(tarball), { status: 200 }))
    const packument = {
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { dist: { tarball: 'https://reg.example/demo.tgz' } } },
    }
    await installNpmPackage('demo', '1.0.0', packument, join(fixtureDir, 'out'))
    expect(existsSync(join(fixtureDir, 'out', 'lib', 'index.js'))).toBe(true)
  })

  it('searches index sources and manages the source set', async () => {
    const h = await harness()
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-catalog-'))
    tempRoots.push(fixtureDir)
    const catalog = join(fixtureDir, 'catalog.json')
    await writeFile(catalog, JSON.stringify({ repos: [
      { name: 'demo-one', url: 'https://github.com/o/demo', description: 'First demo', bundle: true },
      { name: 'other', url: 'https://github.com/o/other' },
    ] }), 'utf8')
    // The default hub source is unreachable in tests; per-source enumeration skips it.
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))

    const added = await call<{ source: { id: string } }>(h.handler, 'add-source', {
      locator: catalog, id: 'local', trust: 'untrusted',
    })
    expect(added.source.id).toBe('local')

    const listed = await call<{ sources: Array<{ id: string }> }>(h.handler, 'sources', {})
    expect(listed.sources.map(source => source.id)).toContain('local')

    const all = await call<{ plugins: Array<{ id: string; kind: string; trust: string }> }>(h.handler, 'search', {})
    expect(all.plugins).toContainEqual(expect.objectContaining({ id: 'demo-one', kind: 'bundle', trust: 'untrusted' }))

    const filtered = await call<{ plugins: Array<{ id: string }> }>(h.handler, 'search', { query: 'other' })
    expect(filtered.plugins.map(plugin => plugin.id)).toEqual(['other'])
    // A description-only match exercises the nullish-description fallback.
    const described = await call<{ plugins: Array<{ id: string }> }>(h.handler, 'search', { query: 'First' })
    expect(described.plugins.map(plugin => plugin.id)).toEqual(['demo-one'])

    // An add-source without an id or trust falls back to generated defaults.
    const generated = await call<{ source: { id: string; trust: string } }>(h.handler, 'add-source', { locator: catalog })
    expect(generated.source.id.startsWith('custom-')).toBe(true)
    expect(generated.source.trust).toBe('community')
    await call(h.handler, 'remove-source', { id: generated.source.id })

    const scoped = await call<{ plugins: unknown[] }>(h.handler, 'search', { source: 'local' })
    expect(scoped.plugins).toHaveLength(2)

    // A new locator is probed lazily and remembered.
    const probed = await call<{ plugins: unknown[] }>(h.handler, 'search', { source: catalog })
    expect(probed.plugins).toHaveLength(2)
    const afterProbe = await call<{ sources: Array<{ locator: string }> }>(h.handler, 'sources', {})
    expect(afterProbe.sources.some(source => source.locator === catalog)).toBe(true)

    const removed = await call<{ sources: Array<{ id: string }> }>(h.handler, 'remove-source', { id: 'local' })
    expect(removed.sources.some(source => source.id === 'local')).toBe(false)
  })

  it('records a TOFU lock on install', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-tofu-'))
    tempRoots.push(fixtureDir)
    stubRegistryPackages(fixtureDir, [{ name: '@scope/demo', versions: ['1.0.0'], manifest: { name: '@scope/demo' } }])
    const h = await harness()
    await call(h.handler, 'install', { spec: '@scope/demo' })
    const lockText = await readFile(join(h.home, 'plugin-sources', 'lock.yml'), 'utf8')
    expect(lockText).toContain('@scope/demo')
    expect(lockText).toContain('kind: plugin')
    expect(lockText).toContain('ref: "@scope/demo"')
  })

  it('records the registry integrity of the installed tarball', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-installer-integrity-'))
    tempRoots.push(fixtureDir)
    const tarball = await fixtureTarball(fixtureDir, '1.0.0')
    const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
    let declared = integrity
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url)
      if (url.pathname === '/@scope%2Fdemo') {
        return new Response(JSON.stringify({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { dist: { tarball: 'https://reg.example/demo.tgz', integrity: declared } } },
        }), { status: 200 })
      }
      return new Response(new Uint8Array(tarball), {
        status: 200, headers: { 'content-length': String(tarball.byteLength) },
      })
    })
    const h = await harness()
    const installed = await call<{ plugin: { integrity: string } }>(h.handler, 'install', { spec: '@scope/demo' })
    expect(installed.plugin.integrity).toBe(integrity)

    // An empty declaration skips verification and is not recorded.
    declared = ''
    const again = await call<{ plugin: { integrity?: string } }>(h.handler, 'install', { spec: '@scope/demo' })
    expect(again.plugin.integrity).toBeUndefined()
  })

  it('propagates non-missing state and failure-file read errors unchanged', async () => {
    const h = await harness()
    // A directory at the state path is EISDIR, not a missing file.
    await mkdir(h.home, { recursive: true })
    await mkdir(join(h.home, 'plugins.json'))
    const list = await h.handler('list', {}, new AbortController().signal)
    expect(list.ok).toBe(false)
    if (list.ok) throw new Error('unreachable')
    expect(list.error.message).toContain('EISDIR')

    await rm(join(h.home, 'plugins.json'), { recursive: true, force: true })
    await mkdir(join(h.home, 'boot-failures.json'))
    const failures = await h.handler('failures', {}, new AbortController().signal)
    expect(failures.ok).toBe(false)
    if (failures.ok) throw new Error('unreachable')
    expect(failures.error.message).toContain('EISDIR')
  })
})
