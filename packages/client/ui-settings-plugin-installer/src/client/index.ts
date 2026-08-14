/** Merged plugin-list Settings tab: user plugins + built-in enablement. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { PluginInstallerTab, type PluginInstallerTabInjected } from './PluginInstallerTab.tsx'
import { en, zh, type PluginInstallerLocaleKey } from './locales.ts'
import {
  parseInstalledPlugin,
  parseInstallStatus,
  parsePluginControlSnapshot,
  parsePluginList,
  parseUpdateList,
  type InstalledPluginItem,
  type InstallProgressItem,
  type PluginControlItem,
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

/** Services required by the Settings registration and RPC callers. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.pluginInventory']

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
    inventoryList,
    controlsList,
    controlsSetEnabled,
    controlsUninstall,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'plugins',
    order: 10,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
    inject: injected,
  }, PluginInstallerTab))
}
