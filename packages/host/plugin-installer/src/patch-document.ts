/** Low-level profile patch-file access shared by the patch-row owners. */

import { readFile } from 'node:fs/promises'
import { isSeq, parseDocument, type Document, type ScalarTag, type YAMLSeq } from 'yaml'

/** YAML `!!js` expression tag: expressions stay literal until the Loader evaluates them. */
export const JS_EXPRESSION_TAG: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve: value => value,
}

/** Whether an unknown filesystem failure reports a missing file. */
export function isMissing(error: unknown): boolean {
  /* v8 ignore next -- node:fs promise rejections are ErrnoException objects, never null or undefined. */
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** A parsed patch file: the yaml document and its top-level sequence. */
export interface PatchDocument {
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
export function openPatchDocument(text: string, filename: string, action: 'read' | 'update'): PatchDocument {
  const document = parseDocument(text, {
    customTags: [JS_EXPRESSION_TAG],
    prettyErrors: true,
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    const firstError = document.errors[0]
    /* v8 ignore next 3 -- a non-empty errors array always has a first element */
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

/** Read one patch file, treating a missing file as an empty layer. */
export async function readPatchFile(filename: string): Promise<string> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error: unknown) {
    if (!isMissing(error)) throw error
    return '[]\n'
  }
}

/** Push an item into the root sequence (yaml's seq items are a plain array). */
export function pushItem(root: YAMLSeq, item: unknown): void {
  root.items.push(item)
}
