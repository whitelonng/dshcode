/** Profile user-patch layer row management for installed plugins. */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isMap, isScalar, isSeq, parseDocument, type Document, type ScalarTag, type YAMLMap, type YAMLSeq } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const MARKER_PREFIX = 'dsh-plugin-installer:'

const JS_EXPRESSION_TAG: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: value => value,
}

/** Whether an unknown filesystem failure reports a missing file. */
function isMissing(error: unknown): boolean {
  /* v8 ignore next -- node:fs promise rejections are ErrnoException objects, never null or undefined. */
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** Whether one YAML item carries the installer marker for `pluginId`. */
function isManagedItem(item: unknown, pluginId: string): boolean {
  if (!isMap(item)) return false
  const expected = `${MARKER_PREFIX} ${pluginId}`
  return (item.commentBefore ?? '').split('\n').some(line => line.trim() === expected)
}

/** A parsed patch file: the yaml document and its top-level sequence. */
interface PatchDocument {
  readonly document: Document
  readonly root: YAMLSeq
}

/**
 * Parse a patch file for a read or update, failing loud on invalid YAML and
 * non-array roots.
 * @param text - file content.
 * @param filename - absolute profile `cordis.patch.yml` path (diagnostics only).
 * @param action - 'read' or 'update', used in the error prefix.
 * @returns the parsed document and root sequence.
 */
function openPatchDocument(text: string, filename: string, action: 'read' | 'update'): PatchDocument {
  const document = parseDocument(text, {
    customTags: [JS_EXPRESSION_TAG],
    prettyErrors: true,
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    const firstError = document.errors[0]
    if (firstError === undefined) {
      throw new Error(`plugin-installer: cannot ${action} invalid YAML at ${filename}`)
    }
    throw new Error(`plugin-installer: cannot ${action} invalid YAML at ${filename}: ${firstError.message}`)
  }
  const root = document.contents
  if (!isSeq(root)) {
    throw new Error(`plugin-installer: ${filename} must contain a top-level YAML array`)
  }
  return { document, root }
}

/**
 * The first inserted entry row of a managed `insert` patch item. The user
 * patch layer applies bare rows as overrides of existing entries (a row with
 * an unknown id is skipped), so installed plugins must ride an `insert` item.
 * @param item - one top-level patch item carrying the installer marker.
 * @returns the inserted row map, or undefined for a legacy bare row.
 */
function insertRowOf(item: unknown): YAMLMap<unknown, unknown> | undefined {
  if (!isMap(item)) return undefined
  const insert = (item as unknown as YAMLMap<unknown, unknown>).get('insert')
  if (!isSeq(insert) || insert.items.length === 0) return undefined
  const first = insert.items[0]
  return isMap(first) ? first as unknown as YAMLMap<unknown, unknown> : undefined
}

/**
 * Build one managed `insert` patch item for an installed plugin.
 * @param document - owning yaml document (node factory).
 * @param pluginId - installed package name (row id and module name).
 * @param disabled - whether the inserted row disables the plugin; undefined
 * omits the key (an install mounts the plugin).
 * @returns the marker-carrying top-level item.
 */
function buildInsertItem(document: Document, pluginId: string, disabled?: boolean): YAMLMap<unknown, unknown> {
  const row: { id: string; name: string; disabled?: boolean } = { id: pluginId, name: pluginId }
  if (disabled !== undefined) row.disabled = disabled
  const item = document.createNode({ insert: [row] })
  if (!isMap(item)) throw new Error('plugin-installer: failed to build a patch row')
  item.commentBefore = ` ${MARKER_PREFIX} ${pluginId}`
  return item as unknown as YAMLMap<unknown, unknown>
}

/** Read one patch file, treating a missing file as an empty layer. */
async function readPatchFile(filename: string): Promise<string> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error: unknown) {
    if (!isMissing(error)) throw error
    return '[]\n'
  }
}

/** Push an item into the root sequence, bridging yaml's narrow seq item type. */
function pushItem(root: YAMLSeq, item: unknown): void {
  root.items.push(item as never)
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
