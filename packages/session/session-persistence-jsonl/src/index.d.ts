/**
 * JSONL durable session-persistence backend. It stores a header and contiguous
 * events in one append-only file per session, and delegates orchestration to
 * {@link PersistenceCoordinator}. Its side-effect-free locator returns the
 * absolute per-session log target before materialization.
 * @module @deepseek-ai/dsh-session-persistence-jsonl
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { SessionPersistence, type PersistenceBackend, type SessionLocation, type SessionPersistenceSnapshot, type SessionInspection, type SessionPersistenceRevision as PersistenceRevision, type SessionRawArtifact, type StoredPrefix } from '@deepseek-ai/dsh-session-persistence';
import type { SessionEvent, SessionId, SessionHeader, SessionPreparation } from '@deepseek-ai/dsh-session';
import { type JsonlCompression } from './format.ts';
export type { JsonlCompression } from './format.ts';
/** Loader schema for the JSONL artifact's physical encoding. */
export declare const JsonlCompressionSchema: z<JsonlCompression>;
/** Plugin config: where the JSONL backend keeps its session logs, and the packed-row write switch. */
export interface Config {
    /**
     * Root directory for all session files. Required (no default): a default of
     * `process.cwd()` would scatter session files as the process's cwd changes
     * (bash calls, subprocesses). Sessions group under human-readable project
     * directories, then per-session directories. An existing root must be a
     * readable directory; an absent root is created on first materialization.
     */
    root: string;
    /**
     * Write runs of consecutive `assistant/chunk` delta events as packed
     * `text-chunks`/`reasoning-chunks`/`tool-call-chunks` rows (lossless,
     * ~60% smaller logs measured on a real session). Defaults to true; false
     * keeps one `SessionEvent` per line for diagnostics. Reading packed rows is
     * unconditional: a log's layout never depends on this switch.
     */
    packChunks?: boolean;
    /** Physical encoding; defaults to checksummed Zstandard frames. */
    compression?: JsonlCompression;
    /** Maximum cold Session preparations retained for history-to-resume reuse. */
    preparedSessionCacheSize?: number;
    /** Fixed live-event coalescing window; not a backend completion deadline. */
    writeBatchMaxDelayMs?: number;
}
/** Opaque coordinator token for replacing bytes recovered from a torn frame. */
interface JsonlTornMarker {
    truncateTo: number;
    recoveredEvents: SessionEvent[];
}
/**
 * The JSONL persistence backend. Load as a plugin; it registers as
 * `ctx.sessionPersistence` and (via the coordinator) installs the write-path
 * listeners. Its torn-tail marker carries the byte offset and any events
 * recovered from an incomplete final Zstandard frame.
 */
export declare class JsonlSessionPersistence extends SessionPersistence implements PersistenceBackend<JsonlTornMarker> {
    config: Config;
    readonly supportsRawArtifacts = true;
    static inject: string[];
    static Config: z<Config>;
    /**
     * Backend label for coordinator diagnostics and effects. It shadows
     * `Service.name` without changing the service key captured by the base
     * constructor.
     */
    readonly name = "session-persistence-jsonl";
    private root;
    private packChunks;
    private compression;
    private coordinator;
    private rootEncodingCheck;
    constructor(ctx: Context, config: Config);
    /** Resolve the absolute target path without touching the filesystem. */
    locate(meta: SessionHeader): SessionLocation;
    create(meta: SessionHeader): Promise<void>;
    append(id: SessionId, events: readonly SessionEvent[]): Promise<void>;
    delete(id: SessionId): Promise<void>;
    prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>;
    load(id: SessionId): Promise<SessionInspection>;
    inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>;
    readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{
        meta: SessionHeader;
        events: SessionEvent[];
    }>;
    /** Read a stored prefix by id across all project directories when cwd is unknown. */
    loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix<JsonlTornMarker> | undefined>;
    /**
     * Read one log's stat-derived revision without loading its event bytes.
     * Resolving an id with unknown cwd still scans the project directories.
     */
    readStoredRevision(id: SessionId, signal?: AbortSignal): Promise<PersistenceRevision | undefined>;
    /**
     * Durably delete one stored log: remove the per-session directory (the log
     * file and any sibling metadata) under its project directory. The deletion
     * is visible to the next {@link list} walk, so search indexes reconcile the
     * removal. A session with no artifact resolves `false` without touching
     * anything.
     */
    deleteStored(id: SessionId, signal?: AbortSignal): Promise<boolean>;
    /**
     * Read a session's stored artifact text verbatim: the durable file bytes
     * decoded from this backend's physical encoding (complete zstd frames
     * concatenated, or UTF-8 plaintext). The content is the exact JSONL text the
     * backend wrote — never a reconstruction from parsed events — so packed-
     * chunk rows, key order, and line breaks survive byte-for-byte. A torn
     * final frame is omitted, matching the committed-prefix semantics of every
     * other read.
     * @param id - the persisted session to read.
     * @param signal - optional cancellation for the stat/read/decode work.
     * @returns the raw artifact text plus the header parsed from its own first
     * line, or `undefined` when the session has no stored artifact.
     */
    readRaw(id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined>;
    /**
     * Read a file's bytes under a revision-stable loop: a writer appending
     * between stat and readFile would yield a torn physical file, so retry
     * while the stat revision changes.
     * @param path - the artifact file to read.
     * @param signal - optional cancellation for the stat/read work.
     * @returns the stable bytes and the revision that matched both stats.
     */
    private readStableFile;
    /**
     * Read a stored prefix and convert torn-tail state to the opaque marker the
     * coordinator can round-trip without knowing the physical encoding.
     */
    private readPrefix;
    /** Decode complete frames and retain complete JSONL records from a torn final frame. */
    private readZstdPrefix;
    /** Durably append a batch, lazily materializing the file when not yet present. */
    appendBatch(meta: SessionHeader, events: readonly SessionEvent[], isMaterialized: boolean): Promise<void>;
    /**
     * Make a crash repair durable: truncate a torn tail, restore complete events
     * decoded from it, then append synthetic closers. Two fsync'd steps — the seam
     * does not require this to be atomic.
     */
    commitRepair(meta: SessionHeader, tornMarker: JsonlTornMarker | undefined, closers: readonly SessionEvent[]): Promise<void>;
    /** List valid unique stored sessions' metadata (header line only — no full-log parse). */
    list(signal?: AbortSignal): Promise<SessionHeader[]>;
    /** List metadata plus a stat-derived identity for each append-only log. */
    listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>;
    private listArtifacts;
    /** Atomically write the header line + first batch (temp-write, fsync, publish). */
    private materialize;
    private materializePosix;
    private materializeWin32;
    private rejectExistingLog;
    private writeSyncedTempFile;
    /** Encode the header and first batch without combining their frame boundaries. */
    private encodeMaterialization;
    /** Encode one durable append batch in the configured physical representation. */
    private encodeEventBatch;
    /** fsync a POSIX directory so a just-created/renamed entry is crash-durable. */
    private syncDirPosix;
    /**
     * Append and fsync event lines. On a partial write or sync failure, restore the
     * previous size before rethrowing because the unchanged cursor will retry the
     * batch; leaving partial bytes would create duplicate sequence numbers.
     */
    private appendLines;
    private rollbackAppend;
    /** Truncate the log file to `offset` bytes and fsync (discard the crash tail). */
    private repair;
    /**
     * Read the first newline-terminated line of a file without loading the whole
     * file. Returns undefined if the file is empty or has no complete first line.
     * Reads in bounded chunks so a huge log costs only the header read.
     */
    private readFirstLine;
    /** Read and validate only the independently compressed header frame. */
    private readFirstZstdLine;
    /** Find the unique physical log for an id across every project directory. */
    private findLog;
    /** Require an existing configured root to be a readable directory. */
    private assertUsableRoot;
    /** Reject metadata that does not identify the selected physical log. */
    private assertStoredIdentity;
    /**
     * Whether two path spellings resolve to the same physical file. This admits
     * case aliases on case-insensitive filesystems without weakening identity
     * checks on case-sensitive stores.
     */
    private sameFile;
    /** The human-readable project directories under the configured root. */
    private listProjectDirs;
    /** List session-owned directories and reject the obsolete flat-file layout. */
    private listSessionDirs;
    /** Reject a root that already belongs to the other physical encoding. */
    private ensureRootEncoding;
    private checkRootEncoding;
    private rejectLegacyFlatArtifact;
    private rejectOppositeArtifact;
    private oppositeCompression;
    private encodingMismatch;
    private legacyLayout;
    private exists;
    private assertLogParentAllowsAbsence;
}
export default JsonlSessionPersistence;
//# sourceMappingURL=index.d.ts.map