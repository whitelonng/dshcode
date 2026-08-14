/** Wire types for the plugin-installer gateway. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable plugin id: the installed package name (including scope). */
export type PluginInstallId = Branded<'PluginInstallId'>

/** Where a plugin was installed from. */
export interface PluginSource {
  /** npm registry package or git repository. */
  kind: 'npm' | 'git'
  /** The exact install spec (`name[@range]`, git URL). */
  spec: string
}

/** One installed user plugin, as recorded in the state file. */
export interface InstalledPlugin {
  /** Package name, also the id. */
  id: PluginInstallId
  /** Display name from the installed package.json. */
  name: string
  /** Installed version (git sources: the cloned HEAD describe fallback). */
  version: string
  /** Install source. */
  source: PluginSource
  /** ISO timestamp of the install. */
  installedAt: string
  /** Saved next-start enablement from the managed profile patch row. */
  enabled: boolean
  /** Git HEAD commit at install time, when the source is a git repository. */
  commit?: string
}

/** The durable install-state file (`$DSH_HOME/plugins.json`). */
export interface PluginStateFile {
  plugins: InstalledPluginRecord[]
}

/** One installed plugin as recorded durably (enablement is derived, not stored). */
export type InstalledPluginRecord = Omit<InstalledPlugin, 'enabled'>

/** The complete installed snapshot the browser renders. */
export interface PluginInstallerSnapshot {
  plugins: InstalledPlugin[]
}

/** One plugin with a known newer version available. */
export interface PluginUpdateInfo {
  id: PluginInstallId
  /** Installed version. */
  current: string
  /** Latest resolvable version (npm: dist-tags.latest; git: remote HEAD hash). */
  latest: string
}

/** `install` / `update` request payloads. */
export interface InstallPluginRequest {
  /** npm spec (`name`, `name@version`, `name@range`) or git repository URL. */
  spec: string
}

/** `set-enabled` request payload. */
export interface SetPluginEnabledRequest {
  /** Installed plugin id (package name). */
  id: PluginInstallId
  /** Desired next-start enablement. */
  enabled: boolean
}
