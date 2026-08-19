/** Bundle-style plugin patch-row management: an installed bundle's own patch layer. */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isScalar, isSeq } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isMissing, openPatchDocument, pushItem, readPatchFile } from './patch-document.ts'

/** Marker prefix for rows merged from an installed bundle-style plugin's own patch. */
const BUNDLE_MARKER_PREFIX = 'dsh-plugin-bundle:'

/** Whether one YAML item carries the bundle marker for `pluginId`. */
function isBundleManagedItem(item: unknown, pluginId: string): boolean {
  if (!isMap(item)) return false
  const expected = `${BUNDLE_MARKER_PREFIX} ${pluginId}`
  return (item.commentBefore ?? '').split('\n').some(line => line.trim() === expected)
}

/** Every entry id one patch item claims: its own id, or its insert rows' ids. */
function claimedIds(item: unknown): string[] {
  if (!isMap(item)) return []
  const ids: string[] = []
  const own = item.get('id')
  if (typeof own === 'string') ids.push(own)
  const insert = item.get('insert')
  if (isSeq(insert)) {
    for (const row of insert.items) {
      if (!isMap(row)) continue
      const id = row.get('id')
      if (typeof id === 'string') ids.push(id)
    }
  }
  return ids
}

/**
 * Resolve an installed package manifest's `dsh.bundle.patch` declaration to
 * an absolute path. A package without the declaration is a plain plugin.
 * @param manifest - the installed package's raw manifest.
 * @param installedDir - the installed package directory.
 * @returns the absolute bundle patch path, or undefined for plain plugins.
 */
export function bundlePatchPath(manifest: Record<string, unknown>, installedDir: string): string | undefined {
  const dsh = manifest.dsh
  if (typeof dsh !== 'object' || dsh === null) return undefined
  const bundle = (dsh as { bundle?: unknown }).bundle
  if (typeof bundle !== 'object' || bundle === null) return undefined
  const patch = (bundle as { patch?: unknown }).patch
  if (typeof patch !== 'string' || patch === '') return undefined
  return join(installedDir, patch)
}

/**
 * Merge the patch items of an installed bundle-style plugin (a package
 * declaring `dsh.bundle.patch`) into the profile user patch layer, preserving
 * every unowned node, comment, and `!!js` expression. Insert rows whose ids
 * the profile patch already claims (a preset product row, the plugin's own
 * installer row) are skipped — a second insert of the same id would duplicate
 * the entry at boot; the existing row keeps mounting the package. Bare
 * override rows append verbatim (they patch existing entries by id, and the
 * last row wins). Every merged item carries the `dsh-plugin-bundle:` marker
 * so uninstall and enablement toggles can find them. A re-merge first drops
 * the plugin's earlier merged items, so an update re-reads the new version's
 * patch.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param bundlePatchPath - absolute path of the installed plugin's `dsh.bundle.patch` file.
 * @param pluginId - installed package name (row id and module name).
 * @returns resolution after the atomic write settles.
 */
export async function mergeBundleRows(filename: string, bundlePatchPath: string, pluginId: string): Promise<void> {
  await withFileLock(filename, async () => {
    const text = await readPatchFile(filename)
    const { document, root } = openPatchDocument(text, filename, 'update')
    root.items = root.items.filter(item => !isBundleManagedItem(item, pluginId))
    let bundleText: string
    try {
      bundleText = await readFile(bundlePatchPath, 'utf8')
    } catch (error: unknown) {
      if (isMissing(error)) {
        throw new Error(`plugin-installer: bundle patch ${bundlePatchPath} declared by ${pluginId} is missing`)
      }
      throw error
    }
    const bundle = openPatchDocument(bundleText, bundlePatchPath, 'read')
    const claimed = new Set<string>()
    for (const item of root.items) {
      for (const id of claimedIds(item)) claimed.add(id)
    }
    for (const item of bundle.root.items) {
      if (!isMap(item)) continue
      const insert = item.get('insert')
      if (isSeq(insert)) {
        const kept = insert.items.filter((row) => {
          if (!isMap(row)) return false
          const id = row.get('id')
          return typeof id === 'string' && !claimed.has(id)
        })
        if (kept.length === 0) continue
        const copy = item.clone()
        const copyInsert = copy.get('insert')
        if (isSeq(copyInsert)) copyInsert.items = kept
        copy.commentBefore = ` ${BUNDLE_MARKER_PREFIX} ${pluginId}`
        for (const id of claimedIds(copy)) claimed.add(id)
        pushItem(root, copy)
      } else if (typeof item.get('id') === 'string') {
        const copy = item.clone()
        copy.commentBefore = ` ${BUNDLE_MARKER_PREFIX} ${pluginId}`
        pushItem(root, copy)
      }
    }
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600 })
  })
}

/**
 * Remove one plugin's merged bundle rows from the profile user patch layer.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param pluginId - installed package name (row id).
 * @returns resolution after the atomic write settles.
 */
export async function removeBundleRows(filename: string, pluginId: string): Promise<void> {
  await withFileLock(filename, async () => {
    let text: string
    try {
      text = await readFile(filename, 'utf8')
    } catch (error: unknown) {
      if (isMissing(error)) return
      throw error
    }
    const { document, root } = openPatchDocument(text, filename, 'update')
    const remaining = root.items.filter(item => !isBundleManagedItem(item, pluginId))
    if (remaining.length === root.items.length) return
    root.items = remaining
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600 })
  })
}

/**
 * Persist one plugin's next-start enablement on every row it merged from its
 * bundle patch, mirroring the installer row's `disabled` flag so the family
 * switch controls the whole group.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param pluginId - installed package name (row id).
 * @param enabled - desired next-start enablement.
 * @returns resolution after the atomic write settles.
 */
export async function setBundleRowsEnabled(filename: string, pluginId: string, enabled: boolean): Promise<void> {
  await withFileLock(filename, async () => {
    const text = await readPatchFile(filename)
    const { document, root } = openPatchDocument(text, filename, 'update')
    let touched = false
    for (const item of root.items) {
      if (!isBundleManagedItem(item, pluginId) || !isMap(item)) continue
      touched = true
      const insert = item.get('insert')
      if (isSeq(insert)) {
        for (const row of insert.items) {
          if (isMap(row)) row.set('disabled', document.createNode(!enabled))
        }
      } else {
        item.set('disabled', document.createNode(!enabled))
      }
    }
    if (touched) {
      await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600 })
    }
  })
}

/**
 * Persist one bundle-layer plugin's next-start enablement. A bundle installed
 * through the profile layer stack mounts via its patch rows at boot — there
 * is no installer row to flip — so disabling writes bare override rows
 * (`disabled: true`) for every insert-row id the bundle's patch declares,
 * each marked with the bundle marker so removal can find them. Enabling
 * removes those override rows.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param bundlePatchPath - absolute path of the installed plugin's `dsh.bundle.patch` file.
 * @param pluginId - installed package name (row id and module name).
 * @param enabled - desired next-start enablement.
 * @returns resolution after the atomic write settles.
 */
export async function setBundleLayerEnabled(
  filename: string, bundlePatchPath: string, pluginId: string, enabled: boolean,
): Promise<void> {
  if (enabled) {
    await removeBundleRows(filename, pluginId)
    return
  }
  let bundleText: string
  try {
    bundleText = await readFile(bundlePatchPath, 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return
    throw error
  }
  const bundle = openPatchDocument(bundleText, bundlePatchPath, 'read')
  const ids: string[] = []
  for (const item of bundle.root.items) {
    if (!isMap(item)) continue
    const insert = item.get('insert')
    if (isSeq(insert)) {
      for (const row of insert.items) {
        if (!isMap(row)) continue
        const id = row.get('id')
        if (typeof id === 'string') ids.push(id)
      }
    }
  }
  if (ids.length === 0) return
  await withFileLock(filename, async () => {
    const text = await readPatchFile(filename)
    const { document, root } = openPatchDocument(text, filename, 'update')
    root.items = root.items.filter(item => !isBundleManagedItem(item, pluginId))
    for (const id of ids) {
      const row = document.createNode({ id, disabled: true })
      /* v8 ignore next 2 -- createNode always returns a map for a plain object */
      if (!isMap(row)) continue
      row.commentBefore = ` ${BUNDLE_MARKER_PREFIX} ${pluginId}`
      pushItem(root, row)
    }
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600 })
  })
}

/**
 * Read one bundle-layer plugin's saved enablement: disabled when any
 * bundle-marker override row carries `disabled: true`.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param pluginId - installed package name.
 * @returns whether the bundle-layer plugin is enabled.
 */
export function readBundleLayerEnabled(filename: string, pluginId: string): boolean {
  let text: string
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return true
    throw error
  }
  const { root } = openPatchDocument(text, filename, 'read')
  for (const item of root.items) {
    if (!isBundleManagedItem(item, pluginId) || !isMap(item)) continue
    const insert = item.get('insert')
    if (isSeq(insert)) continue
    const disabled = item.get('disabled', true)
    if (isScalar(disabled) && disabled.value === true) return false
  }
  return true
}
