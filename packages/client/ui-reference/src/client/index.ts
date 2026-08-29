/**
 * Unified Web `@` reference source. File and session discovery run through
 * the cancellable generated Remote namespaces in parallel with deterministic
 * ordering and labels.
 *
 * @module @deepseek-ai/dsh-client-ui-reference/client
 */
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ClientSessionContext, InputTriggerServiceContract, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference/types'
import { en, NS, zh, type ReferenceKey } from './locales.ts'

/** Required services: the trigger registry, the Remote namespaces, and the copy. */
export const inject = [
  'inputTriggers', 'locale', 'remote', 'remote.fileReferences', 'remote.sessionReferenceResolver',
]

/**
 * Register the combined `@file` / `@session` source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-reference: dictionaries')
  const t = ctx.locale.bind(NS)
  const source: InputTriggerSource = {
    trigger: '@',
    name: 'reference',
    showGroupTitle: false,
    async candidates(session: ClientSessionContext, { query, quoted, signal }) {
      const files = ctx.remote.fileReferences.list(session.sessionId, query, signal).then(
        result => result.ok ? result.value : [],
        () => [],
      )
      const sessions = quoted === true
        ? Promise.resolve([] as SessionReferenceMentionCandidate[])
        : ctx.remote.sessionReferenceResolver.candidates(session.sessionId, query, signal).then(
          result => result.ok ? result.value : [],
          () => [],
        )
      const [fileItems, sessionItems] = await Promise.all([files, sessions])
      if (signal.aborted) return []
      return [
        ...fileItems.flatMap(candidate => fileCandidate(candidate, quoted === true, t)),
        ...sessionItems.map(candidate => sessionCandidate(candidate, t)),
      ]
    },
    onPick({ candidate }) {
      const value = parseCandidate(candidate.value)
      if (value?.kind === 'file') {
        return value.fileKind === 'directory'
          ? { text: value.mention, continue: true }
          : {
            insert: {
              source: 'reference',
              ref: value.mention,
              label: value.label,
              appearance: 'file',
              clipboardText: value.mention,
            },
          }
      }
      if (value?.kind === 'session') {
        return {
          insert: {
            source: 'reference',
            ref: value.mention,
            label: value.label,
            appearance: 'session',
            clipboardText: value.mention,
          },
        }
      }
      return undefined
    },
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(ref),
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'ui-reference: @ source')
}

type Translate = (key: ReferenceKey) => string

type ReferenceCandidateValue =
  | { kind: 'file'; fileKind: FileReferenceCandidate['kind']; label: string; mention: string }
  | { kind: 'session'; label: string; mention: string }

function fileCandidate(candidate: FileReferenceCandidate, preserveQuote: boolean, t: Translate) {
  const mention = formatFileMention(candidate, preserveQuote)
  if (mention === undefined) return []
  const name = candidate.path.slice(candidate.path.lastIndexOf('/') + 1)
  const directory = candidate.kind === 'directory'
  const value: ReferenceCandidateValue = {
    kind: 'file',
    fileKind: candidate.kind,
    label: name,
    mention,
  }
  return [{
    name: `${t(directory ? 'candidate.folder' : 'candidate.file')} · ${name}${directory ? '/' : ''}`,
    description: candidate.path,
    section: t('section.files'),
    value: JSON.stringify(value),
  }]
}

function sessionCandidate(candidate: SessionReferenceMentionCandidate, t: Translate) {
  const location = candidate.cwd ?? t('candidate.noCwd')
  const description = `${candidate.label === candidate.sessionId ? '' : `${candidate.sessionId} · `}${location} · ${new Date(candidate.createdAt).toISOString()}`
  const value: ReferenceCandidateValue = {
    kind: 'session',
    label: candidate.label,
    mention: candidate.mention,
  }
  return {
    name: `${t('candidate.session')} · ${candidate.label}`,
    description,
    section: t('section.sessions'),
    value: JSON.stringify(value),
  }
}

function parseCandidate(value: string | undefined): ReferenceCandidateValue | undefined {
  if (value === undefined) return undefined
  return JSON.parse(value) as ReferenceCandidateValue
}
