/**
 * Node-private synchronous Zstandard frame decoder optimization.
 * @module dsh-session-persistence-jsonl/zstd-private-decoder
 */
import { constants as bufferConstants } from 'node:buffer';
import { createZstdDecompress } from 'node:zlib';
const DECODE_CHUNK_SIZE = 1024 * 1024;
/** Return the stream with its observed private Node contract, or reject that optimization. */
function privateZstdStream(stream) {
    const candidate = stream;
    const handle = candidate._handle;
    const errorKey = Reflect.ownKeys(stream).find((key) => (typeof key === 'symbol' && key.description === 'kError'));
    /* v8 ignore next -- one test runtime exposes one Node-private shape; the Node 22/24/26 matrix checks compatibility. */
    if (typeof handle !== 'object' || handle === null
        || typeof handle.writeSync !== 'function'
        || !(candidate._writeState instanceof Uint32Array)
        || candidate._writeState.length < 2
        || typeof candidate._defaultFlushFlag !== 'number'
        || errorKey === undefined
        || candidate[errorKey] !== null)
        return undefined;
    return { stream: stream, errorKey };
}
/**
 * Synchronous multi-frame decoder backed by one Node Zstd stream handle. Node
 * exposes synchronous decoding only as a one-shot API, so this adapter uses
 * the stream's private handle contract to reuse its native context and output
 * chunks across frames.
 */
export class NodePrivateZstdFrameDecoder {
    stream;
    errorKey;
    output = Buffer.allocUnsafe(DECODE_CHUNK_SIZE);
    decoderError;
    started = false;
    closed = false;
    constructor(stream, errorKey) {
        this.stream = stream;
        this.errorKey = errorKey;
        this.stream.on('error', (error) => {
            this.decoderError ??= error;
        });
    }
    /**
     * Create the optimized decoder when this Node release exposes the expected
     * private stream shape.
     * @returns a shared decoder, or `undefined` when callers must use the public fallback.
     */
    static create() {
        const stream = createZstdDecompress({ chunkSize: DECODE_CHUNK_SIZE });
        const privateAccess = privateZstdStream(stream);
        /* v8 ignore next -- reached only when a supported Node release changes its private stream shape. */
        if (privateAccess !== undefined) {
            return new NodePrivateZstdFrameDecoder(privateAccess.stream, privateAccess.errorKey);
        }
        /* v8 ignore next -- the active Node runtime passed the private-shape probe above. */
        stream.close();
        /* v8 ignore next -- the active Node runtime passed the private-shape probe above. */
        return undefined;
    }
    /** @inheritdoc */
    *decode(source, frames) {
        if (this.started)
            throw new Error('Zstandard frame decoder was already started');
        if (this.closed)
            throw new Error('cannot start a closed Zstandard frame decoder');
        this.started = true;
        try {
            for (const frame of frames) {
                try {
                    yield this.decodeFrame(source.subarray(frame.start, frame.end));
                }
                catch (error) {
                    throw new Error(`corrupt Zstandard session log: frame at byte ${frame.start} failed validation`, {
                        cause: error,
                    });
                }
            }
        }
        finally {
            this.close();
        }
    }
    /** Decode one frame; its returned scratch view remains valid until the next call. */
    decodeFrame(input) {
        const handle = this.stream._handle;
        /* v8 ignore next -- decode() rejects closed instances before entering this private frame operation. */
        if (this.closed || handle === null)
            throw new Error('cannot decode with a closed Zstandard frame decoder');
        let inputOffset = 0;
        let inputRemaining = input.length;
        let outputBytes = 0;
        const fullChunks = [];
        for (;;) {
            handle.writeSync(this.stream._defaultFlushFlag, input, inputOffset, inputRemaining, this.output, 0, this.output.length);
            if (this.decoderError !== undefined)
                throw this.decoderError;
            const internalError = this.stream[this.errorKey];
            if (internalError !== null) {
                if (internalError instanceof Error)
                    throw internalError;
                throw new Error('Zstandard decoder exposed a non-Error internal failure');
            }
            const outputAfter = this.stream._writeState[0];
            const inputAfter = this.stream._writeState[1];
            const consumed = inputRemaining - inputAfter;
            const produced = this.output.length - outputAfter;
            if (produced > 0) {
                outputBytes += produced;
                /* v8 ignore next -- Buffer cannot materialize a frame beyond its own process-wide maximum length. */
                if (outputBytes > bufferConstants.MAX_LENGTH) {
                    throw new Error(`Zstandard frame output exceeds ${bufferConstants.MAX_LENGTH} bytes`);
                }
            }
            if (outputAfter !== 0) {
                /* v8 ignore next -- structurally scanned ranges contain exactly one complete frame and no trailing bytes. */
                if (inputAfter !== 0)
                    throw new Error('Zstandard frame decoder left trailing input');
                const finalChunk = this.output.subarray(0, produced);
                if (fullChunks.length === 0)
                    return finalChunk;
                if (produced > 0)
                    fullChunks.push(Buffer.from(finalChunk));
                const onlyChunk = fullChunks[0];
                return fullChunks.length === 1
                    ? onlyChunk
                    : Buffer.concat(fullChunks, outputBytes);
            }
            fullChunks.push(Buffer.from(this.output));
            inputOffset += consumed;
            inputRemaining = inputAfter;
        }
    }
    /** @inheritdoc */
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.stream.close();
    }
}
//# sourceMappingURL=zstd-private-decoder.js.map