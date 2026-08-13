/** Profile-patch persistence for loopback plugin controls. */

import { readFile } from 'node:fs/promises'
import { isMap, isSeq, parseDocument, type ScalarTag } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

const MARKER_PREFIX = 'dsh-plugin-control:'
const JS_EXPRESSION_TAG: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: value => value,
}

/** Values required to persist one configured logical control. */
export interface PersistedPluginControl {
  /** Stable marker written into YAML comments. */
  readonly id: string
  /** Loader entry ids receiving the same override. */
  readonly entryIds: readonly string[]
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

/**
 * Replace one control's managed id patches while preserving every unowned YAML
 * node, comment, and `!!js` expression in the profile layer.
 * @param filename - absolute profile `cordis.patch.yml` path.
 * @param control - logical identity and governed Loader entries.
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
    for (const entryId of control.entryIds) {
      const item = document.createNode({ id: entryId, disabled: !enabled })
      /* v8 ignore next -- createNode(object) is guaranteed to return a YAML map. */
      if (!isMap(item)) {
        throw new Error('plugin-control: YAML library did not create a map node')
      }
      item.commentBefore = ` ${MARKER_PREFIX} ${control.id}`
      // parseDocument narrows the sequence to range-bearing ParsedNode values,
      // while Document.createNode correctly returns a fresh pre-stringify node.
      items.push(item as never)
    }
    await writeFileAtomic(filename, document.toString({ lineWidth: 0 }), { mode: 0o600, dirMode: 0o700 })
  })
}
