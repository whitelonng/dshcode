/** npm registry interaction: metadata fetch, version resolution, tarball install. */

import { rmSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import semver from 'semver'
import * as tar from 'tar'

/** Default registry for installs and update checks. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'

/** Hard deadline for npm registry metadata requests. */
const PACKUMENT_TIMEOUT_MS = 30_000

/** Hard deadline for plugin tarball downloads. */
const TARBALL_TIMEOUT_MS = 60_000

/**
 * Fetch with a hard timeout, honoring an optional caller cancellation signal.
 * A stalled registry must surface as an error instead of leaving the UI in a
 * permanent installing state.
 * @param url - request URL.
 * @param init - fetch options (caller signal optional).
 * @param timeoutMs - hard deadline started at call time.
 * @returns the response.
 * @throws a descriptive error when the deadline elapses before the response.
 */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init.signal == null ? timeout : AbortSignal.any([init.signal, timeout])
  try {
    return await fetch(url, { ...init, signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`plugin-installer: registry request timed out after ${timeoutMs}ms`)
    }
    throw error
  }
}

/** One version row of the npm packument. */
interface NpmVersionEntry {
  dist?: { tarball?: string }
}

/** The subset of the npm packument the installer reads. */
export interface NpmPackument {
  'dist-tags': Record<string, string>
  versions: Record<string, NpmVersionEntry>
}

/**
 * Fetch the npm packument for one package.
 * @param name - unscoped or scoped package name.
 * @param registry - registry base URL (trailing slash optional).
 * @param signal - optional cancellation.
 * @returns the parsed packument.
 * @throws a typed error with the HTTP status when the registry rejects.
 */
export async function fetchPackument(name: string, registry: string, signal?: AbortSignal): Promise<NpmPackument> {
  const base = registry.endsWith('/') ? registry : `${registry}/`
  // Canonical scoped encoding: keep %2F escaped, decode only %40 (npm accepts @scope%2Fname).
  const url = `${base}${encodeURIComponent(name).replaceAll('%40', '@')}`
  const response = await fetchWithTimeout(url, {
    ...signal === undefined ? {} : { signal },
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  }, PACKUMENT_TIMEOUT_MS)
  if (!response.ok) {
    throw new Error(`plugin-installer: registry ${url} answered ${String(response.status)}`)
  }
  const packument = (await response.json()) as Partial<NpmPackument>
  if (typeof packument['dist-tags'] !== 'object' || packument['dist-tags'] === null
    || typeof packument.versions !== 'object' || packument.versions === null) {
    throw new Error(`plugin-installer: registry ${url} returned an invalid packument`)
  }
  return packument as NpmPackument
}

/**
 * Resolve the concrete version for one npm spec against a packument.
 * Supported forms: exact version, semver range, or `latest` (the default).
 * @param spec - version part of the install spec (`undefined` → latest).
 * @param packument - fetched metadata.
 * @returns the resolved version string.
 * @throws when nothing satisfies the spec.
 */
export function resolveNpmVersion(spec: string | undefined, packument: NpmPackument): string {
  const available = Object.keys(packument.versions)
  const latest = packument['dist-tags']?.latest
  if (spec === undefined || spec === '' || spec === 'latest') {
    if (latest === undefined || !available.includes(latest)) {
      throw new Error('plugin-installer: the packument has no dist-tags.latest version')
    }
    return latest
  }
  if (semver.valid(spec) !== null) {
    if (!available.includes(spec)) {
      throw new Error(`plugin-installer: version ${JSON.stringify(spec)} does not exist`)
    }
    return spec
  }
  const range = semver.validRange(spec)
  if (range === null) {
    throw new Error(`plugin-installer: unsupported version spec ${JSON.stringify(spec)}`)
  }
  const matched = semver.maxSatisfying(available, range, { includePrerelease: false })
  if (matched === null) {
    throw new Error(`plugin-installer: no version satisfies ${JSON.stringify(spec)}`)
  }
  return matched
}

/**
 * Parse an npm install spec into its name and optional version part.
 * @param spec - npm spec string (`name`, `@scope/name`, `name@version`, …).
 * @returns package name and version (undefined when the spec carries none).
 */
export function parseNpmSpec(spec: string): { name: string; version: string | undefined } {
  if (spec.startsWith('@')) {
    const at = spec.indexOf('@', 1)
    if (at === -1) return { name: spec, version: undefined }
    return { name: spec.slice(0, at), version: spec.slice(at + 1) }
  }
  const at = spec.indexOf('@')
  if (at === -1) return { name: spec, version: undefined }
  return { name: spec.slice(0, at), version: spec.slice(at + 1) }
}

/**
 * Whether an install spec names a git repository rather than an npm package.
 * @param spec - install spec string.
 * @returns true for git URLs and github: specs.
 */
export function isGitSpec(spec: string): boolean {
  return spec.startsWith('git+') || spec.startsWith('git://') || spec.startsWith('github:')
    || /^https?:\/\/[^/]+\/[^/]+\/[^/]+(\.git)?$/.test(spec)
}

/**
 * Install one npm package version into a target directory: download the
 * tarball and extract it (package root at the target root).
 * @param name - package name (for the tarball lookup).
 * @param version - resolved version.
 * @param packument - metadata carrying the tarball URL.
 * @param targetDir - destination directory (created; existing contents removed).
 * @param signal - optional cancellation.
 * @returns resolution after extraction.
 */
export async function installNpmPackage(
  name: string,
  version: string,
  packument: NpmPackument,
  targetDir: string,
  signal?: AbortSignal,
): Promise<void> {
  const entry = packument.versions[version]
  const tarball = entry?.dist?.tarball
  if (tarball === undefined) {
    throw new Error(`plugin-installer: version ${JSON.stringify(version)} of ${name} has no tarball`)
  }
  const response = await fetchWithTimeout(tarball, {
    ...signal === undefined ? {} : { signal },
  }, TARBALL_TIMEOUT_MS)
  if (!response.ok) {
    throw new Error(`plugin-installer: tarball ${tarball} answered ${String(response.status)}`)
  }
  if (response.body === null) {
    throw new Error(`plugin-installer: tarball ${tarball} has no body`)
  }
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  // Strip the package/ prefix of npm tarballs so the package root lands in
  // the target directory.
  await new Promise<void>((resolve, reject) => {
    const extract = tar.x({ cwd: targetDir, strip: 1 })
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(extract)
    extract.on('finish', () => resolve())
    extract.on('error', reject)
    // The fetch signal aborts the download; the stream error then rejects.
  })
}

/**
 * Remove a previously installed package directory.
 * @param targetDir - installed package directory to delete.
 */
export function removeInstalledDir(targetDir: string): void {
  rmSync(targetDir, { recursive: true, force: true })
}

/**
 * Resolve the flat fallback directory for a Harness home.
 * @param home - absolute Harness home.
 * @returns the profile module fallback directory path.
 */
export function fallbackModulesDir(home: string): string {
  return join(home, 'profiles', 'node_modules')
}
