/** Profile-patch persistence for loopback plugin controls. */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isMap, isSeq, parseDocument, type ScalarTag } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const MARKER_PREFIX = 'dsh-plugin-control:'
const JS_EXPRESSION_TAG: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: value => value,
}

/** One controlled loader row written into the patch layer. */
export interface PersistedControlRow {
  /** Loader entry id the row mounts. */
  readonly entryId: string
  /** Module specifier the Loader imports for that entry. */
  readonly package: string
}

/** Values required to persist one configured logical control. */
export interface PersistedPluginControl {
  /** Stable marker written into YAML comments. */
  readonly id: string
  /** Loader rows governed by the control, entry id and module name each. */
  readonly rows: readonly PersistedControlRow[]
}

/** Whether an unknown filesystem failure reports a missing file. */
function isMissing(error: unknown): boolean {
  /* v8 ignore next -- node:fs promise rejections are ErrnoException objects, never null or undefined. */
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** Whether one YAML item was previously emitted for `controlId`. */
function isManagedItem(item: unknown, controlId: string): boolean {
  if (!isMap(item)) return false
  const expected = `${MARKER_PREFIX} ${controlId}`
  return (item.commentBefore ?? '').split('\n').some(line => line.trim() === expected)
}

/** Read the control id a managed item carries in its marker comment, if any. */
function markerControlId(item: unknown): string | undefined {
  if (!isMap(item)) return undefined
  const line = (item.commentBefore ?? '').split('\n')
    .map(candidate => candidate.trim())
    .find(candidate => candidate.startsWith(MARKER_PREFIX))
  if (line === undefined) return undefined
  return line.slice(MARKER_PREFIX.length).trim()
}

/**
 * Read the control ids the user explicitly uninstalled from the patch layer.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @returns the ids of managed items carrying `uninstalled: true`.
 */
export function readUninstalledControls(filename: string): Set<string> {
  let text: string
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return new Set()
    throw error
  }
  const document = parseDocument(text, {
    customTags: [JS_EXPRESSION_TAG],
    prettyErrors: true,
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    const firstError = document.errors[0]
    /* v8 ignore next 2 -- a positive errors.length guarantees index zero exists. */
    if (firstError === undefined) {
      throw new Error(`plugin-control: cannot read invalid YAML at ${filename}`)
    }
    throw new Error(`plugin-control: cannot read invalid YAML at ${filename}: ${firstError.message}`)
  }
  const root = document.contents
  if (!isSeq(root)) {
    throw new Error(`plugin-control: ${filename} must contain a top-level YAML array`)
  }
  const uninstalled = new Set<string>()
  for (const item of root.items) {
    const id = markerControlId(item)
    if (id === undefined || id === '') continue
    const raw = (item as unknown as { get(key: string): unknown }).get('uninstalled')
    if (raw === true) uninstalled.add(id)
  }
  return uninstalled
}

/**
 * Mark one control as explicitly uninstalled: remove every managed item for
 * it and write `{ uninstalled: true }` so the gateway keeps hiding it while
 * every unowned YAML node, comment, and `!!js` expression is preserved.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param controlId - the logical control being removed from the user's list.
 */
export async function writePluginControlUninstalled(filename: string, controlId: string): Promise<void> {
  await withFileLock(filename, async () => {
    let text: string
    try {
      text = await readFile(filename, 'utf8')
    } catch (error) {
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
      /* v8 ignore next 2 -- a positive errors.length guarantees index zero exists. */
      if (firstError === undefined) {
        throw new Error(`plugin-control: cannot update invalid YAML at ${filename}`)
      }
      throw new Error(`plugin-control: cannot update invalid YAML at ${filename}: ${firstError.message}`)
    }
    if (!isSeq(document.contents)) {
      throw new Error(`plugin-control: ${filename} must contain a top-level YAML array`)
    }

    const items = document.contents.items
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (isManagedItem(items[index], controlId)) items.splice(index, 1)
    }
    const item = document.createNode({ uninstalled: true })
    /* v8 ignore next -- createNode(object) is guaranteed to return a YAML map. */
    if (!isMap(item)) {
      throw new Error('plugin-control: YAML library did not create a map node')
    }
    item.commentBefore = ` ${MARKER_PREFIX} ${controlId}`
    items.push(item as never)
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600, dirMode: 0o700 })
  })
}

/**
 * Replace one control's managed insert rows while preserving every unowned
 * YAML node, comment, and `!!js` expression in the profile layer. Rows ride
 * an `insert` item because bare rows in the user patch layer only override
 * existing entries and would be skipped when the entry is not mounted yet.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param control - logical identity and governed Loader rows.
 * @param enabled - desired explicit enablement persisted after user patches.
 */
export async function writePluginControlState(
  filename: string,
  control: PersistedPluginControl,
  enabled: boolean,
): Promise<void> {
  await withFileLock(filename, async () => {
    let text: string
    try {
      text = await readFile(filename, 'utf8')
    } catch (error) {
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
      /* v8 ignore next 2 -- a positive errors.length guarantees index zero exists. */
      if (firstError === undefined) {
        throw new Error(`plugin-control: cannot update invalid YAML at ${filename}`)
      }
      throw new Error(`plugin-control: cannot update invalid YAML at ${filename}: ${firstError.message}`)
    }
    if (!isSeq(document.contents)) {
      throw new Error(`plugin-control: ${filename} must contain a top-level YAML array`)
    }

    const items = document.contents.items
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (isManagedItem(items[index], control.id)) items.splice(index, 1)
    }
    const item = document.createNode({
      insert: control.rows.map(row => ({ id: row.entryId, name: row.package, disabled: !enabled })),
    })
    /* v8 ignore next -- createNode(object) is guaranteed to return a YAML map. */
    if (!isMap(item)) {
      throw new Error('plugin-control: YAML library did not create a map node')
    }
    item.commentBefore = ` ${MARKER_PREFIX} ${control.id}`
    // parseDocument narrows the sequence to range-bearing ParsedNode values,
    // while Document.createNode correctly returns a fresh pre-stringify node.
    items.push(item as never)
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600, dirMode: 0o700 })
  })
}
