/** Archived sessions settings section: wire face and section registration. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ArchiveSessionsSection, type ArchiveSessionsSectionInjected } from './ArchiveSessionsSection.tsx'
import { en, zh, type ArchiveLocaleKey } from './locales.ts'
import { ArchiveActionError, parseArchivedSessionList } from './protocol.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy for the archived-sessions settings section. */
    'settings.archive': ArchiveLocaleKey
  }
}

const NS = 'settings.archive'
const CHANNEL = '/api'
const LIST_ENDPOINT = 'workspace.listArchived'
const RESTORE_ENDPOINT = 'workspace.restoreSession'
const DELETE_ENDPOINT = 'workspace.deleteSession'

/** Services required by the Settings registration and RPC caller. */
export const inject = ['slots', 'locale', 'connection']

/** Contribute the archived-sessions section to Web Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-archive: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const call = async (endpoint: string, payload: unknown): Promise<unknown> => {
    const result = await connection.rpc.call(CHANNEL, endpoint, payload)
    if (!result.ok) {
      throw new ArchiveActionError(
        result.error.code,
        `workspace ${endpoint} failed: ${result.error.code}: ${result.error.message}`,
      )
    }
    return result.value
  }
  const list = async (): Promise<ReturnType<typeof parseArchivedSessionList>> =>
    parseArchivedSessionList(await call(LIST_ENDPOINT, {}))
  const restore = async (sessionId: string): Promise<void> => {
    await call(RESTORE_ENDPOINT, { sessionId })
  }
  const remove = async (sessionId: string): Promise<void> => {
    await call(DELETE_ENDPOINT, { sessionId })
  }
  const t = ctx.locale.bind(NS)
  const injected = (): ArchiveSessionsSectionInjected => ({ list, restore, remove })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'archive',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, ArchiveSessionsSection))
}
