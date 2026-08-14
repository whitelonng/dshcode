/** Loopback-only control of configured plugin products in the current profile. */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { readUninstalledControls, writePluginControlState, writePluginControlUninstalled } from './control-file.ts'
import type {
  PluginControlId,
  PluginControlItem,
  PluginControlSnapshot,
  PluginControlState,
  SetPluginEnabledRequest,
} from './types.ts'

export type * from './types.ts'

const CHANNEL = '/plugin-control'
const LIST_ENDPOINT = 'list'
const SET_ENABLED_ENDPOINT = 'set-enabled'
const UNINSTALL_ENDPOINT = 'uninstall'
const CONTROL_ID_PATTERN = /^[A-Za-z0-9._~-]+$/

const emptyRequestSchema = z.object({}).strict()
const setEnabledRequestSchema = z.object({
  pluginId: z.string().min(1),
  enabled: z.boolean(),
}).strict()
const uninstallRequestSchema = z.object({
  pluginId: z.string().min(1),
}).strict()

/** One deployment-configured logical control and its Loader rows. */
export interface PluginControlSpec {
  /** Stable id used in the profile patch marker and mutation request. */
  id: string
  /** Human-readable product name shown in Settings. */
  name: string
  /** HTTP(S) source repository shown in Settings. */
  repository: string
  /** Complete Loader entry-id set controlled as one product. */
  entryIds: string[]
  /** Module specifier for each entry id, in the same order. */
  packages: string[]
}

/** Plugin-control gateway configuration owned by the composing profile. */
export interface Config {
  /** Absolute user patch layer of the running profile. */
  profilePatchPath: string
  /** Logical products that this deployment permits the browser to control. */
  controls: PluginControlSpec[]
}

const controlSpecSchema = schema.object({
  id: schema.string().min(1).required(),
  name: schema.string().min(1).required(),
  repository: schema.string().min(1).required(),
  entryIds: schema.array(schema.string().min(1)).min(1).required(),
  packages: schema.array(schema.string().min(1)).min(1).required(),
})

/** Validate the profile-owned control catalog before the route becomes reachable. */
export const Config: schema<Config> = schema.object({
  profilePatchPath: schema.string().min(1).required(),
  controls: schema.array(controlSpecSchema).min(1).required(),
})

/** Services required by the loopback RPC adapter. */
export const inject = ['loader', 'connection']

/** Brand a deployment-validated control id for the public response. */
function pluginControlId(value: string): PluginControlId {
  return value as PluginControlId
}

/** Error text for a caught request or lifecycle failure. */
function messageOf(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors.map(messageOf).join('; ')
    return details === '' ? error.message : `${error.message}: ${details}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** Validate relations that Schemastery cannot express locally. */
function validateConfig(config: Config): void {
  if (!isAbsolute(config.profilePatchPath)) {
    throw new Error('plugin-control: profilePatchPath must be absolute')
  }
  const controlIds = new Set<string>()
  const entryIds = new Set<string>()
  for (const control of config.controls) {
    if (control.id.trim() !== control.id || !CONTROL_ID_PATTERN.test(control.id)) {
      throw new Error(`plugin-control: invalid control id ${JSON.stringify(control.id)}`)
    }
    if (controlIds.has(control.id)) {
      throw new Error(`plugin-control: duplicate control id ${JSON.stringify(control.id)}`)
    }
    controlIds.add(control.id)
    if (control.name.trim() !== control.name) {
      throw new Error(`plugin-control: control ${JSON.stringify(control.id)} has surrounding whitespace in its name`)
    }
    let repository: URL
    try {
      repository = new URL(control.repository)
    } catch (cause) {
      throw new Error(`plugin-control: control ${JSON.stringify(control.id)} has an invalid repository URL`, { cause })
    }
    if (repository.protocol !== 'https:' && repository.protocol !== 'http:') {
      throw new Error(`plugin-control: control ${JSON.stringify(control.id)} repository must use HTTP(S)`)
    }
    if (control.packages.length !== control.entryIds.length) {
      throw new Error(`plugin-control: control ${JSON.stringify(control.id)} must declare one package per entry id`)
    }
    for (let index = 0; index < control.entryIds.length; index += 1) {
      const entryId = control.entryIds[index]
      const packageName = control.packages[index]
      /* v8 ignore next 3 -- the length check above guarantees index existence. */
      if (entryId === undefined || packageName === undefined) {
        throw new Error(`plugin-control: control ${JSON.stringify(control.id)} has a missing entry row`)
      }
      if (entryId.trim() !== entryId) {
        throw new Error(`plugin-control: control ${JSON.stringify(control.id)} has surrounding whitespace in an entry id`)
      }
      if (packageName.trim() !== packageName) {
        throw new Error(`plugin-control: control ${JSON.stringify(control.id)} has surrounding whitespace in a package name`)
      }
      if (entryIds.has(entryId)) {
        throw new Error(`plugin-control: Loader entry ${JSON.stringify(entryId)} belongs to more than one control`)
      }
      entryIds.add(entryId)
    }
  }
}

/** Loopback RPC adapter over Loader state and the active profile patch layer. */
export class PluginControlGateway {
  private mutationTail: Promise<void> = Promise.resolve()
  private readonly desired = new Map<string, boolean>()

  /**
   * Validate the catalog and retain its owning context.
   * @param ctx - plugin context carrying Loader and Connection.
   * @param config - resolved profile path and logical controls.
   */
  constructor(private readonly ctx: Context, private readonly config: Config) {
    validateConfig(config)
  }

  /** Resolve profile-local ids to their mounted entries, separating absent from ambiguous ids. */
  private resolveEntries(entryIds: readonly string[]): { entries: Entry[]; missing: string[]; ambiguous: string[] } {
    const mounted = [...this.ctx.loader.entries()]
    const entries: Entry[] = []
    const missing: string[] = []
    const ambiguous: string[] = []
    for (const entryId of entryIds) {
      const matches = mounted.filter(entry => entry.options.id === entryId)
      if (matches.length === 0) {
        missing.push(entryId)
        continue
      }
      if (matches.length > 1) {
        ambiguous.push(`${entryId} (${matches.length} matches)`)
        continue
      }
      const entry = matches[0]
      /* v8 ignore next 2 -- exactly one array match guarantees index zero exists. */
      if (entry === undefined) {
        throw new Error(`plugin-control: resolved entry ${JSON.stringify(entryId)} disappeared`)
      }
      entries.push(entry)
    }
    return { entries, missing, ambiguous }
  }

  /**
   * Return a point-in-time aggregate state for every configured control.
   * @returns configured controls and their saved or running aggregate states.
   */
  list(): PluginControlSnapshot {
    const uninstalled = readUninstalledControls(this.config.profilePatchPath)
    return {
      controls: this.config.controls
        .filter(control => !uninstalled.has(control.id))
        .map((control): PluginControlItem => {
          const controlled = this.resolveEntries(control.entryIds)
          let state: PluginControlState
          if (controlled.ambiguous.length > 0) {
            state = 'unavailable'
          } else if (this.desired.has(control.id)) {
            state = this.desired.get(control.id) === true ? 'enabled' : 'disabled'
          } else if (controlled.missing.length === control.entryIds.length) {
            // Rows not mounted yet: the product is off until the user enables it.
            state = 'disabled'
          } else {
            const disabled = controlled.entries.map(entry => entry.disabled)
            state = disabled.every(Boolean) ? 'disabled' : disabled.some(Boolean) ? 'mixed' : 'enabled'
          }
          return {
            id: pluginControlId(control.id),
            name: control.name,
            repository: control.repository,
            state,
          }
        }),
    }
  }

  /** Serialize same-process mutations so durable settings retain request order. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(() => {}, () => {})
    return result
  }

  /** Persist one setting for the next process start. */
  private setEnabled(request: SetPluginEnabledRequest, signal: AbortSignal): Promise<PluginControlSnapshot> {
    const control = this.config.controls.find(candidate => candidate.id === request.pluginId)
    if (control === undefined) {
      return Promise.reject(new Error(`unknown plugin control ${JSON.stringify(request.pluginId)}`))
    }
    return this.enqueue(async () => {
      if (signal.aborted) throw signal.reason
      const controlled = this.resolveEntries(control.entryIds)
      if (controlled.ambiguous.length > 0) {
        throw new Error(`plugin control ${JSON.stringify(control.id)} is unavailable; ambiguous Loader entries: ${controlled.ambiguous.join(', ')}`)
      }
      // Enabling writes (or refreshes) the insert rows that mount the product;
      // disabling without mounted rows is already the effective state, so
      // nothing needs writing. The running tree stays untouched either way.
      if (request.enabled || controlled.missing.length !== control.entryIds.length) {
        await writePluginControlState(this.config.profilePatchPath, {
          id: control.id,
          rows: control.entryIds.map((entryId, index) => {
            const packageName = control.packages[index]
            /* v8 ignore next 2 -- the catalog validator enforces equal lengths at construction. */
            if (packageName === undefined) {
              throw new Error(`plugin-control: control ${JSON.stringify(control.id)} has a missing entry row`)
            }
            return { entryId, package: packageName }
          }),
        }, request.enabled)
      }
      this.desired.set(control.id, request.enabled)
      return this.list()
    })
  }

  /**
   * Remove one preset product from the user's list: its managed rows are
   * replaced by an `uninstalled` marker so it stays hidden across restarts.
   * Re-enabling later (or reinstalling through the installer) clears the
   * marker through the ordinary managed-item rewrite.
   * @param request - logical control id to uninstall.
   * @returns the refreshed snapshot without the removed control.
   */
  uninstall(request: { pluginId: string }): Promise<PluginControlSnapshot> {
    return this.enqueue(async () => {
      const control = this.config.controls.find(candidate => candidate.id === request.pluginId)
      if (control === undefined) {
        throw new Error(`unknown plugin control ${JSON.stringify(request.pluginId)}`)
      }
      await writePluginControlUninstalled(this.config.profilePatchPath, control.id)
      this.desired.delete(control.id)
      return this.list()
    })
  }

  /** Decoded Connection handler for list and mutation endpoints. */
  readonly handle: ConnectionRpcHandler = async (endpoint, payload, signal) => {
    if (endpoint === LIST_ENDPOINT) {
      const parsed = emptyRequestSchema.safeParse(payload)
      if (!parsed.success) {
        return { ok: false, error: { code: 'bad-request', message: 'invalid plugin-control list request', details: { issues: parsed.error.issues } } }
      }
      return { ok: true, value: this.list() }
    }
    if (endpoint !== SET_ENABLED_ENDPOINT && endpoint !== UNINSTALL_ENDPOINT) {
      return { ok: false, error: { code: 'bad-request', message: `unknown plugin-control endpoint ${JSON.stringify(endpoint)}`, details: { issues: [] } } }
    }
    if (endpoint === UNINSTALL_ENDPOINT) {
      const parsed = uninstallRequestSchema.safeParse(payload)
      if (!parsed.success) {
        return { ok: false, error: { code: 'bad-request', message: 'invalid plugin-control uninstall request', details: { issues: parsed.error.issues } } }
      }
      if (signal.aborted) {
        return { ok: false, error: { code: 'cancelled', message: 'plugin-control request was cancelled', details: {} } }
      }
      try {
        const value = await this.uninstall(parsed.data as { pluginId: string })
        return { ok: true, value }
      } catch (error) {
        return {
          ok: false,
          error: { code: 'internal' as const, message: messageOf(error), details: {} },
        } as const
      }
    }
    const parsed = setEnabledRequestSchema.safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: { code: 'bad-request', message: 'invalid plugin-control mutation request', details: { issues: parsed.error.issues } } }
    }
    if (signal.aborted) {
      return { ok: false, error: { code: 'cancelled', message: 'plugin-control request was cancelled', details: {} } }
    }
    try {
      const value = await this.setEnabled(parsed.data as SetPluginEnabledRequest, signal)
      return { ok: true, value }
    } catch (error) {
      const result = {
        ok: false,
        error: { code: 'internal' as const, message: messageOf(error), details: {} },
      } as const
      return result
    }
  }
}

/** Register the configured gateway on a loopback-only Connection channel. */
export function apply(ctx: Context, config: Config): void {
  const gateway = new PluginControlGateway(ctx, config)
  ctx.connection.rpc.handle(CHANNEL, gateway.handle, { authority: 'loopback' })
}
