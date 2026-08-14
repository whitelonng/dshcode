/** End-to-end gateway tests over a mocked registry and a real temp home. */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { apply, CHANNEL, Config, inject } from '../src/index.ts'
import type { Config as PluginInstallerConfig } from '../src/index.ts'
import { fetchWithTimeout } from '../src/registry.ts'
import * as tar from 'tar'

const tempRoots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.unstubAllGlobals()
})

const REGISTRY = 'https://reg.example/'

/** Build a fixture npm tarball whose package root is `package/`. */
async function fixtureTarball(dir: string, version: string): Promise<Buffer> {
  const pkg = join(dir, 'pkg')
  await mkdir(join(pkg, 'lib'), { recursive: true })
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@scope/demo', version }), 'utf8')
  await writeFile(join(pkg, 'lib', 'index.js'), 'module.exports = 1\n', 'utf8')
  const tarball = join(dir, 'demo.tgz')
  await tar.create({ gzip: true, cwd: dir, file: tarball }, ['pkg'])
  return Buffer.from(await readFile(tarball))
}

/** Stub global fetch with a packument + per-version tarballs for one package. */
function stubRegistry(directory: string, versions: string[], latest: string): void {
  const tarballs = new Map<string, Promise<Buffer>>()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
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
    if (cached !== undefined) return new Response(new Uint8Array(await cached), { status: 200 })
    const tarball = fixtureTarball(join(directory, `v-${version}`), version)
    tarballs.set(version, tarball)
    return new Response(new Uint8Array(await tarball), { status: 200 })
  })
}

async function harness(): Promise<{
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
  const config: PluginInstallerConfig = { dshHome: home, registry: REGISTRY, profilePatchPath: patchPath }
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

  it('turns a stalled registry request into a timeout error instead of hanging', async () => {
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        /* v8 ignore next -- the signal always carries a reason on abort */
        reject(init.signal?.reason)
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
})
