/** Loopback projection and enablement of the current Cordis Loader plugin entries. */

import { isAbsolute } from 'node:path'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import schema from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { readSavedEnablements, writeSavedEnablement } from './patch.ts'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
  SetPluginEnabledRequest,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Plugin-inventory gateway configuration owned by the composing profile. */
export interface Config {
  /** Absolute user patch layer of the running profile. */
  profilePatchPath: string
}

/** Validate the profile-owned patch path before the route becomes reachable. */
export const Config: schema<Config> = schema.object({
  profilePatchPath: schema.string().min(1).required(),
})

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  private mutationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'pluginInventory')
    if (!isAbsolute(config.profilePatchPath)) {
      throw new Error('plugin-inventory: profilePatchPath must be absolute')
    }
  }

  /** Serialize same-process mutations so durable settings retain request order. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(() => {}, () => {})
    return result
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order, with their
   * saved enablement overlaying the running Loader state.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const saved = new Map(readSavedEnablements(this.config.profilePatchPath).map(row => [row.entryId, !row.disabled]))
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: saved.get(entry.id) ?? !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    return { entries }
  }

  /**
   * Persist one Loader entry's next-start enablement on the profile patch
   * layer. The running tree stays untouched until restart.
   * @param request - Loader entry id and desired enablement.
   * @returns the refreshed inventory snapshot.
   */
  @Remote('set-enabled')
  setEnabled(request: SetPluginEnabledRequest): Promise<PluginInventorySnapshot> {
    return this.enqueue(async () => {
      const matches = [...this.ctx.loader.entries()]
        .filter(entry => entry.id === request.entryId && !entry.options.group)
      if (matches.length !== 1) {
        throw new Error(`plugin-inventory: Loader entry ${JSON.stringify(request.entryId)} is not uniquely mounted`)
      }
      await writeSavedEnablement(this.config.profilePatchPath, request.entryId, request.enabled)
      return this.list()
    })
  }
}

export default PluginInventoryGateway
