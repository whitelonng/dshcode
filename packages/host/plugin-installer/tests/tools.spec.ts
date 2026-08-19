/** Agent-facing plugin tool definitions over a stubbed gateway. */

import { describe, expect, it, vi } from 'vitest'
import { createPluginTools } from '../src/tools.ts'
import type { PluginInstallerGateway } from '../src/index.ts'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** A gateway stub carrying only the methods the tools call. */
function stubGateway(overrides: Partial<Record<'search' | 'install' | 'uninstall' | 'list', ReturnType<typeof vi.fn>>> = {}) {
  const gateway = {
    search: vi.fn().mockResolvedValue({ plugins: [] }),
    install: vi.fn().mockResolvedValue({ plugin: { id: '@scope/demo', version: '1.0.0' } }),
    uninstall: vi.fn().mockResolvedValue({ plugins: [] }),
    list: vi.fn().mockReturnValue({ plugins: [] }),
    ...overrides,
  } as unknown as PluginInstallerGateway & {
    search: ReturnType<typeof vi.fn>
    install: ReturnType<typeof vi.fn>
    uninstall: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
  }
  return { gateway, search: gateway.search, install: gateway.install, uninstall: gateway.uninstall, list: gateway.list }
}

/** The text of the first content block (all plugin_* renders emit text blocks). */
function firstText(blocks: ContentBlock[]): string {
  const first = blocks[0]
  if (first === undefined || first.type !== 'text') throw new Error('expected a text block')
  return first.text
}

describe('createPluginTools', () => {
  it('registers the four plugin_* tools in order', () => {
    const { gateway } = stubGateway()
    expect(createPluginTools(gateway).map(definition => definition.name))
      .toEqual(['plugin_search', 'plugin_install', 'plugin_uninstall', 'plugin_status'])
  })

  it('plugin_search enumerates through the gateway and renders lines', async () => {
    const { gateway, search } = stubGateway({
      search: vi.fn().mockResolvedValue({
        plugins: [{ id: 'demo', kind: 'bundle', source: 'github:o/r', faces: ['bundle'], sourceId: 'hub', trust: 'official', description: 'd' }],
      }),
    })
    const [searchTool] = createPluginTools(gateway)
    await expect(searchTool!.execute({ query: 'demo' }, {} as never)).resolves.toEqual({
      plugins: [{ id: 'demo', kind: 'bundle', source: 'github:o/r', faces: ['bundle'], sourceId: 'hub', trust: 'official', description: 'd' }],
    })
    expect(search).toHaveBeenCalledWith({ query: 'demo' })
    const render = searchTool!.output.render.bind(searchTool!.output)
    expect(render).toBeTruthy()
    const blocks = render({}, { plugins: [{ id: 'demo', kind: 'bundle', source: 'github:o/r', faces: ['bundle'], trust: 'official' }] })
    expect(firstText(blocks)).toContain('demo [official] (bundle · bundle) github:o/r')
    const empty = render({}, { plugins: [] })
    expect(firstText(empty)).toBe('(no plugins found)')
  })

  it('plugin_install rejects empty sources and reports the installed row', async () => {
    const { gateway, install } = stubGateway()
    const [, installTool] = createPluginTools(gateway)
    await expect(installTool!.execute({ source: '   ' }, {} as never)).rejects.toThrow('source must be a non-empty')
    await expect(installTool!.execute({ source: '@scope/demo' }, {} as never))
      .resolves.toEqual({ ok: true, plugin: { id: '@scope/demo', version: '1.0.0' }, needsRestart: true })
    expect(install).toHaveBeenCalledWith({ spec: '@scope/demo' })
    const blocks = installTool!.output.render({}, { ok: true, plugin: { id: '@scope/demo', version: '1.0.0' }, needsRestart: true })
    expect(firstText(blocks)).toContain('installed @scope/demo@1.0.0')
  })

  it('plugin_uninstall removes by id and renders the outcome', async () => {
    const { gateway, uninstall } = stubGateway()
    const [, , uninstallTool] = createPluginTools(gateway)
    await expect(uninstallTool!.execute({ id: ' @scope/demo ' }, {} as never)).resolves.toEqual({ ok: true })
    expect(uninstall).toHaveBeenCalledWith({ id: '@scope/demo' })
  })

  it('plugin_status lists every plugin and answers single-id lookups', async () => {
    const { gateway, list } = stubGateway({
      list: vi.fn().mockReturnValue({
        plugins: [
          { id: 'a', name: 'a', version: '1.0.0', source: { kind: 'npm', spec: 'a' }, enabled: true, installedAt: 'x' },
          { id: 'b', name: 'b', version: '2.0.0', source: { kind: 'git', spec: 'github:o/b' }, enabled: false, installedAt: 'x' },
        ],
      }),
    })
    const [, , , statusTool] = createPluginTools(gateway)
    await expect(statusTool!.execute({}, {} as never)).resolves.toEqual({
      plugins: [
        { id: 'a', version: '1.0.0', source: 'a', enabled: true },
        { id: 'b', version: '2.0.0', source: 'github:o/b', enabled: false },
      ],
    })
    await expect(statusTool!.execute({ id: 'b' }, {} as never)).resolves.toEqual({
      plugins: [{ id: 'b', version: '2.0.0', source: 'github:o/b', enabled: false }],
    })
    await expect(statusTool!.execute({ id: 'ghost' }, {} as never)).rejects.toThrow('is not installed')
    expect(list).toHaveBeenCalledTimes(3)
    const blocks = statusTool!.output.render({}, { plugins: [{ id: 'b', version: '2.0.0', source: 'github:o/b', enabled: false }] })
    expect(firstText(blocks)).toContain('[disabled]')
  })

  it('renders every output branch as text blocks', () => {
    const { gateway } = stubGateway()
    const [searchTool, installTool, uninstallTool, statusTool] = createPluginTools(gateway)
    const textOf = firstText
    // Search rows without trust, faces, or description render without markers.
    expect(textOf(searchTool!.output.render({}, { plugins: [{ id: 'bare', kind: 'plugin', source: 'bare', faces: [] }] })))
      .toBe('- bare (plugin) bare')
    expect(textOf(searchTool!.output.render({}, { plugins: [{ id: 'described', kind: 'plugin', source: 'bare', faces: [], description: 'd' }] })))
      .toBe('- described (plugin) bare — d')
    // Install/uninstall failure branches.
    expect(textOf(installTool!.output.render({}, { ok: false, plugin: { id: 'x', version: '1.0.0' }, needsRestart: true })))
      .toBe('plugin_install failed.')
    expect(textOf(uninstallTool!.output.render({}, { ok: false }))).toBe('plugin_uninstall failed.')
    // Status rows without the disabled marker.
    expect(textOf(statusTool!.output.render({}, { plugins: [{ id: 'a', version: '1.0.0', source: 'a', enabled: true }] })))
      .toBe('- a@1.0.0 (a)')
    // Every renderer stays a text block.
    for (const tool of [searchTool, installTool, uninstallTool, statusTool]) {
      const blocks = tool!.output.render({}, { plugins: [], ok: true, plugin: { id: 'x', version: '1.0.0' }, needsRestart: true })
      expect(blocks.every((block): block is ContentBlock => block.type === 'text')).toBe(true)
    }
  })
})
