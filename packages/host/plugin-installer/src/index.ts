/** Loopback-only plugin installation and updates for the current profile. */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import {
  agePrune,
  clearBootFailures,
  readBootFailures,
  readSafeMode,
  setSafeMode,
  type BootFailureRecord,
} from './boot-failures.ts'
import { installPackageDependencies } from './dependencies.ts'
import { gitRemoteHead, installFromGit, normalizeGithubMirror, validateGitIdentity } from './git-source.ts'
import {
  bundlePatchPath,
  mergeBundleRows,
  readBundleLayerEnabled,
  removeBundleRows,
  setBundleLayerEnabled,
  setBundleRowsEnabled,
} from './bundle.ts'
import { insertPluginRow, readPluginRowEnabled, removePluginRow, setControlRowsEnabled, setPluginRowEnabled } from './patch.ts'
import {
  addProfileBundle,
  installViaPnpm,
  pnpmAvailable,
  profileDirOf,
  profileModuleDir,
  readProfileBundles,
  readProfileIdentity,
  removeProfileBundle,
  removeViaPnpm,
} from './pnpm.ts'
import { enumerateIndex } from './catalog.ts'
import { createPluginTools } from './tools.ts'
import {
  findSource,
  readLock,
  readSources,
  upsertLock,
  upsertSource,
  writeLock,
  writeSources,
} from './sources.ts'
import {
  DEFAULT_REGISTRY,
  fallbackModulesDir,
  fetchPackument,
  installNpmPackage,
  isGitSpec,
  normalizeInstallSpec,
  parseNpmSpec,
  removeInstalledDir,
  resolveNpmVersion,
  validateInstallSpec,
} from './registry.ts'
import { readPluginState, writePluginState } from './state.ts'
import type {
  EnumerateSnapshot,
  InstalledPlugin,
  InstalledPluginRecord,
  InstallProgress,
  PluginCatalogEntry,
  PluginInstallId,
  PluginSourceRow,
  PluginStateFile,
  PluginUpdateInfo,
} from './types.ts'

export type * from './types.ts'
// Desktop-shell recovery and the gateway share these pure helpers: the main
// process writes and sweeps the failure ring and the safe-mode marker, and
// disables plugin rows, without a second implementation of the file formats.
export {
  BOOT_FAILURES_FILENAME,
  MAX_BOOT_FAILURE_RECORDS,
  SAFE_MODE_FILENAME,
  agePrune,
  bootFailuresPath,
  clearBootFailures,
  pruneBootFailures,
  readBootFailures,
  readSafeMode,
  safeModePath,
  setSafeMode,
  writeBootFailure,
  type BootFailureKind,
  type BootFailureRecord,
  type BootFailuresFile,
} from './boot-failures.ts'
export { readPluginRowEnabled, setPluginRowEnabled } from './patch.ts'
export { fallbackModulesDir } from './registry.ts'
export { readPluginState } from './state.ts'

/** Generic Connection channel hosting the installer endpoints. */
export const CHANNEL = '/plugin-installer'
const INSTALL_ENDPOINT = 'install'
const UPDATE_ENDPOINT = 'update'
const UNINSTALL_ENDPOINT = 'uninstall'
const SET_ENABLED_ENDPOINT = 'set-enabled'
const STATUS_ENDPOINT = 'status'
const LIST_ENDPOINT = 'list'
const CHECK_UPDATES_ENDPOINT = 'check-updates'
const FAILURES_ENDPOINT = 'failures'
const SET_SAFE_MODE_ENDPOINT = 'set-safe-mode'
const SEARCH_ENDPOINT = 'search'
const SOURCES_ENDPOINT = 'sources'
const ADD_SOURCE_ENDPOINT = 'add-source'
const REMOVE_SOURCE_ENDPOINT = 'remove-source'

const installRequestSchema = z.object({ spec: z.string().min(1) }).strict()
const idRequestSchema = z.object({ id: z.string().min(1) }).strict()
const setEnabledRequestSchema = z.object({ id: z.string().min(1), enabled: z.boolean() }).strict()
const setSafeModeRequestSchema = z.object({ enabled: z.boolean() }).strict()
const searchRequestSchema = z.object({
  query: z.string().optional(),
  source: z.string().optional(),
  refresh: z.boolean().optional(),
}).strict()
const addSourceRequestSchema = z.object({
  locator: z.string().min(1),
  id: z.string().min(1).optional(),
  trust: z.enum(['official', 'community', 'untrusted']).optional(),
}).strict()

/** Plugin-installer gateway configuration owned by the composing profile. */
export interface Config {
  /** Explicit Harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** npm registry base; omitted follows `npm_config_registry`, then npmjs. */
  registry?: string
  /**
   * Optional GitHub mirror prefix (an http(s) URL, for example
   * `https://gh-proxy.com/`) prepended to the codeload and api.github.com
   * URLs on restricted networks. A set non-http(s) value fails loud at load.
   */
  githubMirror?: string
  /**
   * Conflict rules: after a successful install or update, each rule whose
   * `matches` substrings match the installed package name (case-insensitive)
   * disables the named plugin-control product's patch rows, so a user
   * install does not double-mount a built-in suite.
   */
  disableControlsOnInstall?: Array<{
    /** The plugin-control product id whose patch rows the rule disables. */
    id: string
    /** Package-name substrings (case-insensitive) that trigger the rule. */
    matches: string[]
  }>
  /** Absolute user patch layer of the running profile. */
  profilePatchPath: string
}

/** Validate the gateway configuration before the route becomes reachable. */
export const Config: schema<Config> = schema.object({
  dshHome: schema.string().min(1),
  registry: schema.string().min(1),
  githubMirror: schema.string().min(1),
  disableControlsOnInstall: schema.array(schema.object({
    id: schema.string().min(1).required(),
    matches: schema.array(schema.string().min(1)).min(1).required(),
  })),
  profilePatchPath: schema.string().min(1).required(),
})

/** Services required by the loopback RPC adapter and the agent tools. */
export const inject = ['connection', 'tools']

/** Error text for a caught request or lifecycle failure. */
function messageOf(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors.map(messageOf).join('; ')
    return details === '' ? error.message : `${error.message}: ${details}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** The installed identity: the package name, version, and raw manifest. */
interface InstalledIdentity {
  name: string
  version: string
  /** The raw manifest; identity checks and bundle metadata read from it. */
  manifest: Record<string, unknown>
}

/**
 * Read the installed package identity from an installed directory.
 * @param targetDir - the directory holding the package's `package.json`.
 * @param context - what was installed (diagnostics only).
 * @returns the identity, or throws when the manifest is missing or unnamed.
 */
export async function readInstalledIdentity(
  targetDir: string,
  context: string,
): Promise<InstalledIdentity> {
  let text: string
  try {
    text = await readFile(join(targetDir, 'package.json'), 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      throw new Error(
        `plugin-installer: ${context} has no package.json at its root; install a single-package repository or the published npm package instead`,
      )
    }
    throw error
  }
  const manifest = JSON.parse(text) as { name?: unknown; version?: unknown }
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error(`plugin-installer: installed package at ${targetDir} has no valid package.json name`)
  }
  const version = typeof manifest.version === 'string' && manifest.version !== ''
    ? manifest.version
    : '0.0.0-git'
  return { name: manifest.name, version, manifest: manifest as unknown as Record<string, unknown> }
}

/**
 * Resolve the module entry point a package manifest declares: a string
 * `exports`, a string `exports["."]`, then `main`, then the Node default.
 * @param manifest - the installed package manifest.
 * @returns the entry path relative to the package root.
 */
export function resolvePackageEntry(manifest: Record<string, unknown>): string {
  const exportsField = manifest.exports
  if (typeof exportsField === 'string') return exportsField
  if (typeof exportsField === 'object' && exportsField !== null) {
    const dot = (exportsField as Record<string, unknown>)['.']
    if (typeof dot === 'string') return dot
  }
  if (typeof manifest.main === 'string' && manifest.main !== '') return manifest.main
  return 'index.js'
}

/**
 * Fail loud when a package's resolved entry point is missing from its
 * installed directory: the Loader would crash at boot importing it, so the
 * verdict belongs at install time. The typical cause is a repository that
 * does not commit its build output.
 * @param dir - the installed package root.
 * @param entry - the entry path `resolvePackageEntry` resolved.
 * @param context - what was installed (diagnostics only).
 * @throws a typed error naming the missing entry and the remedy.
 */
export function assertPackageEntry(dir: string, entry: string, context: string): void {
  if (existsSync(join(dir, entry))) return
  throw new Error(
    `plugin-installer: ${context} has no entry point ${entry} — the repository likely does not commit its build output; `
    + 'build it (pnpm build) and commit the built files, or install the published npm package instead',
  )
}

/** The loopback gateway that owns the profile's user-plugin installs. */
export class PluginInstallerGateway {
  private readonly home: string
  private readonly registry: string
  private readonly githubMirror: string | undefined
  private readonly disableControlsOnInstall: Array<{ id: string; matches: string[] }>
  private readonly profilePatchPath: string
  private readonly fallbackDir: string
  private mutation = Promise.resolve()
  private progress: InstallProgress = { kind: 'idle', stage: 'fetch' }

  constructor(ctx: Context, config: Config) {
    void ctx
    this.home = resolveDshHome(config.dshHome)
    this.registry = config.registry ?? process.env.npm_config_registry ?? DEFAULT_REGISTRY
    this.githubMirror = normalizeGithubMirror(config.githubMirror)
    this.disableControlsOnInstall = config.disableControlsOnInstall ?? []
    this.profilePatchPath = config.profilePatchPath
    this.fallbackDir = fallbackModulesDir(this.home)
  }

  /**
   * Apply the configured conflict rules for one installed package: every
   * rule whose `matches` substring matches the package name (case
   * insensitive) disables that plugin-control product's patch rows.
   * @param packageName - the installed package name.
   */
  private async applyConflictDisables(packageName: string): Promise<void> {
    const lower = packageName.toLowerCase()
    for (const rule of this.disableControlsOnInstall) {
      if (rule.matches.some(match => lower.includes(match.toLowerCase()))) {
        await setControlRowsEnabled(this.profilePatchPath, rule.id, false)
      }
    }
  }

  /** Serialize every install/update/uninstall mutation. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation, operation)
    this.mutation = next.then(() => undefined, () => undefined)
    return next
  }

  private readState(): PluginStateFile {
    return readPluginState(this.home)
  }

  private async writeState(state: PluginStateFile): Promise<void> {
    // The delegated path never creates the module fallback, so the home
    // directory must exist before the state-file lock opens inside it.
    await mkdir(this.home, { recursive: true })
    await withFileLock(join(this.home, 'plugins.json'), () => writePluginState(this.home, state))
  }

  private stateUpsert(state: PluginStateFile, plugin: InstalledPluginRecord): PluginStateFile {
    const plugins = state.plugins.filter(existing => existing.id !== plugin.id)
    return { plugins: [plugin, ...plugins] }
  }

  /**
   * Complete an install row with the enablement saved on the profile state:
   * a bundle in the layer stack reads its override rows; everything else
   * reads its managed patch row.
   * @param plugin - the durable record.
   * @returns the plugin row with `enabled` derived.
   */
  private saved(plugin: InstalledPluginRecord): InstalledPlugin {
    const profileDir = profileDirOf(this.profilePatchPath)
    const enabled = readProfileBundles(profileDir).includes(plugin.name)
      ? readBundleLayerEnabled(this.profilePatchPath, plugin.name)
      : readPluginRowEnabled(this.profilePatchPath, plugin.name)
    return { ...plugin, enabled }
  }

  /**
   * Install a bundle-style plugin's support surface: its transitive npm
   * dependencies into the fallback, then its `dsh.bundle.patch` rows into the
   * profile patch layer. Bundle-style packages aggregate a plugin family —
   * their own entry mounts nothing, and every feature rides the rows and
   * packages they declare.
   * @param identity - the installed package identity.
   * @param bundlePatch - the resolved `dsh.bundle.patch` file path.
   * @param signal - cancellation for the dependency network work.
   */
  private async installBundleSupport(
    identity: InstalledIdentity,
    bundlePatch: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const kind = this.progress.kind
    await installPackageDependencies(identity.manifest, this.fallbackDir, this.registry, signal, (_name, percent) => {
      this.progress = { kind, stage: 'download', percent }
    })
    await mergeBundleRows(this.profilePatchPath, bundlePatch, identity.name)
  }

  private async installedFromNpm(
    spec: string,
    signal?: AbortSignal,
    onProgress?: (percent: number) => void,
  ): Promise<InstalledPluginRecord> {
    const { name, version: versionSpec } = parseNpmSpec(spec)
    const packument = await fetchPackument(name, this.registry, signal)
    const version = resolveNpmVersion(versionSpec, packument)
    const targetDir = join(this.fallbackDir, name)
    this.progress = { kind: this.progress.kind, stage: 'download' }
    await installNpmPackage(name, version, packument, targetDir, signal, onProgress)
    const identity = await readInstalledIdentity(targetDir, `npm package ${name}`)
    assertPackageEntry(targetDir, resolvePackageEntry(identity.manifest), `npm package ${name}`)
    const bundlePatch = bundlePatchPath(identity.manifest, targetDir)
    if (bundlePatch !== undefined) {
      await this.installBundleSupport(identity, bundlePatch, signal)
    }
    const integrity = packument.versions[version]?.dist?.integrity
    return {
      id: identity.name as PluginInstallId,
      name: identity.name,
      version: identity.version,
      source: { kind: 'npm', spec: name },
      installedAt: new Date().toISOString(),
      ...(integrity !== undefined && integrity !== '' ? { integrity } : {}),
    }
  }

  private async installedFromGit(spec: string, signal?: AbortSignal): Promise<InstalledPluginRecord> {
    const staging = join(this.fallbackDir, `.staging-${Date.now()}`)
    try {
      const mirror = this.githubMirror
      const commit = await installFromGit(spec, staging, mirror === undefined ? {} : { mirror })
      const identity = await readInstalledIdentity(staging, `git repository ${spec}`)
      validateGitIdentity(spec, identity)
      assertPackageEntry(staging, resolvePackageEntry(identity.manifest), `git repository ${spec}`)
      // Bundle support runs while the checkout is still staging, so a failed
      // dependency tree or patch merge leaves no orphaned package directory.
      const bundlePatch = bundlePatchPath(identity.manifest, staging)
      if (bundlePatch !== undefined) {
        await this.installBundleSupport(identity, bundlePatch, signal)
      }
      const targetDir = join(this.fallbackDir, identity.name)
      await rm(targetDir, { recursive: true, force: true })
      await mkdir(dirname(targetDir), { recursive: true })
      await rename(staging, targetDir)
      return {
        id: identity.name as PluginInstallId,
        name: identity.name,
        version: identity.version,
        source: { kind: 'git', spec },
        installedAt: new Date().toISOString(),
        commit,
      }
    } finally {
      signal?.throwIfAborted()
      await rm(staging, { recursive: true, force: true })
    }
  }

  /**
   * Install one plugin through system pnpm in the profile workspace. pnpm
   * resolves the registry, transitive dependencies, git sources, and build
   * scripts; the installed form decides the mount point — a `dsh.bundle`
   * package joins the profile bundle layer stack (no installer row; its patch
   * mounts at boot), a plain package gets a managed insert row.
   * @param spec - the validated install spec.
   * @returns the recorded plugin row.
   */
  private async installedViaPnpm(spec: string): Promise<InstalledPluginRecord> {
    const profileDir = profileDirOf(this.profilePatchPath)
    this.progress = { kind: this.progress.kind, stage: 'download' }
    const { names } = await installViaPnpm(profileDir, spec)
    const name = names[0]
    if (name === undefined) {
      throw new Error(`plugin-installer: pnpm reported success but no package was added for ${JSON.stringify(spec)}`)
    }
    const identity = await readProfileIdentity(profileDir, name)
    assertPackageEntry(profileModuleDir(profileDir, name), resolvePackageEntry(identity.manifest), `pnpm-installed package ${name}`)
    const isBundle = bundlePatchPath(identity.manifest, profileModuleDir(profileDir, name)) !== undefined
    if (isBundle) {
      await addProfileBundle(profileDir, name)
    } else {
      await insertPluginRow(this.profilePatchPath, name)
    }
    return {
      id: identity.name as PluginInstallId,
      name: identity.name,
      version: identity.version,
      source: { kind: isGitSpec(spec) ? 'git' : 'npm', spec: isGitSpec(spec) ? spec : name },
      installedAt: new Date().toISOString(),
    }
  }

  private async installCore(spec: string, signal?: AbortSignal): Promise<InstalledPlugin> {
    const trimmed = normalizeInstallSpec(spec)
    if (trimmed === '') throw new Error('plugin-installer: install spec must not be empty')
    validateInstallSpec(trimmed)
    // System pnpm owns downloads when present: registry resolution, dependency
    // trees, git monorepo selectors, and build scripts all come free. The
    // self-rolled paths stay as the fallback for machines without pnpm.
    const delegated = await pnpmAvailable()
    const plugin = delegated
      ? await this.installedViaPnpm(trimmed)
      : isGitSpec(trimmed)
        ? await this.installedFromGit(trimmed, signal)
        : await this.installedFromNpm(trimmed, signal, (percent) => {
          this.progress = { kind: 'install', stage: 'download', percent }
        })
    this.progress = { kind: 'install', stage: 'write' }
    const state = this.stateUpsert(this.readState(), plugin)
    await this.writeState(state)
    if (!delegated) await insertPluginRow(this.profilePatchPath, plugin.name)
    // TOFU: the install's resolved reference is pinned for reinstall.
    const kind = readProfileBundles(profileDirOf(this.profilePatchPath)).includes(plugin.name) ? 'bundle' : 'plugin'
    await writeLock(this.home, upsertLock(readLock(this.home), {
      canonical: plugin.name,
      kind,
      ref: plugin.source.spec,
      recordedAt: new Date().toISOString(),
    }))
    // A user install that duplicates a built-in product disables that
    // product's rows so the two suites do not double-mount.
    await this.applyConflictDisables(plugin.name)
    return this.saved(plugin)
  }

  /**
   * Install one plugin from an npm spec or git URL.
   * @param request - install spec string.
   * @param signal - cancellation signal for network and file work.
   * @returns the installed plugin row.
   */
  install(request: { spec: string }, signal?: AbortSignal): Promise<{ plugin: InstalledPlugin }> {
    return this.enqueue(async () => {
      this.progress = { kind: 'install', stage: 'fetch' }
      try {
        return { plugin: await this.installCore(request.spec, signal) }
      } finally {
        this.progress = { kind: 'idle', stage: 'fetch' }
      }
    })
  }

  /**
   * Read the current install/update progress for the browser's polling.
   * @returns the point-in-time progress state.
   */
  status(): { progress: InstallProgress } {
    return { progress: this.progress }
  }

  /**
   * Re-install one recorded plugin from its recorded source.
   * @param request - installed plugin id.
   * @param signal - cancellation signal for network and file work.
   * @returns the refreshed plugin row.
   */
  update(request: { id: string }, signal?: AbortSignal): Promise<{ plugin: InstalledPlugin }> {
    return this.enqueue(async () => {
      this.progress = { kind: 'update', stage: 'fetch' }
      try {
        const state = this.readState()
        const existing = state.plugins.find(plugin => plugin.id === request.id as PluginInstallId)
        if (existing === undefined) {
          throw new Error(`plugin-installer: ${JSON.stringify(request.id)} is not installed`)
        }
        const profileDir = profileDirOf(this.profilePatchPath)
        let plugin: InstalledPluginRecord
        if (await pnpmAvailable()) {
          // pnpm re-resolves the saved dependency (its range, or latest when
          // added without one); the fallback paths stay for flat-fallback rows.
          this.progress = { kind: 'update', stage: 'download' }
          const { names } = await installViaPnpm(profileDir, existing.source.kind === 'git' ? existing.source.spec : existing.name)
          const name = names[0] ?? existing.name
          const identity = await readProfileIdentity(profileDir, name)
          plugin = {
            ...existing,
            name: identity.name,
            version: identity.version,
            installedAt: new Date().toISOString(),
          }
        } else {
          plugin = existing.source.kind === 'git'
            ? await this.installedFromGit(existing.source.spec, signal)
            : await this.installedFromNpm(existing.source.spec, signal, (percent) => {
              this.progress = { kind: 'update', stage: 'download', percent }
            })
        }
        this.progress = { kind: 'update', stage: 'write' }
        await this.writeState(this.stateUpsert(this.readState(), plugin))
        await this.applyConflictDisables(plugin.name)
        // A bundle in the layer stack mounts without a row; only plain
        // plugins (or the fallback paths) need the managed row refreshed.
        if (!readProfileBundles(profileDir).includes(plugin.name)) {
          await insertPluginRow(this.profilePatchPath, plugin.name)
        }
        return { plugin: this.saved(plugin) }
      } finally {
        this.progress = { kind: 'idle', stage: 'fetch' }
      }
    })
  }

  /**
   * Remove one installed plugin: directory, patch row, state entry, and any
   * recorded boot failures for it.
   * @param request - installed plugin id.
   * @returns the remaining installed-plugin rows.
   */
  uninstall(request: { id: string }): Promise<{ plugins: InstalledPlugin[] }> {
    return this.enqueue(async () => {
      const state = this.readState()
      const existing = state.plugins.find(plugin => plugin.id === request.id as PluginInstallId)
      if (existing === undefined) {
        throw new Error(`plugin-installer: ${JSON.stringify(request.id)} is not installed`)
      }
      const profileDir = profileDirOf(this.profilePatchPath)
      if (await pnpmAvailable()) {
        await removeViaPnpm(profileDir, existing.name)
      }
      await removeProfileBundle(profileDir, existing.name)
      removeInstalledDir(join(this.fallbackDir, existing.name))
      await removePluginRow(this.profilePatchPath, existing.name)
      await removeBundleRows(this.profilePatchPath, existing.name)
      await clearBootFailures(this.home, existing.name)
      const next = { plugins: state.plugins.filter(plugin => plugin.id !== existing.id) }
      await this.writeState(next)
      return { plugins: next.plugins.map(plugin => this.saved(plugin)) }
    })
  }

  /**
   * Read the recorded boot failures, the plugin install root, and whether
   * safe mode is active — the recovery surfaces' snapshot.
   * @returns the aged failure rows plus the plugin-root and safe-mode facts.
   */
  failures(): { items: BootFailureRecord[]; pluginRoot: string; safeMode: boolean } {
    return {
      items: agePrune(readBootFailures(this.home), Date.now()),
      pluginRoot: dirname(this.fallbackDir),
      safeMode: readSafeMode(this.home),
    }
  }

  /**
   * Persist the safe-mode marker that the desktop shell reads at launch.
   * @param enabled - whether safe mode should be active at the next launch.
   * @returns the resulting safe-mode state.
   */
  async setSafeMode(enabled: boolean): Promise<{ safeMode: boolean }> {
    await setSafeMode(this.home, enabled)
    return { safeMode: enabled }
  }

  /**
   * Read the installed snapshot.
   * @returns the recorded installed-plugin rows with their saved enablement.
   */
  list(): { plugins: InstalledPlugin[] } {
    const state = this.readState()
    return { plugins: state.plugins.map(plugin => this.saved(plugin)) }
  }

  /**
   * Persist one installed plugin's next-start enablement on its managed
   * profile patch row.
   * @param request - installed plugin id and desired enablement.
   * @returns the refreshed plugin row.
   */
  setEnabled(request: { id: string; enabled: boolean }): Promise<{ plugin: InstalledPlugin }> {
    return this.enqueue(async () => {
      const state = this.readState()
      const existing = state.plugins.find(plugin => plugin.id === request.id as PluginInstallId)
      if (existing === undefined) {
        throw new Error(`plugin-installer: ${JSON.stringify(request.id)} is not installed`)
      }
      const profileDir = profileDirOf(this.profilePatchPath)
      if (readProfileBundles(profileDir).includes(existing.name)) {
        // A bundle-layer plugin: flip override rows for its patch-row ids.
        const installedDir = profileModuleDir(profileDir, existing.name)
        const manifest = await readProfileIdentity(profileDir, existing.name)
        const patch = bundlePatchPath(manifest.manifest, installedDir)
        if (patch !== undefined) {
          await setBundleLayerEnabled(this.profilePatchPath, patch, existing.name, request.enabled)
        }
      } else {
        await setPluginRowEnabled(this.profilePatchPath, existing.name, request.enabled)
        await setBundleRowsEnabled(this.profilePatchPath, existing.name, request.enabled)
      }
      return { plugin: { ...existing, enabled: request.enabled } }
    })
  }

  /**
   * Search the registered index sources. Without `source` every source is
   * enumerated (cached snapshots honor the TTL); with a new locator the
   * source is probed lazily and remembered. Results carry the owning source's
   * trust level.
   * @param request - optional query, source id or locator, and refresh flag.
   * @returns the matching catalog entries.
   */
  async search(
    request: { query?: string | undefined; source?: string | undefined; refresh?: boolean | undefined },
  ): Promise<{ plugins: Array<PluginCatalogEntry & { trust?: string }> }> {
    const sources = readSources(this.home)
    let snapshots: EnumerateSnapshot[] = []
    if (request.source !== undefined && request.source !== '') {
      const matched = findSource(sources, request.source)
      const target: PluginSourceRow = matched ?? {
        id: `custom-${Date.now()}`,
        locator: request.source,
        trust: 'community',
      }
      snapshots = [await enumerateIndex(this.home, target, { refresh: request.refresh === true })]
      if (matched === undefined) {
        await writeSources(this.home, upsertSource(sources, target))
      }
    } else {
      for (const source of sources) {
        try {
          snapshots.push(await enumerateIndex(this.home, source, { refresh: request.refresh === true }))
        } catch {
          // One unreachable source must not hide the rest of the catalog.
        }
      }
    }
    const query = (request.query ?? '').trim().toLowerCase()
    const plugins = snapshots
      .flatMap(snapshot => snapshot.entries)
      .map((entry) => {
        const source = findSource(sources, entry.sourceId)
        return { ...entry, ...(source !== undefined ? { trust: source.trust } : {}) }
      })
      .filter((entry) => {
        if (query === '') return true
        return entry.id.toLowerCase().includes(query)
          || (entry.description ?? '').toLowerCase().includes(query)
      })
    return { plugins }
  }

  /**
   * Read the registered index sources.
   * @returns the registered source rows.
   */
  sources(): { sources: PluginSourceRow[] } {
    return { sources: readSources(this.home) }
  }

  /**
   * Register (or replace) one index source.
   * @param request - the new source (locator, optional id and trust).
   * @returns the stored source row.
   */
  async addSource(request: { locator: string; id?: string | undefined; trust?: 'official' | 'community' | 'untrusted' | undefined }): Promise<{ source: PluginSourceRow }> {
    const sources = readSources(this.home)
    const source: PluginSourceRow = {
      id: request.id?.trim() || `custom-${Date.now()}`,
      locator: request.locator.trim(),
      trust: request.trust ?? 'community',
    }
    await writeSources(this.home, upsertSource(sources, source))
    return { source }
  }

  /**
   * Remove one index source by id (the default hub can be removed and re-added).
   * @param request - the id of the source to remove.
   * @returns the remaining source rows.
   */
  async removeSource(request: { id: string }): Promise<{ sources: PluginSourceRow[] }> {
    const sources = readSources(this.home).filter(source => source.id !== request.id)
    await writeSources(this.home, sources)
    return { sources }
  }

  /**
   * Compare installed versions against their sources without mutating
   * anything. npm sources resolve `dist-tags.latest`; git sources compare the
   * remote HEAD against the recorded install commit. Registry or git
   * failures degrade per plugin (the plugin is skipped).
   * @returns update rows for plugins with a newer version.
   */
  async checkUpdates(): Promise<{ updates: PluginUpdateInfo[] }> {
    const updates: PluginUpdateInfo[] = []
    for (const plugin of this.readState().plugins) {
      try {
        if (plugin.source.kind === 'git') {
          const mirror = this.githubMirror
          const head = await gitRemoteHead(plugin.source.spec, mirror === undefined ? {} : { mirror })
          if (head !== undefined && head !== plugin.commit) {
            updates.push({ id: plugin.id, current: plugin.version, latest: head.slice(0, 12) })
          }
          continue
        }
        const { name } = parseNpmSpec(plugin.source.spec)
        const packument = await fetchPackument(name, this.registry)
        const latest = packument['dist-tags'].latest
        if (latest !== undefined && latest !== plugin.version) {
          updates.push({ id: plugin.id, current: plugin.version, latest })
        }
      } catch {
        // A source that is offline or gone cannot confirm an update; keep the
        // plugin listed without an update claim.
      }
    }
    return { updates }
  }
}

/** Register the configured gateway on a loopback-only Connection channel. */
export function apply(ctx: Context, config: Config): void {
  const gateway = new PluginInstallerGateway(ctx, config)
  // Agent-facing plugin tools share the gateway's install state with the
  // browser panel — one authority, two surfaces.
  ctx.effect(() => {
    const disposers = createPluginTools(gateway).map(definition => ctx.tools.register(definition))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'plugin-installer: plugin_* tools')
  const handle: ConnectionRpcHandler = async (endpoint, payload, signal) => {
    if (signal.aborted) {
      return { ok: false as const, error: { code: 'cancelled', message: 'plugin-installer request was cancelled', details: {} } }
    }
    try {
      switch (endpoint) {
        case LIST_ENDPOINT: {
          z.object({}).strict().parse(payload)
          return { ok: true as const, value: gateway.list() }
        }
        case CHECK_UPDATES_ENDPOINT: {
          z.object({}).strict().parse(payload)
          return { ok: true as const, value: await gateway.checkUpdates() }
        }
        case INSTALL_ENDPOINT: {
          const parsed = installRequestSchema.parse(payload)
          return { ok: true as const, value: await gateway.install(parsed, signal) }
        }
        case UPDATE_ENDPOINT: {
          const parsed = idRequestSchema.parse(payload)
          return { ok: true as const, value: await gateway.update(parsed, signal) }
        }
        case UNINSTALL_ENDPOINT: {
          const parsed = idRequestSchema.parse(payload)
          return { ok: true as const, value: await gateway.uninstall(parsed) }
        }
        case SET_ENABLED_ENDPOINT: {
          const parsed = setEnabledRequestSchema.parse(payload)
          return { ok: true as const, value: await gateway.setEnabled(parsed) }
        }
        case STATUS_ENDPOINT: {
          z.object({}).strict().parse(payload)
          return { ok: true as const, value: gateway.status() }
        }
        case FAILURES_ENDPOINT: {
          z.object({}).strict().parse(payload)
          return { ok: true as const, value: gateway.failures() }
        }
        case SET_SAFE_MODE_ENDPOINT: {
          const parsed = setSafeModeRequestSchema.parse(payload)
          return { ok: true as const, value: await gateway.setSafeMode(parsed.enabled) }
        }
        case SEARCH_ENDPOINT: {
          const parsed = searchRequestSchema.parse(payload)
          return { ok: true as const, value: await gateway.search(parsed) }
        }
        case SOURCES_ENDPOINT: {
          z.object({}).strict().parse(payload)
          return { ok: true as const, value: gateway.sources() }
        }
        case ADD_SOURCE_ENDPOINT: {
          const parsed = addSourceRequestSchema.parse(payload)
          return { ok: true as const, value: await gateway.addSource(parsed) }
        }
        case REMOVE_SOURCE_ENDPOINT: {
          const parsed = idRequestSchema.parse(payload)
          return { ok: true as const, value: await gateway.removeSource(parsed) }
        }
        default:
          return { ok: false as const, error: { code: 'bad-request', message: `unknown plugin-installer endpoint ${JSON.stringify(endpoint)}`, details: { issues: [] } } }
      }
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return {
          ok: false as const,
          error: { code: 'bad-request', message: `plugin-installer ${endpoint}: ${messageOf(error)}`, details: { issues: error.issues } },
        }
      }
      return {
        ok: false as const,
        error: { code: 'internal', message: `plugin-installer ${endpoint}: ${messageOf(error)}`, details: {} },
      }
    }
  }
  ctx.connection.rpc.handle(CHANNEL, handle)
}
