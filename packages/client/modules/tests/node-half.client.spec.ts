/** Node-half composition diagnostics for package metadata and built client bundles. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { renderIndexInjections, type WebServer, type WebRoute } from '@deepseek-ai/dsh-host-webserver'
import * as modulesClient from '../src/client/index.ts'
import { ClientModuleRegistry, bootInjections, orderByModuleGraph } from '../src/index.ts'
import type { ClientModuleLoaderTarget, WebBootEntry, WebBootGraph } from '../src/client/index.ts'

const MODULES_ID = '@deepseek-ai/dsh-client-modules'
const RUNTIME_ID = '@deepseek-ai/dsh-client-runtime'

let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

/** Create a resolvable package whose client export points at the returned path. */
function writePackage(
  packageName: string,
  metadata: Record<string, unknown> = { dsh: { client: { platform: 'web' } } },
): string {
  root ??= realpathSync(mkdtempSync(join(tmpdir(), 'dsh-client-modules-')))
  const pkgRoot = join(root, 'node_modules', ...packageName.split('/'))
  const clientPath = join(pkgRoot, 'lib', 'client.js')
  mkdirSync(pkgRoot, { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({
    name: packageName,
    exports: {
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    ...metadata,
  }))
  return clientPath
}

/** Create a built package with the supplied client declaration. */
function writeBuiltPackage(packageName: string, client: Record<string, unknown>): void {
  const clientPath = writePackage(packageName, { dsh: { client: { platform: 'web', ...client } } })
  mkdirSync(dirname(clientPath), { recursive: true })
  writeFileSync(clientPath, 'module.exports = {}\n')
}

/** Construct the node-half service and capture its plugin-bundle route. */
function constructWithRoute(packageNames: string[]): { service: ClientModuleRegistry; route: WebRoute } {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  ctx.provide('loader', {
    *entries() {
      for (const packageName of packageNames) {
        yield { options: { name: packageName }, fiber: {}, disabled: false }
      }
    },
  })
  let route: WebRoute | undefined
  const webServer: Pick<WebServer, 'port' | 'register' | 'tapIndex'> = {
    port: 0,
    register: (candidate) => {
      if (candidate.path === '/plugins') route = candidate
      return () => {}
    },
    tapIndex: () => () => {},
  }
  ctx.provide('webServer', webServer as WebServer)
  const service = new ClientModuleRegistry(ctx)
  if (route === undefined) throw new Error('client bundle route was not registered')
  return { service, route }
}

/** Construct the node-half service over the enabled fixture entries. */
function construct(packageNames: string[]): ClientModuleRegistry {
  return constructWithRoute(packageNames).service
}

/** Execute the exact first inline script emitted by the Host boot rows. */
function injectedFacade(graph: WebBootGraph): { html: string; target: ClientModuleLoaderTarget } {
  const html = renderIndexInjections(
    '<html><head></head><body><script type="module" src="/index.js"></script></body></html>',
    bootInjections(graph),
  )
  const source = /<head><script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (source === undefined) throw new Error('missing injected ModuleLoader facade script')
  const window: { __ModuleLoader__?: ClientModuleLoaderTarget } = {}
  runInNewContext(source, { window })
  if (window.__ModuleLoader__ === undefined) throw new Error('facade script did not install __ModuleLoader__')
  return { html, target: window.__ModuleLoader__ }
}

const bootGraph = (): WebBootGraph => ({
  rev: 'graph',
  entries: [
    { id: MODULES_ID, url: '/plugins/modules.js?rev=m', rev: 'm' },
    { id: RUNTIME_ID, url: '/plugins/runtime.js?rev=r', rev: 'r' },
  ],
})

describe('HTML bootstrap facade', () => {
  it('precedes blocking preloads and the boot graph, then becomes the live registration target', async () => {
    const graph = bootGraph()
    const { html, target } = injectedFacade(graph)
    const facadeAt = html.indexOf('window.__ModuleLoader__=')
    const modulesAt = html.indexOf('<script src="/plugins/modules.js?rev=m"></script>')
    const runtimeAt = html.indexOf('<script src="/plugins/runtime.js?rev=r"></script>')
    const graphAt = html.indexOf('globalThis["__DSH_BOOT__"] = ')
    const entryAt = html.indexOf('<script type="module" src="/index.js"></script>')
    expect([facadeAt, modulesAt, runtimeAt, graphAt, entryAt]).toEqual([...new Set([
      facadeAt, modulesAt, runtimeAt, graphAt, entryAt,
    ])].sort((a, b) => a - b))

    target.load({ id: MODULES_ID, factory: () => modulesClient })
    target.load({ id: RUNTIME_ID, factory: () => ({ marker: 'runtime' }) })
    const system = target.create({ boot: graph, staticModules: {} })

    expect(target.mode).toBe('live')
    expect(target.pendingQueue).toEqual([])
    expect(system.manifest.rev).toBe('graph')
    expect(await system.import(MODULES_ID)).toBe(modulesClient)
    expect(await system.import(`${RUNTIME_ID}/client`)).toEqual({ marker: 'runtime' })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow('create called after module-system boot')
  })

  it('rejects a page that did not preload the modules bundle', () => {
    const graph = bootGraph()
    const { target } = injectedFacade(graph)
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`HTML did not preload ${MODULES_ID}/client.js`)
  })

  it('rejects a bootstrap bundle with a runtime external', () => {
    const graph = bootGraph()
    const { target } = injectedFacade(graph)
    target.load({
      id: MODULES_ID,
      factory: (require) => {
        require('react')
        return modulesClient
      },
    })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`${MODULES_ID}/client.js requested external "react"`)
  })

  it.each([
    null,
    { ...modulesClient, createClientModuleSystem: undefined },
    { ...modulesClient, apply: undefined },
  ])('rejects a bootstrap bundle without the complete module face', (exports) => {
    const graph = bootGraph()
    const { target } = injectedFacade(graph)
    target.load({ id: MODULES_ID, factory: () => exports as unknown as Record<string, unknown> })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`${MODULES_ID}/client.js did not export the bootstrap module face`)
  })
})

describe('client bundle activation', () => {
  it('allows sibling dsh roles', () => {
    const currentName = '@fixture/current-client-field'
    const clientPath = writePackage(currentName, {
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web' },
        profile: { bundles: [] },
      },
    })
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')
    expect(construct([currentName]).graph().entries.map(entry => entry.id)).toEqual([currentName])
  })

  it('groups missing bundles under one source-build instruction with a package/path list', () => {
    const firstName = '@fixture/missing-first'
    const secondName = '@fixture/missing-second'
    const firstPath = writePackage(firstName)
    const secondPath = writePackage(secondName)
    expect(() => construct([firstName, secondName])).toThrow([
      'client-modules: 2 client packages failed to compose:',
      '  client bundles not found; run `pnpm run build` before launch:',
      `    - package: ${firstName}`,
      `      path: ${firstPath}`,
      `    - package: ${secondName}`,
      `      path: ${secondPath}`,
    ].join('\n'))
  })

  it('does not report other bundle read failures as missing builds', () => {
    const packageName = '@fixture/unreadable-client'
    const clientPath = writePackage(packageName)
    mkdirSync(clientPath, { recursive: true })
    let thrown: unknown
    try {
      construct([packageName])
    } catch (error) {
      thrown = error
    }
    expect(String(thrown)).toContain('client-modules: 1 client package failed to compose:')
    expect(String(thrown)).toContain('  other failures:')
    expect(String(thrown)).toContain('EISDIR')
    expect(String(thrown)).not.toContain('pnpm run build')
  })

  it('serves the source map beside a registered client bundle', async () => {
    const packageName = '@fixture/source-map'
    const clientPath = writePackage(packageName)
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')
    const map = '{"version":3,"sources":["src/client/index.tsx"]}\n'
    writeFileSync(`${clientPath}.map`, map)
    const { route } = constructWithRoute([packageName])
    let status = 0
    let headers: Record<string, string> | undefined
    let body = ''
    const response = {
      writeHead(nextStatus: number, nextHeaders?: Record<string, string>) {
        status = nextStatus
        headers = nextHeaders
        return response
      },
      end(chunk?: Uint8Array) {
        body = chunk === undefined ? '' : Buffer.from(chunk).toString('utf8')
        return response
      },
    } as unknown as ServerResponse

    await route.handler({
      method: 'GET',
      url: `/plugins/${packageName}/client.js.map`,
    } as IncomingMessage, response)

    expect(status).toBe(200)
    expect(headers).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
    })
    expect(body).toBe(map)
  })
})

describe('shared module declarations', () => {
  it('accepts external requests and carries them onto the graph row', () => {
    const packageName = '@fixture/shared-declared'
    writeBuiltPackage(packageName, { external: ['react'] })
    expect(construct([packageName]).graph().entries).toEqual([{
      id: packageName,
      url: expect.stringContaining(`/plugins/${packageName}/client.js?rev=`) as unknown as string,
      rev: expect.any(String) as unknown as string,
      external: ['react'],
    }])
  })

  it('omits external when the package declares no requests', () => {
    const packageName = '@fixture/shared-absent'
    writeBuiltPackage(packageName, {})
    const [row] = construct([packageName]).graph().entries
    expect(row).not.toHaveProperty('external')
  })

  it('rejects a non-array external', () => {
    const packageName = '@fixture/external-not-array'
    writeBuiltPackage(packageName, { external: 'react' })
    expect(() => construct([packageName]))
      .toThrow(`client-modules: ${packageName} dsh.client.external must be a string array`)
  })
})

describe('module graph order', () => {
  const entry = (id: string, fields: Partial<WebBootEntry> = {}): WebBootEntry =>
    ({ id, url: `/plugins/${id}/client.js?rev=0`, rev: '0', ...fields })
  const ids = (entries: readonly WebBootEntry[]): string[] => entries.map(row => row.id)

  it('places every requested package row before its consumers along a chain', () => {
    expect(ids(orderByModuleGraph([
      entry('ui', { external: ['slots'] }),
      entry('slots', { external: ['render'] }),
      entry('render'),
    ]))).toEqual(['render', 'slots', 'ui'])
  })

  it('places a shared package row before both arms of a diamond', () => {
    expect(ids(orderByModuleGraph([
      entry('app', { external: ['left', 'right'] }),
      entry('left', { external: ['vendor'] }),
      entry('right', { external: ['vendor'] }),
      entry('vendor'),
    ]))).toEqual(['vendor', 'left', 'right', 'app'])
  })

  it('resolves a /client request onto the requested package row', () => {
    expect(ids(orderByModuleGraph([
      entry('ui', { external: ['runtime/client'] }),
      entry('runtime'),
    ]))).toEqual(['runtime', 'ui'])
  })

  it('leaves a request no row answers to the static assembly channel', () => {
    expect(ids(orderByModuleGraph([
      entry('consumer', { external: ['@deepseek-ai/cordis'] }),
      entry('other'),
    ]))).toEqual(['consumer', 'other'])
  })

  it('rejects a cycle and names the packages on it', () => {
    expect(() => orderByModuleGraph([
      entry('a', { external: ['b'] }),
      entry('b', { external: ['a'] }),
    ])).toThrow('client-modules: module graph cycle a -> b -> a')
  })

  it('rejects a row requesting its own package name', () => {
    expect(() => orderByModuleGraph([entry('solo', { external: ['solo'] })]))
      .toThrow('client-modules: "solo" requests module "solo" that it answers itself')
  })

  it('composes the served graph in module-graph order', () => {
    const consumerName = '@fixture/order-consumer'
    const dependencyName = '@fixture/order-dependency'
    writeBuiltPackage(consumerName, { external: [dependencyName] })
    writeBuiltPackage(dependencyName, {})
    expect(ids(construct([consumerName, dependencyName]).graph().entries))
      .toEqual([dependencyName, consumerName])
  })

  it('fails activation loud when scanned packages form a module cycle', () => {
    writeBuiltPackage('@fixture/cycle-a', { external: ['@fixture/cycle-b'] })
    writeBuiltPackage('@fixture/cycle-b', { external: ['@fixture/cycle-a'] })
    expect(() => construct(['@fixture/cycle-a', '@fixture/cycle-b']))
      .toThrow('module graph cycle @fixture/cycle-a -> @fixture/cycle-b -> @fixture/cycle-a')
  })
})
