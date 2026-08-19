/** Durable plugin install-state (`$DSH_HOME/plugins.json`). */

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { PluginStateFile } from './types.ts'

/** State filename under the Harness home. */
export const PLUGIN_STATE_FILENAME = 'plugins.json'

/**
 * Resolve the durable state path under a Harness home.
 * @param home - the Harness home.
 * @returns the absolute state path.
 */
export function pluginStatePath(home: string): string {
  return join(home, PLUGIN_STATE_FILENAME)
}

/**
 * Read the install state; an absent or unreadable state parses as empty.
 * A malformed state file throws (fail loud — never silently drop installs).
 * @param home - the Harness home.
 * @returns the parsed state.
 */
export function readPluginState(home: string): PluginStateFile {
  const path = pluginStatePath(home)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { plugins: [] }
    throw error
  }
  const parsed = JSON.parse(raw) as Partial<PluginStateFile>
  if (!Array.isArray(parsed.plugins)) {
    throw new Error(`plugin-installer: ${path} must contain a plugins array`)
  }
  return { plugins: parsed.plugins }
}

/**
 * Durably replace the install state.
 * @param home - the Harness home.
 * @param state - the new state.
 * @returns resolution after the atomic write settles.
 */
export async function writePluginState(home: string, state: PluginStateFile): Promise<void> {
  const path = pluginStatePath(home)
  mkdirSync(dirname(path), { recursive: true })
  await writeFileAtomic(path, JSON.stringify(state, undefined, 2) + '\n', { mode: 0o600 })
}
