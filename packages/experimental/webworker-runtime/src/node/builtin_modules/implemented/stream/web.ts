/**
 * `node:stream/web`: the WHATWG stream interfaces Node re-exports here. The
 * worker platform exposes the same classes as globals, so this module
 * re-exports them: identity is the semantics, because stream code bridges a
 * fetch body through this module's `ReadableStream` into `Readable.fromWeb`.
 * @module node:stream/web (worker implementation)
 */

export const {
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  ReadableByteStreamController,
  ReadableStream,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableStreamDefaultController,
  ReadableStreamDefaultReader,
  TransformStream,
  TransformStreamDefaultController,
  WritableStream,
  WritableStreamDefaultController,
  WritableStreamDefaultWriter,
} = globalThis

/** CommonJS interop marker consumed by the worker module loader. */
export const __esModule = true

/** The `node:stream/web` declarations this module re-exports. */
type NodeFace = typeof import('node:stream/web')

/**
 * CommonJS-compatible namespace for default imports. The cast is nominal:
 * Node's declared classes and the platform globals describe the same
 * runtime objects through incompatible type declarations.
 */
export default {
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  ReadableByteStreamController,
  ReadableStream,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableStreamDefaultController,
  ReadableStreamDefaultReader,
  TransformStream,
  TransformStreamDefaultController,
  WritableStream,
  WritableStreamDefaultController,
  WritableStreamDefaultWriter,
} as unknown as Partial<NodeFace>
