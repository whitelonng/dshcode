/** Profile user-patch layer row management for installed plugins. */

import { readFile } from 'node:fs/promises'
import { isMap, isSeq, parseDocument, type ScalarTag } from 'yaml'
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

/**
 * Insert one loader row for an installed plugin into the profile user patch
 * layer, preserving every unowned node, comment, and `!!js` expression.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param pluginId - installed package name (row id).
 * @returns resolution after the atomic write settles.
 */
export async function insertPluginRow(filename: string, pluginId: string): Promise<void> {
  await withFileLock(filename, async () => {
    let text: string
    try {
      text = await readFile(filename, 'utf8')
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
      text = '[]\n'
    }
    const document = parseDocument(text, {
      customTags: [JS_EXPRESSION_TAG],
      prettyErrors: true,
      uniqueKeys: true,
    })
    if (document.errors.length > 0) {
      const firstError = document.errors[0]
      if (firstError === undefined) {
        throw new Error(`plugin-installer: cannot update invalid YAML at ${filename}`)
      }
      throw new Error(`plugin-installer: cannot update invalid YAML at ${filename}: ${firstError.message}`)
    }
    const root = document.contents
    if (!isSeq(root)) {
      throw new Error(`plugin-installer: ${filename} must contain a top-level YAML array`)
    }
    if (root.items.some(item => isManagedItem(item, pluginId))) return
    const entry = document.createNode({ id: pluginId, name: pluginId })
    if (!isMap(entry)) throw new Error('plugin-installer: failed to build a patch row')
    entry.commentBefore = ` ${MARKER_PREFIX} ${pluginId}`
    // yaml's seq item type is narrower than createNode's return under
    // exactOptionalPropertyTypes; the map we just built is a valid item.
    root.items.push(entry as unknown as Parameters<typeof root.items.push>[number])
    const serialized = document.toString({ lineWidth: 0 })
    await writeFileAtomic(filename, serialized, { mode: 0o600 })
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
      if (!isMissing(error)) throw error
      return
    }
    const document = parseDocument(text, {
      customTags: [JS_EXPRESSION_TAG],
      prettyErrors: true,
      uniqueKeys: true,
    })
    if (document.errors.length > 0) {
      const firstError = document.errors[0]
      if (firstError === undefined) {
        throw new Error(`plugin-installer: cannot update invalid YAML at ${filename}`)
      }
      throw new Error(`plugin-installer: cannot update invalid YAML at ${filename}: ${firstError.message}`)
    }
    const root = document.contents
    if (!isSeq(root)) return
    const remaining = root.items.filter(item => !isManagedItem(item, pluginId))
    if (remaining.length === root.items.length) return
    root.items = remaining
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600 })
  })
}
