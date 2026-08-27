/**
 * Basename-to-absolute-path location for a dragged file: a browser drag data
 * transfer yields only the file's `name` (never its host path), so resolving
 * that name back to a real filesystem path — without staging the bytes — is
 * what lets a dragged non-image contribute nothing but a `@path` mention.
 * Work-in-progress results are never interpreted as paths here beyond
 * joining them against a root: the exact-basename walk is the precise, zero-
 * ambiguity tier a caller layers an optional system-wide search under.
 * @module @deepseek-ai/dsh-host-file-picker/locate
 */

import { readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

/** Default maximum absolute-path hits returned for one basename. */
export const DEFAULT_LOCATE_MAX_RESULTS = 5
/** Default maximum filesystem entries visited by one walk. */
export const DEFAULT_LOCATE_MAX_ENTRIES = 100_000
/** Directory basenames never descended by a location walk. */
export const DEFAULT_LOCATE_EXCLUDED_DIRECTORIES = ['.git', 'node_modules'] as const

/** Resolved limits and exclusions for one basename walk. */
export interface LocateFileOptions {
  /** Maximum absolute-path hits returned (default {@link DEFAULT_LOCATE_MAX_RESULTS}). */
  maxResults?: number
  /** Maximum directory entries visited before the walk stops (default {@link DEFAULT_LOCATE_MAX_ENTRIES}). */
  maxEntries?: number
  /** Directory basenames never descended (default {@link DEFAULT_LOCATE_EXCLUDED_DIRECTORIES}). */
  excludedDirectories?: readonly string[]
  /**
   * Optional wider tier appended after the walk returns fewer than
   * {@link LocateFileOptions.maxResults} matches: a system-wide search (spotlight,
   * `find`, …) returning absolute paths for the same basename. The caller owns
   * the search's own cost bounds.
   */
  systemSearch?: (name: string, signal: AbortSignal) => Promise<string[]>
}

/**
 * Validate one options object before a walk starts.
 * @param options - limits, exclusions, and the optional wider search tier.
 */
export function validateLocateOptions(options: LocateFileOptions): void {
  if (options.maxResults !== undefined && (!Number.isSafeInteger(options.maxResults) || options.maxResults <= 0)) {
    throw new Error('locate maxResults must be a positive safe integer')
  }
  if (options.maxEntries !== undefined && (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0)) {
    throw new Error('locate maxEntries must be a positive safe integer')
  }
  if (options.excludedDirectories?.some(name => name.length === 0 || name.includes('/') || name.includes('\\'))) {
    throw new Error('locate excludedDirectories entries must be non-empty directory basenames')
  }
}

/**
 * Resolve a file basename to absolute paths by walking a directory tree for
 * exact-basename matches, appending an optional system-wide tier only when the
 * walk itself returns fewer than the requested maximum. Results are unique,
 * deterministically ordered (the walk order), and never carry staged content.
 * @param root - absolute directory the exact walk is rooted at (a session workspace).
 * @param name - the dragged file's basename (leading directories are dropped).
 * @param options - limits, exclusions, and the optional wider search tier.
 * @param signal - caller cancellation; abort rejects with the signal reason.
 * @returns absolute paths in deterministic order.
 */
export async function locateByName(
  root: string,
  name: string,
  options: LocateFileOptions = {},
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted()
  validateLocateOptions(options)
  const needle = basename(name)
  if (needle === '' || needle === '.' || needle === '..') return []
  const maxResults = options.maxResults ?? DEFAULT_LOCATE_MAX_RESULTS
  const maxEntries = options.maxEntries ?? DEFAULT_LOCATE_MAX_ENTRIES
  const excluded = new Set(options.excludedDirectories ?? DEFAULT_LOCATE_EXCLUDED_DIRECTORIES)

  const hits: string[] = []
  const seen = new Set<string>()
  const queue: string[] = [resolve(root)]
  let visited = 0
  for (let cursor = 0; cursor < queue.length && hits.length < maxResults && visited < maxEntries; cursor += 1) {
    signal?.throwIfAborted()
    const directory = queue[cursor]
    /* v8 ignore next 3 -- cursor is bounded by this exact queue's length. */
    if (directory === undefined) {
      throw new Error('locate selected a missing directory')
    }
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (_error: unknown) {
      // An unreadable/missing subtree contributes no hits; other branches stay searchable.
      continue
    }
    visited += 1
    for (const entry of entries) {
      signal?.throwIfAborted()
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue
        queue.push(absolute)
      } else if (entry.isFile() && entry.name === needle) {
        /* v8 ignore next 6 -- a walk never revisits one path; the seen guard only dedupes the wider systemSearch tier. */
        if (!seen.has(absolute)) {
          seen.add(absolute)
          hits.push(absolute)
          if (hits.length >= maxResults) break
        }
      }
    }
  }

  if (hits.length < maxResults && options.systemSearch !== undefined) {
    for (const path of await options.systemSearch(needle, signal ?? new AbortController().signal)) {
      if (hits.length >= maxResults) break
      if (seen.has(path)) continue
      seen.add(path)
      hits.push(path)
    }
  }
  return hits
}
