import type {
  PluginControlId,
  PluginControlSnapshot,
  PluginControlState,
} from '@deepseek-ai/dsh-api-remotes/client'

const CONTROL_STATES = new Set<PluginControlState>(['enabled', 'disabled', 'mixed', 'unavailable'])

/** Whether a wire value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate the business payload returned through the generic Connection RPC.
 * @param value - decoded but untrusted response value.
 * @returns typed control snapshot.
 */
export function parsePluginControlSnapshot(value: unknown): PluginControlSnapshot {
  if (!isRecord(value) || !Array.isArray(value.controls)) {
    throw new Error('plugin-control: response must contain a controls array')
  }
  const controls = value.controls.map((item) => {
    if (!isRecord(item)
      || typeof item.id !== 'string'
      || typeof item.name !== 'string'
      || typeof item.repository !== 'string'
      || typeof item.state !== 'string'
      || !CONTROL_STATES.has(item.state as PluginControlState)) {
      throw new Error('plugin-control: response contains an invalid control')
    }
    return {
      id: item.id as PluginControlId,
      name: item.name,
      repository: item.repository,
      state: item.state as PluginControlState,
    }
  })
  return { controls }
}
