/** Profile-patch persistence for loopback plugin-inventory enablement. */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isMap, isScalar, isSeq, parseDocument, type ScalarTag, type YAMLMap } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const MARKER_PREFIX = 'dsh-plugin-inventory:'

const JS_EXPRESSION_TAG: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: value => value,
}

/** Whether an unknown filesystem failure reports a missing file. */
function isMissing(error: unknown): boolean {
  /* v8 ignore next -- node:fs promise rejections are ErrnoException objects, never null or undefined. */
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** One saved enablement row read from the patch layer. */
export interface SavedEnablement {
  /** Loader entry id written by the enablement row. */
  readonly entryId: string
  /** Whether the row disables the entry at next start. */
  readonly disabled: boolean
}

/**
 * Read every plugin-inventory-managed enablement row from the profile user
 * patch layer. A missing patch file has no saved rows.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @returns the managed rows in patch order.
 */
export function readSavedEnablements(filename: string): SavedEnablement[] {
  let text: string
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return []
    throw error
  }
  const document = parseDocument(text, {
    customTags: [JS_EXPRESSION_TAG],
    prettyErrors: true,
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    const firstError = document.errors[0]
    if (firstError === undefined) {
      throw new Error(`plugin-inventory: cannot read invalid YAML at ${filename}`)
    }
    throw new Error(`plugin-inventory: cannot read invalid YAML at ${filename}: ${firstError.message}`)
  }
  const root = document.contents
  if (!isSeq(root)) {
    throw new Error(`plugin-inventory: ${filename} must contain a top-level YAML array`)
  }
  const rows: SavedEnablement[] = []
  for (const item of root.items) {
    if (!isMap(item)) continue
    // yaml types parsed-map values as child nodes; this row's scalars hold primitives.
    const row = item as unknown as YAMLMap<unknown, unknown>
    const marker = (row.commentBefore ?? '').split('\n')
      .map(line => line.trim())
      .find(line => line.startsWith(MARKER_PREFIX))
    if (marker === undefined) continue
    const entryId = marker.slice(MARKER_PREFIX.length).trim()
    if (entryId === '') continue
    const disabled = row.get('disabled', true)
    rows.push({ entryId, disabled: isScalar(disabled) && disabled.value === true })
  }
  return rows
}

/**
 * Replace one Loader entry's managed enablement row while preserving every
 * unowned YAML node, comment, and `!!js` expression in the profile layer.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param entryId - Loader entry id receiving the override.
 * @param enabled - desired explicit enablement persisted after user patches.
 */
export async function writeSavedEnablement(
  filename: string,
  entryId: string,
  enabled: boolean,
): Promise<void> {
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
        throw new Error(`plugin-inventory: cannot update invalid YAML at ${filename}`)
      }
      throw new Error(`plugin-inventory: cannot update invalid YAML at ${filename}: ${firstError.message}`)
    }
    if (!isSeq(document.contents)) {
      throw new Error(`plugin-inventory: ${filename} must contain a top-level YAML array`)
    }

    const items = document.contents.items
    const managed = items.find(item => isMap(item)
      && (item.commentBefore ?? '').split('\n').some(line => line.trim() === `${MARKER_PREFIX} ${entryId}`))
    if (managed !== undefined && isMap(managed)) {
      // yaml types parsed-map values as child nodes; this row's scalars hold primitives.
      const row = managed as unknown as YAMLMap<unknown, unknown>
      row.set('disabled', document.createNode(!enabled))
    } else {
      const item = document.createNode({ id: entryId, disabled: !enabled })
      /* v8 ignore next -- createNode(object) is guaranteed to return a YAML map. */
      if (!isMap(item)) {
        throw new Error('plugin-inventory: YAML library did not create a map node')
      }
      item.commentBefore = ` ${MARKER_PREFIX} ${entryId}`
      // parseDocument narrows the sequence to range-bearing ParsedNode values,
      // while Document.createNode correctly returns a fresh pre-stringify node.
      items.push(item as never)
    }
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600, dirMode: 0o700 })
  })
}
