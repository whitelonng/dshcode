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
  /** The registry's SRI declaration for the installed tarball, when present. */
  integrity?: string
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

/** One install/update operation phase reported to the browser. */
export type InstallStage = 'fetch' | 'download' | 'extract' | 'write'

/** Point-in-time progress of the currently running install or update. */
export interface InstallProgress {
  /** 'idle' when no mutation runs, otherwise which mutation reports. */
  readonly kind: 'idle' | 'install' | 'update'
  /** Current phase of the running mutation ('fetch' while idle). */
  readonly stage: InstallStage
  /** Download completion in percent (0–100), absent outside the download phase. */
  readonly percent?: number
}

/** Trust level of a plugin index source. */
export type PluginSourceTrust = 'official' | 'community' | 'untrusted'

/** One registered plugin index source. */
export interface PluginSourceRow {
  /** Stable source id (unique across sources.yml). */
  id: string
  /** Index locator: a hub-catalog JSON URL or a local file path. */
  locator: string
  /** Trust level shown beside every entry this source yields. */
  trust: PluginSourceTrust
}

/** One searchable plugin entry produced by an index source. */
export interface PluginCatalogEntry {
  /** Canonical plugin id (the repository or package name). */
  id: string
  /** Install form: a `dsh.bundle` package or a plain cordis plugin. */
  kind: 'bundle' | 'plugin'
  /** Install spec (npm package name or git repository). */
  source: string
  /** Capability faces derived from the manifest (`skill`/`bundle`/…). */
  faces: string[]
  /** Short description from the catalog, when present. */
  description?: string
  /** The owning index source id. */
  sourceId: string
}

/** One TOFU lock: the canonical install → its resolved reference. */
export interface PluginLockEntry {
  /** The canonical install name or spec. */
  canonical: string
  /** The installed form at lock time. */
  kind: 'bundle' | 'plugin'
  /** The resolved reference (npm spec or git URL) recorded at install. */
  ref: string
  /** Content hash of the enumerated entry, when the source provided one. */
  hash?: string
  /** ISO timestamp of the recording. */
  recordedAt: string
}

/** A cached enumeration snapshot of one index source. */
export interface EnumerateSnapshot {
  /** ISO timestamp of the fetch. */
  fetchedAt: string
  /** The response ETag for conditional refresh, when the source sent one. */
  etag?: string
  /** The transformed catalog entries. */
  entries: PluginCatalogEntry[]
}
