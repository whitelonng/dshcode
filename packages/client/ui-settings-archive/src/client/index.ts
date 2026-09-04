/** Archived sessions settings section: wire face and section registration. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
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

/** Services required by the Settings registration and archived-session calls. */
export const inject = ['slots', 'locale', 'workspaces']

/** Contribute the archived-sessions section to Web Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-archive: dictionaries')

  const workspaces = ctx.get('workspaces') as IWorkspaces
  // Structural, not nominal: the service face arrives through ctx DI, and a
  // consumer plugin cannot import the error class as a value (cross-plugin
  // value imports are a bundle error). The service's command failure carries
  // the Host wire code as its plain `code` field.
  const toActionError = (reason: unknown): ArchiveActionError => {
    const code = (reason as { code?: unknown }).code
    if (reason instanceof Error && typeof code === 'string') {
      return new ArchiveActionError(code, reason.message)
    }
    return new ArchiveActionError('internal', `archived-session call failed: ${String(reason)}`)
  }
  const list = async (): Promise<ReturnType<typeof parseArchivedSessionList>> => {
    try {
      // The service face returns bare rows; the parser validates the envelope.
      return parseArchivedSessionList({ items: await workspaces.listArchived() })
    } catch (reason: unknown) {
      throw toActionError(reason)
    }
  }
  const restore = async (sessionId: string): Promise<void> => {
    try {
      // The section's injected face trades in decoded strings; the ids it
      // passes originate from the same Host-decoded listing.
      await workspaces.restoreSession(sessionId as SessionId)
    } catch (reason: unknown) {
      throw toActionError(reason)
    }
  }
  const remove = async (sessionId: string): Promise<void> => {
    try {
      await workspaces.deleteSession(sessionId as SessionId)
    } catch (reason: unknown) {
      throw toActionError(reason)
    }
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
