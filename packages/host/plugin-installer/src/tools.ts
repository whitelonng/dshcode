/** Agent-facing plugin tools (plugin_* ×4) over the installer gateway. */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PluginInstallerGateway } from './index.ts'
import type { InstalledPlugin } from './types.ts'

/** The searchable catalog entry shape the model sees. */
const CATALOG_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['bundle', 'plugin'] },
    source: { type: 'string', required: true },
    faces: { type: 'array', items: { type: 'string' }, required: true },
    description: { type: 'string' },
    sourceId: { type: 'string', required: true },
    trust: { type: 'string' },
  },
} as const

function renderCatalog(_args: Record<string, unknown>, value: { plugins: Array<Record<string, unknown>> }): ContentBlock[] {
  const lines = value.plugins.map((entry) => {
    const trust = typeof entry.trust === 'string' ? ` [${entry.trust}]` : ''
    const faces = (entry.faces as string[]).length > 0 ? ` · ${(entry.faces as string[]).join('/')}` : ''
    const description = typeof entry.description === 'string' ? ` — ${entry.description}` : ''
    return `- ${String(entry.id)}${trust} (${String(entry.kind)}${faces}) ${String(entry.source)}${description}`
  })
  return [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : '(no plugins found)' }]
}

/**
 * Build the four agent-facing plugin tools over one gateway instance. The
 * browser panel and these tools read and write the same install state.
 * @param gateway - the owning gateway.
 * @returns the registry-ready definitions.
 */
export function createPluginTools(gateway: PluginInstallerGateway): ToolDefinition[] {
  return [
    defineTool({
      name: 'plugin_search',
      description: 'Search installable DSH plugins across the registered index sources (cached catalog '
        + 'enumeration with a 6h TTL; the default source is the dsh-external hub catalog). With `source`, '
        + 'probes that source — an index JSON file/URL (hub catalog format: {"repos": [...]}) — lazily and '
        + 'remembers it. Results carry the owning source and its trust level.',
      parameters: {
        query: { type: 'string', description: 'Substring to match against plugin id or description. Empty returns all.' },
        source: { type: 'string', description: 'A registered source id, or a new index JSON file/URL to probe and remember.' },
        refresh: { type: 'boolean', description: 'Force re-enumeration, ignoring cached snapshots.' },
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { plugins: { type: 'array', items: CATALOG_ITEM_SCHEMA, required: true } } }, render: renderCatalog },
      async execute(args) {
        const result = await gateway.search(args)
        return { plugins: result.plugins }
      },
    }),

    defineTool({
      name: 'plugin_install',
      description: 'Install a DSH plugin from an npm package name or git repository. A bundle plugin '
        + '(its manifest declares dsh.bundle) joins the profile bundle layer stack; a plain plugin gets '
        + 'a profile patch insert row. Changes apply after the application restarts.',
      parameters: {
        source: { type: 'string', required: true, description: 'Install source: an npm package name (bundle or plain plugin) or a git repository.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            plugin: { type: 'object', required: true, additionalProperties: false, properties: { id: { type: 'string', required: true }, version: { type: 'string', required: true } } },
            needsRestart: { type: 'boolean', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.ok ? `plugin_install: installed ${value.plugin.id}@${value.plugin.version} — restart the app to load it.` : 'plugin_install failed.' }],
      },
      async execute(args) {
        const trimmed = args.source.trim()
        if (trimmed === '') throw new Error('plugin_install: source must be a non-empty package name or repository')
        const { plugin } = await gateway.install({ spec: trimmed })
        return { ok: true, plugin: { id: plugin.id, version: plugin.version }, needsRestart: true }
      },
    }),

    defineTool({
      name: 'plugin_uninstall',
      description: 'Remove an installed DSH plugin by its id (package name): the dependency, the profile '
        + 'patch rows, and the recorded state entry. Changes apply after the application restarts.',
      parameters: {
        id: { type: 'string', required: true, description: 'Plugin id (npm package name) to remove.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.ok ? 'plugin_uninstall: plugin removed — restart the app to fully unload it.' : 'plugin_uninstall failed.' }],
      },
      async execute(args) {
        await gateway.uninstall({ id: args.id.trim() })
        return { ok: true }
      },
    }),

    defineTool({
      name: 'plugin_status',
      description: 'Show installed DSH plugins: id, version, install source, and saved enablement for each.',
      parameters: {
        id: { type: 'string', description: 'Plugin id or package name to inspect.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            plugins: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  version: { type: 'string', required: true },
                  source: { type: 'string', required: true },
                  enabled: { type: 'boolean', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const lines = value.plugins.map((entry: Record<string, unknown>) =>
            `- ${String(entry.id)}@${String(entry.version)} (${String(entry.source)})${entry.enabled === true ? '' : ' [disabled]'}`)
          return [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : '(no installed plugins)' }]
        },
      },
      execute(args) {
        const { plugins } = gateway.list()
        const id = args.id?.trim() ?? ''
        const rows: InstalledPlugin[] = id === '' ? plugins : plugins.filter(plugin => plugin.id === id || plugin.name === id)
        if (id !== '' && rows.length === 0) throw new Error(`plugin_status: "${id}" is not installed`)
        return Promise.resolve({
          plugins: rows.map(plugin => ({
            id: plugin.id,
            version: plugin.version,
            source: plugin.source.spec,
            enabled: plugin.enabled,
          })),
        })
      },
    }),
  ]
}
