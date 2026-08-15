/** npm registry interaction: metadata fetch, version resolution, tarball install. */

import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { ReadableStream as WebReadableStream } from 'node:stream/web'
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
  dist?: { tarball?: string; integrity?: string }
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
    const hint = response.status === 404
      ? ` (package ${JSON.stringify(name)} not found — check the name or the configured registry)`
      : ''
    throw new Error(`plugin-installer: registry answered ${String(response.status)} for ${JSON.stringify(name)}${hint}`)
  }
  const raw = (await response.json()) as { 'dist-tags'?: unknown; versions?: unknown }
  const distTags = raw['dist-tags']
  const versions = raw.versions
  if (typeof distTags !== 'object' || distTags === null
    || typeof versions !== 'object' || versions === null) {
    throw new Error(`plugin-installer: registry ${url} returned an invalid packument`)
  }
  return { 'dist-tags': distTags, versions } as NpmPackument
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
  const latest = packument['dist-tags'].latest
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

/** npm package-name pattern: an optional scope plus a URL-safe name (first character neither `.` nor `_`). */
/** npm package-name pattern: an optional scope plus a URL-safe name (first character neither `.` nor `_`). */
export const NPM_NAME_PATTERN = /^(@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*$/

/**
 * Normalize a pasted install value: a whole CLI command (`dsh plugin
 * --profile <name> add <spec>`, `pnpm add <spec>`, `npm install <spec>`)
 * reduces to the spec it installs; anything else passes through unchanged.
 * @param input - the raw install box value.
 * @returns the installable spec.
 */
export function normalizeInstallSpec(input: string): string {
  const trimmed = input.trim()
  const dshMatch = /^dsh\s+plugin(?:\s+--profile\s+\S+)?\s+add\s+(.+)$/.exec(trimmed)
  if (dshMatch !== null) return (dshMatch[1] ?? '').trim()
  const managerMatch = /^(?:pnpm\s+(?:add|i)|npm\s+(?:install|i))\s+(.+)$/.exec(trimmed)
  if (managerMatch !== null) return (managerMatch[1] ?? '').trim()
  return trimmed
}

/**
 * Validate one user-supplied install spec before any registry request.
 * Rejects prose, pasted URLs, shell commands, and mixed text with a readable
 * error instead of sending a malformed package path that the registry answers
 * 406.
 * @param spec - trimmed install spec from the browser.
 * @throws when the spec is neither a git source nor a valid npm package spec.
 */
export function validateInstallSpec(spec: string): void {
  if (isGitSpec(spec)) return
  if (/^(?:dsh|pnpm|npm|npx|yarn)\b/.test(spec)) {
    throw new Error(
      `plugin-installer: invalid install spec ${JSON.stringify(spec)}: looks like a shell command — `
      + 'paste only the npm package name or the git repository URL (e.g. github:Nagi-ovo/dsh-visualize)',
    )
  }
  const { name } = parseNpmSpec(spec)
  if (!NPM_NAME_PATTERN.test(name)) {
    throw new Error(`plugin-installer: invalid install spec ${JSON.stringify(spec)}: expected one npm package name (e.g. @scope/name) or one git repository URL`)
  }
}

/**
 * Whether an install spec names a git repository rather than an npm package.
 * @param spec - install spec string.
 * @returns true for git URLs and github: specs.
 */
export function isGitSpec(spec: string): boolean {
  return spec.startsWith('git+') || spec.startsWith('git://') || spec.startsWith('github:')
    || /^https?:\/\/[^/]+\/[^/]+\/[^/#]+(\.git)?(#[^/]+)?$/.test(spec)
}

/**
 * Install one npm package version into a target directory: download the
 * tarball and extract it (package root at the target root). Download
 * progress is reported through `onProgress` when the response declares a
 * content length.
 * @param name - package name (for the tarball lookup).
 * @param version - resolved version.
 * @param packument - metadata carrying the tarball URL.
 * @param targetDir - destination directory (created; existing contents removed).
 * @param signal - optional cancellation.
 * @param onProgress - optional download completion callback (0–100 percent).
 * @returns resolution after extraction.
 */
/**
 * Subresource-integrity verification of one downloaded tarball. The registry
 * publishes `dist.integrity` as one or more `<algorithm>-<base64>` tokens
 * (npm uses sha512/sha256/sha384); the tarball must match at least one of the
 * tokens this verifier knows. A missing declaration verifies nothing (the
 * transport is still HTTPS), a declaration with no supported algorithm fails
 * loud — pinning without a verifiable algorithm would be false confidence.
 * @param digest - the sha256/384/512 digests of the tarball bytes.
 * @param integrity - the registry's SRI string.
 * @param tarball - the tarball URL (diagnostics only).
 * @throws when no supported token matches or none exists.
 */
export function verifySRI(
  digest: Record<'sha256' | 'sha384' | 'sha512', string>,
  integrity: string,
  tarball: string,
): void {
  let supported = false
  for (const token of integrity.split(/\s+/)) {
    if (token === '') continue
    const dash = token.indexOf('-')
    const algorithm = dash === -1 ? '' : token.slice(0, dash)
    const expected = dash === -1 ? '' : token.slice(dash + 1)
    if ((algorithm === 'sha256' || algorithm === 'sha384' || algorithm === 'sha512') && expected !== '') {
      supported = true
      if (digest[algorithm] === expected) return
    }
  }
  if (!supported) {
    throw new Error(`plugin-installer: tarball ${tarball} declares integrity with no supported algorithm (${integrity})`)
  }
  throw new Error(`plugin-installer: tarball ${tarball} failed integrity verification (expected ${integrity})`)
}

/**
 * Install one npm package version into a target directory: download the
 * tarball and extract it (package root at the target root). Download
 * progress is reported through `onProgress` when the response declares a
 * content length, and a declared `dist.integrity` is verified against the
 * downloaded bytes before the extraction result is kept.
 * @param name - package name (for the tarball lookup).
 * @param version - resolved version.
 * @param packument - metadata carrying the tarball URL.
 * @param targetDir - destination directory (created; existing contents removed,
 *   and the directory removed again when the install fails).
 * @param signal - optional cancellation.
 * @param onProgress - optional download completion callback (0–100 percent).
 * @returns resolution after extraction and integrity verification; a failed
 *   install leaves no target directory behind.
 */
export async function installNpmPackage(
  name: string,
  version: string,
  packument: NpmPackument,
  targetDir: string,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
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
  // the target directory. Bytes are counted while bridging the web stream
  // into Node so the browser can show download progress, and hashed for the
  // integrity check the registry's SRI pins.
  const total = Number(response.headers.get('content-length') ?? NaN)
  const hashers = {
    sha256: createHash('sha256'),
    sha384: createHash('sha384'),
    sha512: createHash('sha512'),
  }
  const body = response.body as import('node:stream/web').ReadableStream<Uint8Array>
  const reader = body.getReader()
  let received = 0
  const source = new WebReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read()
      if (chunk.done) {
        controller.close()
        return
      }
      const value = chunk.value
      received += value.byteLength
      hashers.sha256.update(value)
      hashers.sha384.update(value)
      hashers.sha512.update(value)
      if (Number.isFinite(total) && total > 0) {
        onProgress?.(Math.min(100, Math.round(received / total * 100)))
      }
      controller.enqueue(value)
    },
  })
  const progress = Readable.fromWeb(source)
  try {
    await new Promise<void>((resolve, reject) => {
      const extract = tar.x({ cwd: targetDir, strip: 1 })
      progress.pipe(extract)
      extract.on('finish', () => { resolve() })
      extract.on('error', reject)
      // The fetch signal aborts the download; the stream error then rejects.
    })
    const integrity = entry?.dist?.integrity
    if (integrity !== undefined && integrity !== '') {
      verifySRI({
        sha256: hashers.sha256.digest('base64'),
        sha384: hashers.sha384.digest('base64'),
        sha512: hashers.sha512.digest('base64'),
      }, integrity, tarball)
    }
  } catch (error) {
    // A failed download, extraction, or integrity check must not leave an
    // empty or half-written package directory behind: Node's resolver then
    // reports "Cannot find package" for a directory that exists, which reads
    // as the package being installed while defeating every parent-directory
    // fallback and every later boot that imports it.
    await rm(targetDir, { recursive: true, force: true })
    throw error
  }
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
