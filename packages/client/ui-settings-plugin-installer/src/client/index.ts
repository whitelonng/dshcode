/** User-plugin install and update Settings tab. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginInstallerTab, type PluginInstallerTabInjected } from './PluginInstallerTab.tsx'
import { en, zh, type PluginInstallerLocaleKey } from './locales.ts'
import {
  parseInstalledPlugin,
  parsePluginList,
  parseUpdateList,
  type InstalledPluginItem,
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
const LIST_ENDPOINT = 'list'
const INSTALL_ENDPOINT = 'install'
const UPDATE_ENDPOINT = 'update'
const UNINSTALL_ENDPOINT = 'uninstall'
const CHECK_UPDATES_ENDPOINT = 'check-updates'

/** Services required by the Settings registration and RPC callers. */
export const inject = ['slots', 'locale', 'connection']

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
  const checkUpdates = async (): Promise<PluginUpdateItem[]> =>
    parseUpdateList(await call(CHECK_UPDATES_ENDPOINT, {}))
  const injected = (): PluginInstallerTabInjected => ({
    list,
    install,
    update,
    uninstall,
    checkUpdates,
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
