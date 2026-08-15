/** Index-source enumeration: hub-catalog fetch, transform, snapshot caching. */

import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import type { EnumerateSnapshot, PluginCatalogEntry, PluginSourceRow } from './types.ts'
import { readSnapshot, snapshotFresh, writeSnapshot } from './sources.ts'

/** Index snapshot freshness window. */
export const INDEX_TTL_MS = 6 * 60 * 60 * 1000 // 6h

/**
 * Parse a github repository URL into owner/repo.
 * @param url - the repository URL.
 * @returns the owner/repo pair, or null for non-GitHub or malformed URLs.
 */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const prefix = 'https://github.com/'
  const trimmed = url.trim()
  if (!trimmed.startsWith(prefix)) return null
  const segments = trimmed.slice(prefix.length).split('/').filter(segment => segment !== '')
  if (segments.length !== 2) return null
  const [owner, repoWithGit] = segments
  if (owner === undefined || repoWithGit === undefined) return null
  const repo = repoWithGit.endsWith('.git') ? repoWithGit.slice(0, -4) : repoWithGit
  return { owner, repo }
}

/** The fetch surface tests can substitute. */
export interface FetchLike {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean
    status: number
    etag: string | null
    json(): Promise<unknown>
  }>
}

/**
 * Runtime fetch adapted to the test surface.
 * @param url - the request URL.
 * @param init - optional request headers.
 * @returns the reduced response surface (ok/status/etag/json).
 */
export const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init)
  return {
    ok: response.ok,
    status: response.status,
    etag: response.headers.get('etag'),
    json: () => response.json(),
  }
}

/**
 * Transform one hub-catalog repository row into a unified plugin entry.
 * @param raw - the catalog row (`{ name, url, description, bundle?, skill? }`).
 * @param sourceId - the owning index source id.
 * @returns the entry, or null for rows without a github repository URL.
 */
export function hubRepoToPlugin(raw: Record<string, unknown>, sourceId: string): PluginCatalogEntry | null {
  const name = typeof raw.name === 'string' ? raw.name : null
  const url = typeof raw.url === 'string' ? raw.url : null
  if (name === null || url === null) return null
  const github = parseGithubUrl(url)
  if (github === null) return null
  const description = typeof raw.description === 'string' ? raw.description : undefined
  const isBundle = raw.bundle === true
  const faces: string[] = []
  if (raw.skill === true) faces.push('skill')
  if (isBundle) faces.push('bundle')
  return {
    id: name,
    kind: isBundle ? 'bundle' : 'plugin',
    source: `github:${github.owner}/${github.repo}`,
    faces,
    ...(description !== undefined ? { description } : {}),
    sourceId,
  }
}

/**
 * Enumerate one index source: read the hub catalog (URL or local file path),
 * transform rows, and write a snapshot. A fresh snapshot is returned without
 * network; a stale one refetches with an If-None-Match header and keeps the
 * entries on 304 (only the timestamp refreshes).
 * @param dshHome - the Harness home (snapshot root).
 * @param source - the registered source row.
 * @param opts - refresh forces a refetch; now and fetch are test seams.
 * @returns the enumeration snapshot.
 */
export async function enumerateIndex(
  dshHome: string,
  source: PluginSourceRow,
  opts: { refresh?: boolean; now?: number; fetch?: FetchLike } = {},
): Promise<EnumerateSnapshot> {
  const now = opts.now ?? Date.now()
  const cached = readSnapshot(dshHome, source.id)
  if (cached !== null && opts.refresh !== true && snapshotFresh(cached, INDEX_TTL_MS, now)) {
    return cached
  }
  const filePath = source.locator.replace(/^file:\/\//, '')
  if (source.locator.startsWith('file:') || (!/^https?:/i.test(source.locator) && existsSync(filePath))) {
    const body = JSON.parse(readFileSync(filePath, 'utf8')) as { repos?: unknown[] }
    const rawRepos = Array.isArray(body.repos) ? body.repos : []
    const entries = rawRepos
      .map(raw => hubRepoToPlugin((raw ?? {}) as Record<string, unknown>, source.id))
      .filter((entry): entry is PluginCatalogEntry => entry !== null)
    const snapshot: EnumerateSnapshot = { fetchedAt: new Date(now).toISOString(), entries }
    writeSnapshot(dshHome, source.id, snapshot)
    return snapshot
  }
  const fetchImpl = opts.fetch ?? defaultFetch
  const headers: Record<string, string> = {}
  if (cached?.etag !== undefined && opts.refresh !== true) headers['If-None-Match'] = cached.etag
  const response = await fetchImpl(source.locator, { headers })
  if (response.status === 304 && cached !== null) {
    const refreshed: EnumerateSnapshot = {
      fetchedAt: new Date(now).toISOString(),
      ...(cached.etag !== undefined ? { etag: cached.etag } : {}),
      entries: cached.entries,
    }
    writeSnapshot(dshHome, source.id, refreshed)
    return refreshed
  }
  if (!response.ok) {
    throw new Error(`plugin-sources: index "${source.id}" fetch failed (${response.status}): ${source.locator}`)
  }
  const body = (await response.json()) as { repos?: unknown[] }
  const rawRepos = Array.isArray(body.repos) ? body.repos : []
  const entries = rawRepos
    .map(raw => hubRepoToPlugin((raw ?? {}) as Record<string, unknown>, source.id))
    .filter((entry): entry is PluginCatalogEntry => entry !== null)
  const snapshot: EnumerateSnapshot = {
    fetchedAt: new Date(now).toISOString(),
    ...(response.etag !== null ? { etag: response.etag } : {}),
    entries,
  }
  writeSnapshot(dshHome, source.id, snapshot)
  return snapshot
}
