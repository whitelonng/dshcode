/** Merged plugin-list Settings tab: user plugins + built-in enablement. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { workspaceTitleOf, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { PluginInstallerTab, type PluginInstallerTabInjected } from './PluginInstallerTab.tsx'
import { en, zh, type PluginInstallerLocaleKey } from './locales.ts'
import {
  parseFailuresSnapshot,
  parseInstalledPlugin,
  parseInstallStatus,
  parsePluginControlSnapshot,
  parsePluginList,
  parseUpdateList,
  type InstalledPluginItem,
  type InstallProgressItem,
  type PluginControlItem,
  type PluginFailuresSnapshot,
  type PluginUpdateItem,
} from './protocol.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the merged plugin list tab. */
    'settings.pluginInstaller': PluginInstallerLocaleKey
  }
}

const NS = 'settings.pluginInstaller'
const CHANNEL = '/plugin-installer'
const CONTROL_CHANNEL = '/plugin-control'
const LIST_ENDPOINT = 'list'
const INSTALL_ENDPOINT = 'install'
const UPDATE_ENDPOINT = 'update'
const UNINSTALL_ENDPOINT = 'uninstall'
const SET_ENABLED_ENDPOINT = 'set-enabled'
const CHECK_UPDATES_ENDPOINT = 'check-updates'
const STATUS_ENDPOINT = 'status'
const FAILURES_ENDPOINT = 'failures'
const SET_SAFE_MODE_ENDPOINT = 'set-safe-mode'

/** Services required by the Settings registration and RPC callers. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.pluginInventory', 'workspaces', 'sessions']

/** Contribute the merged plugin list tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-installer: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const call = async (endpoint: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result.ok) {
      throw new Error(`plugin-installer ${endpoint} failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const list = async (): Promise<InstalledPluginItem[]> =>
    parsePluginList(await call(LIST_ENDPOINT, {}))
  const install = async (spec: string): Promise<InstalledPluginItem> =>
    parseInstalledPlugin(await call(INSTALL_ENDPOINT, { spec }))
  const update = async (id: string): Promise<InstalledPluginItem> =>
    parseInstalledPlugin(await call(UPDATE_ENDPOINT, { id }))
  const uninstall = async (id: string): Promise<InstalledPluginItem[]> =>
    parsePluginList(await call(UNINSTALL_ENDPOINT, { id }))
  const setEnabled = async (id: string, enabled: boolean): Promise<InstalledPluginItem> =>
    parseInstalledPlugin(await call(SET_ENABLED_ENDPOINT, { id, enabled }))
  const checkUpdates = async (): Promise<PluginUpdateItem[]> =>
    parseUpdateList(await call(CHECK_UPDATES_ENDPOINT, {}))
  const status = async (): Promise<InstallProgressItem> =>
    parseInstallStatus(await call(STATUS_ENDPOINT, {}))
  const failures = async (): Promise<PluginFailuresSnapshot> =>
    parseFailuresSnapshot(await call(FAILURES_ENDPOINT, {}))
  const setSafeMode = async (enabled: boolean): Promise<void> => {
    await call(SET_SAFE_MODE_ENDPOINT, { enabled })
  }
  /**
   * Start a repair conversation for a failed plugin: resolve a workspace over
   * the plugin install root (created once, reused after), open a fresh
   * session there, and seed its first prompt with the failure details. The
   * session's workspace is the plugin home so the agent's file tools reach
   * the plugin code without leaving the workspace boundary.
   * @param pluginRoot - absolute plugin install root.
   * @param message - the seeded first user message.
   * @returns resolution after the prompt is accepted and the session opens.
   */
  const repairPlugin = async (pluginRoot: string, message: string): Promise<void> => {
    const workspace = await ctx.workspaces.create({ path: pluginRoot })
    // A freshly created system workspace gets a friendly title; a pre-existing
    // one (already titled by the user) keeps it. A rename conflict must not
    // break the repair flow.
    if (workspace.title === workspaceTitleOf(workspace.path)) {
      await ctx.workspaces.rename(workspace.workspaceId, 'DSH 插件').catch(() => {})
    }
    const sessionId = await ctx.workspaces.connectWorkspace(workspace.workspaceId)
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`repair session ${sessionId} is unavailable`)
    const result = await binding.session.prompt([{ type: 'text', text: message }], 'queue')
    if (!result.ok) throw new Error(`repair prompt failed: ${result.error.code}: ${result.error.message}`)
    ctx.sessions.open(sessionId)
  }
  const controlCall = async (endpoint: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call(CONTROL_CHANNEL, endpoint, payload)
    if (!result.ok) {
      throw new Error(`plugin-control ${endpoint} failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const controlsList = async (): Promise<PluginControlItem[]> =>
    parsePluginControlSnapshot(await controlCall('list', {}))
  const controlsSetEnabled = async (pluginId: string, enabled: boolean): Promise<PluginControlItem[]> =>
    parsePluginControlSnapshot(await controlCall('set-enabled', { pluginId, enabled }))
  const controlsUninstall = async (pluginId: string): Promise<PluginControlItem[]> =>
    parsePluginControlSnapshot(await controlCall('uninstall', { pluginId }))
  const inventoryList = async (): Promise<PluginInventorySnapshot> => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const injected = (): PluginInstallerTabInjected => ({
    isLoopback: connection.isLoopback,
    list,
    install,
    update,
    uninstall,
    setEnabled,
    checkUpdates,
    status,
    failures,
    setSafeMode,
    repairPlugin,
    inventoryList,
    controlsList,
    controlsSetEnabled,
    controlsUninstall,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'plugins',
    // Distinct from the inventory tab's 10: both shipped order 10 once, and
    // the stable tie then followed registration order, which varies with
    // activation order — the two tabs swapped positions across environments.
    order: 20,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    inject: injected,
  }, PluginInstallerTab))
}
