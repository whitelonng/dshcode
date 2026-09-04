/**
 * `node:string_decoder`: incremental byte-to-string decoding over the
 * platform's `TextDecoder` — the same construction Node itself uses for the
 * utf-8, utf-16le, and latin1 faces, with the partial-sequence buffering
 * `TextDecoder`'s `{ stream: true }` decoding provides.
 * @module node:string_decoder (worker implementation)
 */

/** Node's encoding labels that this decoder answers, mapped to TextDecoder labels. */
const ENCODINGS: Record<string, string> = {
  ascii: 'latin1', // Node's normalizeEncoding maps ascii to latin1.
  binary: 'latin1',
  latin1: 'latin1',
  ucs2: 'utf-16le',
  'ucs-2': 'utf-16le',
  utf16le: 'utf-16le',
  'utf-16le': 'utf-16le',
  utf8: 'utf-8',
  'utf-8': 'utf-8',
}

/**
 * Decode one byte stream into strings without splitting multi-byte
 * sequences, exactly the contract `tar`'s header parsing and stream
 * plumbing depend on.
 */
export class StringDecoder {
  #decoder: TextDecoder

  constructor(encoding?: string) {
    const label = ENCODINGS[(encoding ?? 'utf8').toLowerCase()]
    if (label === undefined) {
      throw new Error(
        `Unknown encoding: ${String(encoding)}. The worker decoder supports `
        + 'utf8, utf16le, ucs2, latin1, binary, and ascii.',
      )
    }
    this.#decoder = new TextDecoder(label)
  }

  /**
   * Decode the next chunk, holding back any partial sequence tail.
   * @param buffer - the next bytes of the stream.
   * @returns the decoded text, including any tail completed by this chunk.
   */
  write(buffer: Uint8Array): string {
    return this.#decoder.decode(buffer, { stream: true })
  }

  /**
   * Decode an optional final chunk and flush the held-back tail; an
   * incomplete trailing sequence ends as U+FFFD, as Node's decoder does.
   * @param buffer - an optional final chunk to decode before the flush.
   * @returns the flushed text.
   */
  end(buffer?: Uint8Array): string {
    return (buffer === undefined ? '' : this.#decoder.decode(buffer, { stream: true })) + this.#decoder.decode()
  }
}

/** CommonJS interop marker consumed by the worker module loader. */
export const __esModule = true

/** The `node:string_decoder` declarations this module stands in for. */
type NodeFace = typeof import('node:string_decoder')

/** CommonJS-compatible namespace for default imports. */
export default { StringDecoder } satisfies Partial<NodeFace>
