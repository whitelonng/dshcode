/**
 * `node:stream/promises`: the promise pipeline helpers, taken from
 * readable-stream — the same maintained implementation that backs
 * `node:stream` here — so a pipeline mixes VFS file streams and
 * web-bridged readables on one stream instance set.
 * @module node:stream/promises (worker implementation)
 */
import Stream from 'readable-stream'

type NodeFace = typeof import('node:stream/promises')

/** The runtime face: readable-stream's promise helpers under Node's names. */
const { finished, pipeline } = (Stream as unknown as { promises: NodeFace }).promises

export { finished, pipeline }

/** CommonJS interop marker consumed by the worker module loader. */
export const __esModule = true

/** CommonJS-compatible namespace for default imports. */
export default { finished, pipeline } satisfies Partial<NodeFace>
