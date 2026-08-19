/** Git-source support for plugin installs and update checks. */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import * as tar from 'tar'
import { fetchWithTimeout, NPM_NAME_PATTERN } from './registry.ts'

const execFileAsync = promisify(execFile)

/** Max clone depth for plugin installs. */
const CLONE_DEPTH = 1

// The GitHub/git deadlines are sized for slow, rate-limited networks: a
// plain git clone through pnpm was observed completing in ~90 s on such a
// network, so the install deadlines stay well above that while still
// bounding a permanently stalled transfer.
/** Hard deadline for GitHub API metadata requests. */
const GITHUB_API_TIMEOUT_MS = 30_000

/** Hard deadline for GitHub tarball downloads. */
const GITHUB_TARBALL_TIMEOUT_MS = 300_000

/** Hard deadline for one `git ls-remote` invocation. */
const LS_REMOTE_TIMEOUT_MS = 60_000

/** Hard deadline for one `git clone` invocation. */
const CLONE_TIMEOUT_MS = 300_000

/** Hard deadline for one `git --version` availability probe. */
const GIT_PROBE_TIMEOUT_MS = 10_000

/**
 * Normalize an accepted git spec to a URL `git` resolves without relying on
 * the user's git config: the `github:user/repo` shorthand only works when the
 * machine aliases the `github` host (insteadOf or ssh config), and the `git+`
 * prefix is a fetch convention git clone does not understand. A `#ref` suffix
 * (branch, tag, or commit sha) is preserved so installs can pin a reference.
 * @param url - the spec as entered.
 * @returns the clone URL (`https://github.com/…` for the shorthand, the
 * `git+` prefix stripped, everything else unchanged).
 */
export function normalizeGitUrl(url: string): string {
  const stripped = url.startsWith('git+') ? url.slice(4) : url
  if (!stripped.startsWith('github:')) return stripped
  const spec = stripped.slice('github:'.length)
  const slash = spec.indexOf('/')
  if (slash === -1 || slash === spec.length - 1) return stripped
  const owner = spec.slice(0, slash)
  const repo = spec.slice(slash + 1)
  if (repo.includes('/') || owner.includes('#')) return stripped
  const hash = repo.indexOf('#')
  const namePart = hash === -1 ? repo : repo.slice(0, hash)
  if (namePart === '') return stripped
  const ref = hash === -1 ? '' : repo.slice(hash)
  const bare = namePart.endsWith('.git') ? namePart.slice(0, -4) : namePart
  return `https://github.com/${owner}/${bare}.git${ref}`
}

/** One parsed GitHub repository: coordinates plus an optional pinned reference. */
export interface GithubRepo {
  owner: string
  repo: string
  /** Branch, tag, or commit sha; absent means the default branch. */
  ref?: string
}

/** Options shared by the GitHub install and commit-resolution helpers. */
export interface GithubOptions {
  /**
   * Optional proxy prefix prepended to the codeload and api.github.com URLs
   * (for example `https://gh-proxy.com/`) — a GitHub mirror for networks
   * where the GitHub hosts are slow or unreachable. The mirror operator sees
   * the transferred content; opt in knowingly.
   */
  mirror?: string
}

/**
 * Validate and normalize a GitHub mirror prefix: an http(s) URL whose path
 * receives the absolute codeload/api URL. A missing or empty value passes
 * through as undefined; any other set value fails loud. The result always
 * ends in `/` so mirroring is a plain string join.
 * @param value - the configured mirror prefix.
 * @returns the normalized prefix, or undefined when unset.
 * @throws when a set value is not an http(s) URL.
 */
export function normalizeGithubMirror(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed === '') return undefined
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error(`plugin-installer: githubMirror must be an http(s) URL prefix, got ${JSON.stringify(trimmed)}`)
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

/**
 * Parse a normalized git URL into GitHub repository coordinates. Only the
 * `https://github.com/…` form (with its optional `#ref` suffix and trailing
 * slash) matches; other hosts and un-normalized shorthands return null.
 * @param url - a URL that has passed `normalizeGitUrl`.
 * @returns the coordinates, or null when the URL is not a GitHub repository.
 */
export function parseGithubUrl(url: string): GithubRepo | null {
  const prefix = 'https://github.com/'
  if (!url.startsWith(prefix)) return null
  const rest = url.slice(prefix.length)
  const hash = rest.indexOf('#')
  const path = hash === -1 ? rest : rest.slice(0, hash)
  const ref = hash === -1 || hash === rest.length - 1 ? undefined : rest.slice(hash + 1)
  const segments = path.split('/').filter(segment => segment !== '')
  if (segments.length !== 2) return null
  const [owner, repoWithGit] = segments
  if (owner === undefined || repoWithGit === undefined) return null
  const repo = repoWithGit.endsWith('.git') ? repoWithGit.slice(0, -4) : repoWithGit
  return {
    owner,
    repo,
    ...(ref !== undefined ? { ref } : {}),
  }
}

/** The codeload/API reference name: `HEAD` resolves the default branch. */
function refName(ref: string | undefined): string {
  return ref ?? 'HEAD'
}

/** The codeload tarball URL for one repository reference, optionally mirrored. */
function githubTarballUrl(repo: GithubRepo, mirror: string | undefined): string {
  return `${mirror ?? ''}https://codeload.github.com/${repo.owner}/${repo.repo}/tar.gz/${refName(repo.ref)}`
}

/** The GitHub API commit-resolution URL for one repository reference, optionally mirrored. */
function githubCommitsUrl(repo: GithubRepo, mirror: string | undefined): string {
  return `${mirror ?? ''}https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${refName(repo.ref)}`
}

/**
 * Request headers for the GitHub API. `GITHUB_TOKEN` (or `GH_TOKEN`) lifts
 * the unauthenticated core rate limit of 60 requests per hour.
 */
function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  const headers: Record<string, string> = { accept: 'application/vnd.github+json' }
  if (token !== undefined && token !== '') headers.authorization = `Bearer ${token}`
  return headers
}

/**
 * Resolve the commit sha a GitHub reference names through the GitHub API.
 * @param repo - repository coordinates and optional reference.
 * @param options - optional mirror prefix for restricted networks.
 * @returns the commit sha, or undefined when the response carries none.
 * @throws a typed error when the API rejects the request.
 */
export async function githubCommitSha(repo: GithubRepo, options: GithubOptions = {}): Promise<string | undefined> {
  const response = await fetchWithTimeout(githubCommitsUrl(repo, options.mirror), { headers: githubHeaders() }, GITHUB_API_TIMEOUT_MS)
  if (!response.ok) {
    const hint = response.status === 404
      ? ` (repository ${repo.owner}/${repo.repo} not found — check the URL)`
      : response.status === 403
        ? ' (GitHub API rate limited or access denied — set GITHUB_TOKEN to authenticate)'
        : ''
    throw new Error(`plugin-installer: github api answered ${String(response.status)} for ${repo.owner}/${repo.repo}${hint}`)
  }
  const body = (await response.json()) as { sha?: unknown }
  return typeof body.sha === 'string' && body.sha !== '' ? body.sha : undefined
}

/**
 * Typed marker for a codeload 404: the repository does not exist (or is
 * private), so a clone fallback cannot help and must not run.
 */
class GithubRepoNotFoundError extends Error {
  constructor(url: string) {
    super(`plugin-installer: github tarball ${url} answered 404 (repository not found — check the URL)`)
  }
}

/**
 * Download one GitHub repository's source tarball from codeload and extract
 * it, with the wrapping `<repo>-<ref>/` directory stripped so the repository
 * root lands at the target root. codeload serves from a CDN without git pack
 * negotiation, so this is faster and more reliable than a clone — and it
 * needs no `git` binary.
 * @param repo - repository coordinates and optional reference.
 * @param targetDir - destination directory (created; existing contents removed).
 * @param options - optional mirror prefix for restricted networks.
 * @throws a typed error when the download or extraction fails; a 404 throws
 * the not-found marker, which callers never retry through a clone.
 */
export async function installFromGithub(repo: GithubRepo, targetDir: string, options: GithubOptions = {}): Promise<void> {
  const url = githubTarballUrl(repo, options.mirror)
  const response = await fetchWithTimeout(url, {}, GITHUB_TARBALL_TIMEOUT_MS)
  if (!response.ok) {
    if (response.status === 404) throw new GithubRepoNotFoundError(url)
    throw new Error(`plugin-installer: github tarball ${url} answered ${String(response.status)}`)
  }
  if (response.body === null) {
    throw new Error(`plugin-installer: github tarball ${url} has no body`)
  }
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  // pipeline destroys both sides on error, so a mid-body timeout surfaces as
  // one clean rejection instead of an unhandled 'error' on the source stream.
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    tar.x({ cwd: targetDir, strip: 1 }),
  )
}

/** Whether a `git` binary can run (probed per call; fallback paths only). */
async function gitAvailable(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version'], { timeout: GIT_PROBE_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

/** Typed marker for a repository with several package.json manifests: no single package to install. */
class MultiPackageRepoError extends Error {
  constructor(paths: string[]) {
    super(
      `plugin-installer: the git repository has ${paths.length} package.json manifests `
      + `(${paths.join(', ')}); install a single-package repository or the published npm package instead`,
    )
  }
}

/** Collect the relative paths of every package.json under a tree, skipping dependency and VCS directories. */
async function collectPackageJson(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(dir, entry.name)
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      out.push(...await collectPackageJson(path, relative))
    } else if (entry.name === 'package.json') {
      out.push(relative)
    }
  }
  return out
}

/**
 * Promote the repository's sole package to the target root when the checkout
 * root itself has no `package.json`: a monorepo shell around exactly one
 * package (the `packages/<group>/<name>` layout) installs as that package.
 * A root manifest is kept as-is; zero manifests leave the checkout for the
 * caller's missing-manifest error; several manifests fail loud naming them.
 * @param targetDir - the extracted or cloned repository root.
 * @throws a typed multi-package error when more than one manifest exists.
 */
export async function promoteSolePackage(targetDir: string): Promise<void> {
  if (existsSync(join(targetDir, 'package.json'))) return
  const manifests = (await collectPackageJson(targetDir)).sort()
  const sole = manifests[0]
  if (sole === undefined) return
  if (manifests.length > 1) throw new MultiPackageRepoError(manifests)
  const packageDir = join(targetDir, sole, '..')
  const promoted = `${targetDir}.sole-package`
  await rename(packageDir, promoted)
  await rm(targetDir, { recursive: true, force: true })
  await rename(promoted, targetDir)
}

/** Error text for a caught git failure, folding the child's diagnostics in. */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const stderr = (error as { stderr?: unknown }).stderr
  if (typeof stderr === 'string' && stderr.trim() !== '') {
    const trimmed = stderr.trim().split('\n').filter(line => line.trim() !== '').join(' ')
    const bounded = trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed
    return `${error.message}: ${bounded}`
  }
  if (error.message.trim() !== '') return error.message
  return error.name
}

/**
 * Read a repository's remote HEAD hash through `git ls-remote`.
 * @param url - git repository URL.
 * @returns the HEAD commit hash, or `undefined` when git is unavailable.
 * @throws when git exists but the remote refuses.
 */
async function lsRemoteHead(url: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', normalizeGitUrl(url), 'HEAD'], { timeout: LS_REMOTE_TIMEOUT_MS })
    const hash = stdout.trim().split(/\s+/)[0]
    return hash === undefined || hash === '' ? undefined : hash
  } catch (error: unknown) {
    const cause = error as { code?: string }
    if (cause.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Read the remote HEAD hash of a git repository. GitHub repositories resolve
 * through the GitHub API (`commits/<ref or HEAD>`), falling back to
 * `git ls-remote` when the API is unreachable and git exists; other hosts use
 * `git ls-remote` directly.
 * @param url - git repository URL.
 * @param options - optional mirror prefix for restricted networks.
 * @returns the HEAD commit hash, or `undefined` when neither the API nor git
 * can resolve it.
 * @throws when git exists but the remote refuses.
 */
export async function gitRemoteHead(url: string, options: GithubOptions = {}): Promise<string | undefined> {
  const github = parseGithubUrl(normalizeGitUrl(url))
  if (github !== null) {
    try {
      const head = await githubCommitSha(github, options)
      if (head !== undefined) return head
    } catch {
      // The API is unreachable, rate limited, or the repository is gone —
      // git's own resolution below is the fallback when the binary exists.
    }
  }
  return lsRemoteHead(url)
}

/**
 * Shallow-clone a repository — the path for non-GitHub git hosts and the
 * fallback when the GitHub tarball path fails while git exists.
 * @param url - normalized clone URL.
 * @param targetDir - destination directory (created).
 * @throws when git is unavailable or the clone fails, carrying git's
 * diagnostics.
 */
async function cloneShallow(url: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true })
  try {
    await execFileAsync('git', ['clone', '--depth', String(CLONE_DEPTH), url, targetDir], { timeout: CLONE_TIMEOUT_MS })
  } catch (error: unknown) {
    const cause = error as { code?: string }
    if (cause.code === 'ENOENT') {
      throw new Error('plugin-installer: git is required for repository sources and was not found on this machine')
    }
    throw new Error(`plugin-installer: git clone failed for ${url}: ${messageOf(error)}`, { cause: error })
  }
}

/**
 * Install a git repository into a target directory. GitHub repositories
 * download their source tarball from codeload and resolve their commit
 * through the GitHub API — no `git` binary needed; when that path fails and
 * git exists, the shallow-clone fallback runs. Other hosts shallow-clone
 * with git (required). A monorepo shell around exactly one package is
 * promoted to the target root before the caller reads the package identity.
 * @param url - git repository URL.
 * @param targetDir - destination directory (created).
 * @param options - optional mirror prefix for restricted networks (the
 * GitHub tarball and API URLs only; the clone fallback uses git directly).
 * @returns the installed HEAD commit hash.
 * @throws when neither download path succeeds, or the repository holds
 * several package manifests, carrying the diagnostics.
 */
export async function installFromGit(url: string, targetDir: string, options: GithubOptions = {}): Promise<string> {
  const normalized = normalizeGitUrl(url)
  const github = parseGithubUrl(normalized)
  if (github !== null) {
    try {
      await installFromGithub(github, targetDir, options)
    } catch (error: unknown) {
      // A codeload 404 means the repository does not exist — a clone would
      // hang on the same miss, so the verdict is final. Otherwise a clone is
      // the fallback when git can run; without git the tarball failure is
      // the honest final error.
      if (error instanceof GithubRepoNotFoundError) throw error
      if (!(await gitAvailable())) throw error
      await cloneShallow(normalized, targetDir)
    }
  } else {
    await cloneShallow(normalized, targetDir)
  }
  await promoteSolePackage(targetDir)
  const head = await gitRemoteHead(url, options)
  if (head === undefined) throw new Error(`plugin-installer: could not read HEAD of ${url}`)
  return head
}

/**
 * Validate the package identity a git checkout declares. A repository root
 * that declares npm workspaces is a multi-package shell, not an installable
 * plugin package — installing it would mount the wrong package under the
 * wrong name; a `private: true` flag alone is a publishing choice, not an
 * installability signal (git-only plugins like `@dsh-external/dsh-visualize`
 * ship exactly that way). An invalid package name is likewise rejected.
 * @param url - the git source the checkout came from (diagnostics only).
 * @param identity - the identity read from the checkout root.
 * @throws when the checkout declares workspaces or an invalid name.
 */
export function validateGitIdentity(url: string, identity: { name: string; manifest: Record<string, unknown> }): void {
  const manifest = identity.manifest
  const workspaceRoot = Array.isArray(manifest.workspaces) && manifest.workspaces.length > 0
  if (workspaceRoot) {
    throw new Error(
      `plugin-installer: the git repository ${url} is a multi-package workspace root, not an installable plugin package; `
      + 'install the published npm package instead',
    )
  }
  if (!NPM_NAME_PATTERN.test(identity.name)) {
    throw new Error(
      `plugin-installer: the git repository ${url} declares invalid package name ${JSON.stringify(identity.name)}`,
    )
  }
}
