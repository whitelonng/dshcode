/** Loopback-only plugin controls registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  PluginControlId,
  PluginControlSnapshot,
} from '@deepseek-ai/dsh-api-remotes/client'
import { PluginControlSettingsTab, type PluginControlSettingsTabInjected } from './PluginControlSettingsTab.tsx'
import { en, zh, type PluginControlLocaleKey } from './locales.ts'
import { parsePluginControlSnapshot } from './protocol.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for configured profile plugin controls. */
    'settings.pluginControl': PluginControlLocaleKey
  }
}

const NS = 'settings.pluginControl'
const CHANNEL = '/plugin-control'

/** Services required by the Settings registration and loopback RPC caller. */
export const inject = ['slots', 'locale', 'connection']

/** Contribute the lazy plugin-control tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-control: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS)
  const call = async (endpoint: string, payload: unknown): Promise<PluginControlSnapshot> => {
    const result = await connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result.ok) {
      throw new Error(`plugin-control ${endpoint} failed: ${result.error.code}: ${result.error.message}`)
    }
    return parsePluginControlSnapshot(result.value)
  }
  const list = (): Promise<PluginControlSnapshot> => call('list', {})
  const setEnabled = (pluginId: PluginControlId, enabled: boolean): Promise<PluginControlSnapshot> =>
    call('set-enabled', { pluginId, enabled })
  const injected = (): PluginControlSettingsTabInjected => ({
    isLoopback: connection.isLoopback,
    list,
    setEnabled,
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'controls',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginControlSettingsTab))
}
