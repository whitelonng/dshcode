/** Wire validation for the plugin-installer responses. */

/** One installed plugin row. */
export interface InstalledPluginItem {
  id: string
  name: string
  version: string
  source: { kind: 'npm' | 'git'; spec: string }
  installedAt: string
  /** Saved next-start enablement from the managed profile patch row. */
  enabled: boolean
  commit?: string
}

/** Point-in-time install/update progress reported by the host. */
export interface InstallProgressItem {
  kind: 'idle' | 'install' | 'update'
  stage: 'fetch' | 'download' | 'extract' | 'write'
  percent?: number
}

/** One plugin with a newer version available. */
export interface PluginUpdateItem {
  id: string
  current: string
  latest: string
}

/** Whether a decoded value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate one plugin row. */
function parsePlugin(value: unknown, index: number): InstalledPluginItem {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string'
    || typeof value.version !== 'string' || typeof value.installedAt !== 'string'
    || typeof value.enabled !== 'boolean'
    || !isRecord(value.source) || (value.source.kind !== 'npm' && value.source.kind !== 'git')
    || typeof value.source.spec !== 'string') {
    throw new Error(`plugin-installer: plugin row ${String(index)} is invalid`)
  }
  return {
    id: value.id,
    name: value.name,
    version: value.version,
    source: { kind: value.source.kind, spec: value.source.spec },
    installedAt: value.installedAt,
    enabled: value.enabled,
    ...typeof value.commit === 'string' ? { commit: value.commit } : {},
  }
}

/**
 * Validate and normalize a `list` / `uninstall` response value.
 * @param value - decoded but untrusted response value.
 * @returns typed installed-plugin rows.
 */
export function parsePluginList(value: unknown): InstalledPluginItem[] {
  if (!isRecord(value) || !Array.isArray(value.plugins)) {
    throw new Error('plugin-installer: response must contain a plugins array')
  }
  return value.plugins.map((plugin, index) => parsePlugin(plugin, index))
}

/**
 * Validate and normalize an `install` / `update` response value.
 * @param value - decoded but untrusted response value.
 * @returns the typed installed-plugin row.
 */
export function parseInstalledPlugin(value: unknown): InstalledPluginItem {
  if (!isRecord(value) || !isRecord(value.plugin)) {
    throw new Error('plugin-installer: response must contain a plugin row')
  }
  return parsePlugin(value.plugin, 0)
}

/** One deployment-configured logical product switch. */
export interface PluginControlItem {
  id: string
  name: string
  repository: string
  state: 'enabled' | 'disabled' | 'mixed' | 'unavailable'
}

/**
 * Validate and normalize a plugin-control `list` / `set-enabled` response.
 * @param value - decoded but untrusted response value.
 * @returns the typed control items.
 */
export function parsePluginControlSnapshot(value: unknown): PluginControlItem[] {
  if (!isRecord(value) || !Array.isArray(value.controls)) {
    throw new Error('plugin-control: response must contain a controls array')
  }
  return value.controls.map((control, index) => {
    if (!isRecord(control) || typeof control.id !== 'string' || typeof control.name !== 'string'
      || typeof control.repository !== 'string'
      || (control.state !== 'enabled' && control.state !== 'disabled'
        && control.state !== 'mixed' && control.state !== 'unavailable')) {
      throw new Error(`plugin-control: control row ${String(index)} is invalid`)
    }
    return {
      id: control.id,
      name: control.name,
      repository: control.repository,
      state: control.state,
    }
  })
}

/**
 * Validate and normalize a `status` response value.
 * @param value - decoded but untrusted response value.
 * @returns the typed progress state.
 */
export function parseInstallStatus(value: unknown): InstallProgressItem {
  if (!isRecord(value) || !isRecord(value.progress)
    || (value.progress.kind !== 'idle' && value.progress.kind !== 'install' && value.progress.kind !== 'update')
    || (value.progress.stage !== 'fetch' && value.progress.stage !== 'download'
      && value.progress.stage !== 'extract' && value.progress.stage !== 'write')
    || (value.progress.percent !== undefined
      && (typeof value.progress.percent !== 'number' || !Number.isFinite(value.progress.percent)))) {
    throw new Error('plugin-installer: response must contain a valid progress state')
  }
  return {
    kind: value.progress.kind,
    stage: value.progress.stage,
    ...typeof value.progress.percent === 'number' ? { percent: value.progress.percent } : {},
  }
}

/**
 * Validate and normalize a `check-updates` response value.
 * @param value - decoded but untrusted response value.
 * @returns typed update rows.
 */
export function parseUpdateList(value: unknown): PluginUpdateItem[] {
  if (!isRecord(value) || !Array.isArray(value.updates)) {
    throw new Error('plugin-installer: response must contain an updates array')
  }
  return value.updates.map((update, index) => {
    if (!isRecord(update) || typeof update.id !== 'string' || typeof update.current !== 'string'
      || typeof update.latest !== 'string') {
      throw new Error(`plugin-installer: update row ${String(index)} is invalid`)
    }
    return { id: update.id, current: update.current, latest: update.latest }
  })
}
