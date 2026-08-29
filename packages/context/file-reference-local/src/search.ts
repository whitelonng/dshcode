/**
 * Host-workspace discovery for `@file` completion. The index contains paths
 * only: selected values remain ordinary prompt text and file contents stay
 * behind the model-facing `read` tool.
 *
 * @module @deepseek-ai/dsh-file-reference-local/search
 */

import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference'

export { activeAtToken, formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'

/** Default maximum file and directory candidates rendered for one query. */
export const DEFAULT_FILE_SEARCH_MAX_RESULTS = 20
/** Default maximum entries retained in one workspace search index. */
export const DEFAULT_FILE_SEARCH_MAX_ENTRIES = 10_000
/** Directory basenames omitted from traversal unless the deployment overrides them. */
export const DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES = ['.git', 'node_modules'] as const

/** Resolved limits and exclusions for one workspace index. */
export interface FileSearchConfig {
  /** Maximum ranked candidates returned for one query. */
  maxResults: number
  /** Maximum indexed files and directories. */
  maxEntries: number
  /** Directory basenames never traversed or offered. */
  excludedDirectories: readonly string[]
}

interface IndexedPath extends FileReferenceCandidate {}

interface RankedPath {
  candidate: FileReferenceCandidate
  score: number
}

interface IndexGeneration {
  controller: AbortController
  promise: Promise<IndexedPath[]>
}

/**
 * Cancellable, reusable fuzzy index rooted at one agent working directory.
 * Directory-scoped queries list live state; bare fuzzy queries share one
 * bounded traversal until the `@` interaction ends or a tool result invalidates it.
 */
export class WorkspaceFileSearch {
  private readonly excludedDirectories: ReadonlySet<string>
  private generation: IndexGeneration | undefined
  private disposed = false

  constructor(
    private readonly root: string,
    private readonly config: FileSearchConfig,
  ) {
    if (!Number.isSafeInteger(config.maxResults) || config.maxResults <= 0) {
      throw new Error('file search maxResults must be a positive safe integer')
    }
    if (!Number.isSafeInteger(config.maxEntries) || config.maxEntries <= 0) {
      throw new Error('file search maxEntries must be a positive safe integer')
    }
    if (config.excludedDirectories.some(name => name.length === 0 || name.includes('/') || name.includes('\\'))) {
      throw new Error('file search excludedDirectories entries must be non-empty directory basenames')
    }
    this.excludedDirectories = new Set(config.excludedDirectories)
  }

  /**
   * Return ranked path candidates for the current token.
   * @param rawQuery - path text following `@` or `@"`.
   * @param signal - cancels this caller's wait without killing an index shared by a newer query.
   * @returns at most `maxResults` deterministic candidates.
   */
  async list(rawQuery: string, signal: AbortSignal): Promise<FileReferenceCandidate[]> {
    signal.throwIfAborted()
    if (this.disposed) return []
    const query = rawQuery.replaceAll('\\', '/')
    const slash = query.lastIndexOf('/')
    if (query === '' || slash >= 0) {
      const directory = slash < 0 ? '' : query.slice(0, slash + 1)
      const fragment = slash < 0 ? '' : query.slice(slash + 1)
      return this.listDirectory(directory, fragment, signal)
    }
    const indexed = await waitForPromise(this.ensureIndex(), signal)
    return rankCandidates(
      indexed.filter(candidate => visibleForGlobalQuery(candidate.path, query)),
      query,
      this.config.maxResults,
    )
  }

  /** Discard the current index so the next bare query observes a fresh tree. */
  invalidate(): void {
    this.generation?.controller.abort(new Error('file search index invalidated'))
    this.generation = undefined
  }

  /** Abort traversal and make later queries return no candidates. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.invalidate()
  }

  private ensureIndex(): Promise<IndexedPath[]> {
    if (this.generation !== undefined) return this.generation.promise
    const controller = new AbortController()
    const generation = {
      controller,
      promise: Promise.resolve([] as IndexedPath[]),
    } satisfies IndexGeneration
    generation.promise = this.scanWorkspace(controller.signal).catch((error: unknown) => {
      /* v8 ignore next -- every owned abort clears `generation` synchronously; this only protects an unexpected scan failure */
      if (this.generation === generation) this.generation = undefined
      throw error
    })
    this.generation = generation
    return generation.promise
  }

  private async scanWorkspace(signal: AbortSignal): Promise<IndexedPath[]> {
    const indexed: IndexedPath[] = []
    const directories: { absolute: string; relative: string }[] = [{ absolute: this.root, relative: '' }]
    for (let cursor = 0; cursor < directories.length && indexed.length < this.config.maxEntries; cursor += 1) {
      signal.throwIfAborted()
      const directory = directories[cursor]
      /* v8 ignore next 3 -- cursor is bounded by this exact queue's length. */
      if (directory === undefined) {
        throw new Error('file search selected a missing directory')
      }
      const entries = await readDirectory(directory.absolute, signal)
      for (const entry of entries) {
        signal.throwIfAborted()
        const path = directory.relative === '' ? entry.name : `${directory.relative}/${entry.name}`
        if (entry.isDirectory()) {
          if (this.excludedDirectories.has(entry.name)) continue
          indexed.push({ path, kind: 'directory' })
          directories.push({ absolute: join(directory.absolute, entry.name), relative: path })
        } else if (entry.isFile()) {
          indexed.push({ path, kind: 'file' })
        }
        if (indexed.length >= this.config.maxEntries) break
      }
    }
    return indexed
  }

  private async listDirectory(
    displayDirectory: string,
    fragment: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidate[]> {
    if (displayDirectory.split('/').some(segment => this.excludedDirectories.has(segment))) return []
    const absolute = await resolveDisplayDirectory(this.root, displayDirectory, signal)
    if (absolute === undefined) return []
    const entries = await readDirectory(absolute, signal)
    const candidates: FileReferenceCandidate[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') && !fragment.startsWith('.')) continue
      if (entry.isDirectory()) {
        if (this.excludedDirectories.has(entry.name)) continue
        candidates.push({ path: `${displayDirectory}${entry.name}`, kind: 'directory' })
      } else if (entry.isFile()) {
        candidates.push({ path: `${displayDirectory}${entry.name}`, kind: 'file' })
      }
    }
    return rankCandidates(candidates, fragment, this.config.maxResults)
  }
}

async function resolveDisplayDirectory(
  root: string,
  displayDirectory: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const resolvedRoot = resolve(root)
  const absolute = resolve(resolvedRoot, displayDirectory === '' ? '.' : displayDirectory)
  const fromRoot = relative(resolvedRoot, absolute)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return undefined
  /* v8 ignore next -- only Windows can produce a cross-volume absolute relative path */
  if (isAbsolute(fromRoot)) return undefined
  let current = resolvedRoot
  for (const segment of fromRoot.split(sep).filter(Boolean)) {
    signal.throwIfAborted()
    current = join(current, segment)
    try {
      const status = await lstat(current)
      signal.throwIfAborted()
      if (status.isSymbolicLink() || !status.isDirectory()) return undefined
    } catch (_error: unknown) {
      signal.throwIfAborted()
      return undefined
    }
  }
  return absolute
}

async function readDirectory(absolute: string, signal: AbortSignal) {
  signal.throwIfAborted()
  try {
    const entries = await readdir(absolute, { withFileTypes: true })
    signal.throwIfAborted()
    return entries.sort((left, right) => compareText(left.name, right.name))
  } catch (_error: unknown) {
    signal.throwIfAborted()
    // An unreadable/missing subtree contributes no candidates; other readable
    // branches remain useful and autocomplete is advisory.
    return []
  }
}

function visibleForGlobalQuery(path: string, query: string): boolean {
  if (query.startsWith('.') || query.includes('/.')) return true
  return !path.split('/').some(segment => segment.startsWith('.'))
}

function rankCandidates(
  candidates: readonly FileReferenceCandidate[],
  query: string,
  limit: number,
): FileReferenceCandidate[] {
  const ranked: RankedPath[] = []
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, query)
    if (score !== undefined) ranked.push({ candidate, score })
  }
  ranked.sort((left, right) =>
    right.score - left.score
    || kindRank(left.candidate.kind) - kindRank(right.candidate.kind)
    || (query === '' ? 0 : left.candidate.path.length - right.candidate.path.length)
    || compareText(left.candidate.path, right.candidate.path))
  return ranked.slice(0, limit).map(entry => entry.candidate)
}

function scoreCandidate(candidate: FileReferenceCandidate, query: string): number | undefined {
  if (query === '') return 0
  const path = candidate.path.toLowerCase()
  const name = path.slice(path.lastIndexOf('/') + 1)
  const needle = query.toLowerCase()
  const directoryBonus = candidate.kind === 'directory' ? 25 : 0
  if (name === needle) return 1_000 + directoryBonus
  if (name.startsWith(needle)) return 900 + directoryBonus
  if (name.includes(needle)) return 700 + directoryBonus
  if (path.includes(needle)) return 500 + directoryBonus
  const subsequence = subsequenceScore(path, needle)
  return subsequence === undefined ? undefined : 300 + subsequence + directoryBonus
}

function subsequenceScore(target: string, query: string): number | undefined {
  let targetIndex = 0
  let gap = 0
  for (const character of query) {
    const found = target.indexOf(character, targetIndex)
    if (found < 0) return undefined
    gap += found - targetIndex
    targetIndex = found + 1
  }
  return Math.max(0, 100 - gap)
}

function kindRank(kind: FileReferenceCandidate['kind']): number {
  return kind === 'directory' ? 0 : 1
}

function compareText(left: string, right: string): number {
  /* v8 ignore next -- entries and candidates are unique; host enumeration
   * order determines which comparison direction sort requests. */
  return left < right ? -1 : left > right ? 1 : 0
}

function waitForPromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  /* v8 ignore next -- `list()` checks this signal immediately before its synchronous call into this helper */
  if (signal.aborted) return Promise.reject(errorReason(signal.reason, 'file search aborted'))
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => { rejectPromise(errorReason(signal.reason, 'file search aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        rejectPromise(errorReason(error, 'file search index failed'))
      },
    )
  })
}

function errorReason(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback, { cause: reason })
}
