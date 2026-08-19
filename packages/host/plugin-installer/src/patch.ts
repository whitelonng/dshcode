/** Profile user-patch layer row management for installed plugins. */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isMap, isScalar, isSeq, type Document, type YAMLMap } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isMissing, openPatchDocument, pushItem, readPatchFile } from './patch-document.ts'

const MARKER_PREFIX = 'dsh-plugin-installer:'

/** The marker prefix plugin-control writes for its product rows. */
const CONTROL_MARKER_PREFIX = 'dsh-plugin-control:'

/** Whether one YAML item carries the installer marker for `pluginId`. */
function isManagedItem(item: unknown, pluginId: string): boolean {
  if (!isMap(item)) return false
  const expected = `${MARKER_PREFIX} ${pluginId}`
  return (item.commentBefore ?? '').split('\n').some(line => line.trim() === expected)
}

/**
 * The first inserted entry row of a managed `insert` patch item. The user
 * patch layer applies bare rows as overrides of existing entries (a row with
 * an unknown id is skipped), so installed plugins must ride an `insert` item.
 * @param item - one top-level patch item carrying the installer marker.
 * @returns the inserted row map, or undefined for a legacy bare row.
 */
function insertRowOf(item: unknown): YAMLMap | undefined {
  if (!isMap(item)) return undefined
  const insert = item.get('insert')
  if (!isSeq(insert) || insert.items.length === 0) return undefined
  const first = insert.items[0]
  return isMap(first) ? first : undefined
}

/**
 * Build one managed `insert` patch item for an installed plugin.
 * @param document - owning yaml document (node factory).
 * @param pluginId - installed package name (row id and module name).
 * @param disabled - whether the inserted row disables the plugin; undefined
 * omits the key (an install mounts the plugin).
 * @returns the marker-carrying top-level item.
 */
function buildInsertItem(document: Document, pluginId: string, disabled?: boolean): YAMLMap {
  const row: { id: string; name: string; disabled?: boolean } = { id: pluginId, name: pluginId }
  if (disabled !== undefined) row.disabled = disabled
  const item = document.createNode({ insert: [row] })
  /* v8 ignore next 3 -- createNode always returns a map for a plain object */
  if (!isMap(item)) throw new Error('plugin-installer: failed to build a patch row')
  item.commentBefore = ` ${MARKER_PREFIX} ${pluginId}`
  return item
}

/**
 * Insert one loader row for an installed plugin into the profile user patch
 * layer, preserving every unowned node, comment, and `!!js` expression.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param pluginId - installed package name (row id).
 * @returns resolution after the atomic write settles.
 */
export async function insertPluginRow(filename: string, pluginId: string): Promise<void> {
  await withFileLock(filename, async () => {
    const text = await readPatchFile(filename)
    const { document, root } = openPatchDocument(text, filename, 'update')
    if (root.items.some(item => isManagedItem(item, pluginId))) return
    pushItem(root, buildInsertItem(document, pluginId))
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600 })
  })
}

/**
 * Remove one managed loader row from the profile user patch layer.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param pluginId - installed package name (row id).
 * @returns resolution after the atomic write settles.
 */
export async function removePluginRow(filename: string, pluginId: string): Promise<void> {
  await withFileLock(filename, async () => {
    let text: string
    try {
      text = await readFile(filename, 'utf8')
    } catch (error: unknown) {
      if (isMissing(error)) return
      throw error
    }
    const { document, root } = openPatchDocument(text, filename, 'update')
    const remaining = root.items.filter(item => !isManagedItem(item, pluginId))
    if (remaining.length === root.items.length) return
    root.items = remaining
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600 })
  })
}

/**
 * Read the saved enablement of one installed plugin from its managed loader
 * row. A missing row (or a legacy bare row, which never mounted anything)
 * counts as enabled.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param pluginId - installed package name (row id).
 * @returns whether the managed insert row does not disable the plugin.
 */
export function readPluginRowEnabled(filename: string, pluginId: string): boolean {
  let text: string
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return true
    throw error
  }
  const { root } = openPatchDocument(text, filename, 'read')
  const managed = root.items.find(item => isManagedItem(item, pluginId))
  const row = insertRowOf(managed)
  if (row === undefined) return true
  // yaml types parsed-map values as child nodes; this row's scalars hold primitives.
  const disabled = row.get('disabled', true)
  return !(isScalar(disabled) && disabled.value === true)
}

/**
 * Persist the saved enablement of one installed plugin on its managed loader
 * row, creating the row when it is missing. The change applies at the next
 * process start because the running Loader does not hot-apply profile rows.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param pluginId - installed package name (row id).
 * @param enabled - desired next-start enablement.
 * @returns resolution after the atomic write settles.
 */
export async function setPluginRowEnabled(filename: string, pluginId: string, enabled: boolean): Promise<void> {
  await withFileLock(filename, async () => {
    const text = await readPatchFile(filename)
    const { document, root } = openPatchDocument(text, filename, 'update')
    const managed = root.items.find(item => isManagedItem(item, pluginId))
    const row = insertRowOf(managed)
    if (row !== undefined) {
      row.set('disabled', document.createNode(!enabled))
    } else {
      // No row, or a legacy bare row from before the insert format: replace.
      const index = managed === undefined ? -1 : root.items.indexOf(managed)
      const item = buildInsertItem(document, pluginId, !enabled)
      if (index >= 0) {
        root.items.splice(index, 1, item as never)
      } else {
        pushItem(root, item)
      }
    }
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600 })
  })
}

/**
 * Flip the saved enablement of every row plugin-control manages for one
 * product (`# dsh-plugin-control: <id>` marker items, each an insert item
 * with one row). Used by the installer's conflict rules: when the user
 * installs a plugin that duplicates a built-in product, the product's rows
 * are disabled so the two suites do not double-mount. Rows absent from the
 * patch are left alone (the control's own write path recreates them).
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param controlId - the plugin-control product id.
 * @param enabled - desired next-start enablement for the product's rows.
 * @returns resolution after the atomic write settles.
 */
export async function setControlRowsEnabled(filename: string, controlId: string, enabled: boolean): Promise<void> {
  await withFileLock(filename, async () => {
    const text = await readPatchFile(filename)
    const { document, root } = openPatchDocument(text, filename, 'update')
    const expected = `${CONTROL_MARKER_PREFIX} ${controlId}`
    let touched = false
    for (const item of root.items) {
      if (!isMap(item)) continue
      const marked = (item.commentBefore ?? '').split('\n').some(line => line.trim() === expected)
      if (!marked) continue
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
