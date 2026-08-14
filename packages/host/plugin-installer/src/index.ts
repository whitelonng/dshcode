/** Loopback-only plugin installation and updates for the current profile. */

import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { gitRemoteHead, installFromGit } from './git-source.ts'
import { insertPluginRow, readPluginRowEnabled, removePluginRow, setPluginRowEnabled } from './patch.ts'
import {
  DEFAULT_REGISTRY,
  fallbackModulesDir,
  fetchPackument,
  installNpmPackage,
  isGitSpec,
  parseNpmSpec,
  removeInstalledDir,
  resolveNpmVersion,
} from './registry.ts'
import { readPluginState, writePluginState } from './state.ts'
import type {
  InstalledPlugin,
  InstalledPluginRecord,
  PluginInstallId,
  PluginStateFile,
  PluginUpdateInfo,
} from './types.ts'

export type * from './types.ts'

/** Generic Connection channel hosting the installer endpoints. */
export const CHANNEL = '/plugin-installer'
const INSTALL_ENDPOINT = 'install'
const UPDATE_ENDPOINT = 'update'
const UNINSTALL_ENDPOINT = 'uninstall'
const SET_ENABLED_ENDPOINT = 'set-enabled'
const LIST_ENDPOINT = 'list'
const CHECK_UPDATES_ENDPOINT = 'check-updates'

const installRequestSchema = z.object({ spec: z.string().min(1) }).strict()
const idRequestSchema = z.object({ id: z.string().min(1) }).strict()
const setEnabledRequestSchema = z.object({ id: z.string().min(1), enabled: z.boolean() }).strict()

/** Plugin-installer gateway configuration owned by the composing profile. */
export interface Config {
  /** Explicit Harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** npm registry base; omitted follows `npm_config_registry`, then npmjs. */
  registry?: string
  /** Absolute user patch layer of the running profile. */
  profilePatchPath: string
}

/** Validate the gateway configuration before the route becomes reachable. */
export const Config: schema<Config> = schema.object({
  dshHome: schema.string().min(1),
  registry: schema.string().min(1),
  profilePatchPath: schema.string().min(1).required(),
})

/** Services required by the loopback RPC adapter. */
export const inject = ['connection']

/** Error text for a caught request or lifecycle failure. */
function messageOf(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors.map(messageOf).join('; ')
    return details === '' ? error.message : `${error.message}: ${details}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** Read the installed package identity from an installed directory. */
async function readInstalledIdentity(targetDir: string): Promise<{ name: string; version: string }> {
  const manifest = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as {
    name?: unknown
    version?: unknown
  }
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error(`plugin-installer: installed package at ${targetDir} has no valid package.json name`)
  }
  const version = typeof manifest.version === 'string' && manifest.version !== ''
    ? manifest.version
    : '0.0.0-git'
  return { name: manifest.name, version }
}

/** The loopback gateway that owns the profile's user-plugin installs. */
export class PluginInstallerGateway {
  private readonly home: string
  private readonly registry: string
  private readonly profilePatchPath: string
  private readonly fallbackDir: string
  private mutation = Promise.resolve()

  constructor(ctx: Context, config: Config) {
    void ctx
    this.home = resolveDshHome(config.dshHome)
    this.registry = config.registry ?? process.env.npm_config_registry ?? DEFAULT_REGISTRY
    this.profilePatchPath = config.profilePatchPath
    this.fallbackDir = fallbackModulesDir(this.home)
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
    await withFileLock(join(this.home, 'plugins.json'), () => writePluginState(this.home, state))
  }

  private stateUpsert(state: PluginStateFile, plugin: InstalledPluginRecord): PluginStateFile {
    const plugins = state.plugins.filter(existing => existing.id !== plugin.id)
    return { plugins: [plugin, ...plugins] }
  }

  /** Complete an install row with the enablement saved on the patch row. */
  private saved(plugin: InstalledPluginRecord): InstalledPlugin {
    return { ...plugin, enabled: readPluginRowEnabled(this.profilePatchPath, plugin.name) }
  }

  private async installedFromNpm(spec: string, signal?: AbortSignal): Promise<InstalledPluginRecord> {
    const { name, version: versionSpec } = parseNpmSpec(spec)
    const packument = await fetchPackument(name, this.registry, signal)
    const version = resolveNpmVersion(versionSpec, packument)
    const targetDir = join(this.fallbackDir, name)
    await installNpmPackage(name, version, packument, targetDir, signal)
    const identity = await readInstalledIdentity(targetDir)
    return {
      id: identity.name as PluginInstallId,
      name: identity.name,
      version: identity.version,
      source: { kind: 'npm', spec: name },
      installedAt: new Date().toISOString(),
    }
  }

  private async installedFromGit(spec: string, signal?: AbortSignal): Promise<InstalledPluginRecord> {
    const staging = join(this.fallbackDir, `.staging-${Date.now()}`)
    try {
      const commit = await installFromGit(spec, staging)
      const identity = await readInstalledIdentity(staging)
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

  private async installCore(spec: string, signal?: AbortSignal): Promise<InstalledPlugin> {
    const trimmed = spec.trim()
    if (trimmed === '') throw new Error('plugin-installer: install spec must not be empty')
    const plugin = isGitSpec(trimmed)
      ? await this.installedFromGit(trimmed, signal)
      : await this.installedFromNpm(trimmed, signal)
    const state = this.stateUpsert(this.readState(), plugin)
    await this.writeState(state)
    await insertPluginRow(this.profilePatchPath, plugin.name)
    return this.saved(plugin)
  }

  /**
   * Install one plugin from an npm spec or git URL.
   * @param request - install spec string.
   * @param signal - cancellation signal for network and file work.
   * @returns the installed plugin row.
   */
  install(request: { spec: string }, signal?: AbortSignal): Promise<{ plugin: InstalledPlugin }> {
    return this.enqueue(async () => ({ plugin: await this.installCore(request.spec, signal) }))
  }

  /**
   * Re-install one recorded plugin from its recorded source.
   * @param request - installed plugin id.
   * @param signal - cancellation signal for network and file work.
   * @returns the refreshed plugin row.
   */
  update(request: { id: string }, signal?: AbortSignal): Promise<{ plugin: InstalledPlugin }> {
    return this.enqueue(async () => {
      const state = this.readState()
      const existing = state.plugins.find(plugin => plugin.id === request.id as PluginInstallId)
      if (existing === undefined) {
        throw new Error(`plugin-installer: ${JSON.stringify(request.id)} is not installed`)
      }
      const plugin = existing.source.kind === 'git'
        ? await this.installedFromGit(existing.source.spec, signal)
        : await this.installedFromNpm(existing.source.spec, signal)
      await this.writeState(this.stateUpsert(this.readState(), plugin))
      await insertPluginRow(this.profilePatchPath, plugin.name)
      return { plugin: this.saved(plugin) }
    })
  }

  /**
   * Remove one installed plugin: directory, patch row, and state entry.
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
      removeInstalledDir(join(this.fallbackDir, existing.name))
      await removePluginRow(this.profilePatchPath, existing.name)
      const next = { plugins: state.plugins.filter(plugin => plugin.id !== existing.id) }
      await this.writeState(next)
      return { plugins: next.plugins.map(plugin => this.saved(plugin)) }
    })
  }

  /**
   * Read the installed snapshot.
   * @returns the recorded installed-plugin rows with their saved enablement.
   */
  list(): { plugins: InstalledPlugin[] } {
    const state = this.readState()
    return {
      plugins: state.plugins.map(plugin => ({
        ...plugin,
        enabled: readPluginRowEnabled(this.profilePatchPath, plugin.name),
      })),
    }
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
      await setPluginRowEnabled(this.profilePatchPath, existing.name, request.enabled)
      return { plugin: { ...existing, enabled: request.enabled } }
    })
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
          const head = await gitRemoteHead(plugin.source.spec)
          if (head !== undefined && head !== plugin.commit) {
            updates.push({ id: plugin.id, current: plugin.version, latest: head.slice(0, 12) })
          }
          continue
        }
        const { name } = parseNpmSpec(plugin.source.spec)
        const packument = await fetchPackument(name, this.registry)
        const latest = packument['dist-tags']?.latest
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
  ctx.connection.rpc.handle(CHANNEL, handle, { authority: 'loopback' })
}
