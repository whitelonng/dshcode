import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable deployment-defined identity of one logical plugin control. */
export type PluginControlId = Branded<'PluginControlId'>

/** Saved or running aggregate state of the Loader entries governed by one logical control. */
export type PluginControlState = 'enabled' | 'disabled' | 'mixed' | 'unavailable' | 'uninstalled'

/** One logical plugin product exposed to the browser control panel. */
export interface PluginControlItem {
  /** Stable control identity used by mutation requests. */
  readonly id: PluginControlId
  /** Human-readable product name supplied by the composing profile. */
  readonly name: string
  /** Upstream source repository for attribution and inspection. */
  readonly repository: string
  /** Saved desired state, or aggregate running state before a same-process write. */
  readonly state: PluginControlState
}

/** Point-in-time control catalog returned by the loopback RPC channel. */
export interface PluginControlSnapshot {
  readonly controls: readonly PluginControlItem[]
}

/** Request that persists the next-start state of every Loader entry owned by one logical control. */
export interface SetPluginEnabledRequest {
  readonly pluginId: PluginControlId
  readonly enabled: boolean
}
