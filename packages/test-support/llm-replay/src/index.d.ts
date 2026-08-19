/**
 * Keyless snapshot-test LLM replay. It derives one model-call script per
 * recorded session from `assistant/chunk` events and explicitly marked local
 * compaction calls, then binds fresh live sessions to parent/child scripts by
 * first-call order. Throw and hang cases require an explicit override because
 * a session log cannot reconstruct them alone.
 * @module @deepseek-ai/dsh-llm-replay
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { GenerateOptions, ModelModality, RetryPolicyConfig, StreamChunk } from '@deepseek-ai/dsh-llm';
/**
 * One recorded model call. `throw` may replay prefix chunks before failing;
 * `hang` models cancellation. Derived chunk entries come from ordinary model
 * streams and complete outputs of explicitly marked local compaction calls;
 * an override sidecar can supply any variant.
 */
export type ReplayEntry = {
    kind: 'chunks';
    chunks: StreamChunk[];
} | {
    kind: 'throw';
    chunks: StreamChunk[];
    message: string;
    code: string;
} | {
    kind: 'hang';
    /** Optional marker written after the prefix chunks are consumed and before the stream waits for cancellation. */
    readyFile?: string;
};
/** One model exposed by a replay-only provider catalog. */
export interface ReplayModelConfig {
    /** Model id used for replay requests. */
    id: string;
    /** Selector label; defaults to {@link id}. */
    name?: string;
    /** Optional selector description. */
    description?: string;
    /** Optional positive integer context capacity published by the replay adapter. */
    contextWindow?: number;
    /** Optional declared input modalities, so a scenario can exercise capability gates (e.g. image-capable `read_image`). */
    inputModalities?: readonly ModelModality[];
    /**
     * Optional per-request output cap the replay route materializes when callers
     * omit one, so replay reconstructs the request header a live catalog produced.
     */
    defaultMaxTokens?: number;
    /** Optional reasoning-effort ids the replay route accepts, in display order. */
    reasoningEfforts?: string[];
    /**
     * Optional effort materialized when callers omit one; must appear in
     * {@link reasoningEfforts} or call resolution rejects the route.
     */
    defaultReasoningEffort?: string;
}
/** One provider route exposed by the replay adapter. */
export interface ReplayProviderConfig {
    /** Provider route used for replay requests. */
    id: string;
    /** Selector label; defaults to {@link id}. */
    name?: string;
    /** Advisory models exposed to replay scenarios that exercise discovery. */
    models?: ReplayModelConfig[];
    /** Optional provider-owned retry policy used by assembled recovery snapshots. */
    retryPolicy?: RetryPolicyConfig;
}
/** Resolved plugin configuration. */
export interface ReplayConfig {
    /**
     * Path to the PRIMARY (parent) `session.jsonl` fixture. For a single-session
     * scenario this is the only log; for a nested-agent scenario it is the parent,
     * and the child logs ride in {@link childFiles}.
     */
    file: string;
    /**
     * Optional sidecar for the PRIMARY session: a bare `ReplayEntry[]` replaces
     * the derived script; `{ patches }` keeps it and swaps the named call
     * indexes ({@link ReplayOverrideDoc}). Used by single-session scenarios not
     * expressible as `assistant/chunk` (throw-before-chunk, cancel/hang,
     * injected transient failures). Absent for normal and nested scenarios.
     */
    overrideFile?: string;
    /**
     * Additional recorded child-session logs (a nested-agent scenario's subagent
     * sessions). Each is derived independently; the full set is ordered by
     * `createdAt` so the parent (earliest) binds to the first live session. Empty
     * for a single-session scenario.
     */
    childFiles?: string[];
    /**
     * Optional provider catalog. When non-empty, replay registers an adapter for
     * these routes; when absent or empty, it retains the catch-all waterfall used
     * by tests that do not need discovery.
     */
    providers?: ReplayProviderConfig[];
    /**
     * Optional per-chunk pacing delay in milliseconds: each replayed chunk waits
     * this long before yielding, so a downstream transport (e.g. the web SSE
     * mux observed by a browser) sees genuinely incremental delivery. A realism
     * knob only — correctness must never depend on it. Absent or `0` keeps
     * today's synchronous burst yield. Must be a non-negative finite integer;
     * aborting mid-wait cancels the stream like any other abort.
     */
    paceMs?: number;
}
/**
 * Handle returned by {@link installLlmReplay}: removal plus the end-of-run
 * consumption check that turns silent fixture underruns (a scenario that
 * issued fewer calls than recorded, or never bound a recorded child script)
 * into a crisp diagnostic at teardown.
 */
export interface ReplayHandle {
    /** Remove the registered adapter or waterfall listener (HMR safety). Freestanding closure — safe to destructure. */
    dispose(this: void): void;
    /**
     * Throw unless every recorded script was bound to a live session and every
     * bound cursor consumed its full entry list. Call at scenario teardown.
     * Freestanding closure — safe to destructure.
     */
    assertConsumed(this: void): void;
}
/**
 * Recorded calls plus header facts used to order parent and child scripts.
 * Recorded ids are diagnostic; fresh live ids bind by ordered first use.
 */
export interface SessionScript {
    /** The recorded session id (diagnostics only — the live id differs). */
    recordedId: string;
    /** Session creation time; the deterministic ordering key (parent < child). */
    createdAt: number;
    /** The per-`stream()`-call replay entries, in recorded call order. */
    entries: ReplayEntry[];
    /**
     * Whether this is the PRIMARY (parent) session. Breaks a `createdAt` tie in
     * favor of the parent, which always issues the first model call.
     */
    primary: boolean;
}
/**
 * Parse a session `.jsonl` buffer into its event list. Line 0 is the session
 * header (a `{type:'session',…}` record), every subsequent non-empty line is a
 * {@link SessionEvent} or a packed chunk row (expanded back into its events, so
 * a fixture recorded with `packChunks` on derives the same script). The header
 * is skipped; malformed lines fail loud.
 * @param text - the raw `.jsonl` file contents.
 * @returns every event after the header, in log order.
 */
export declare function parseSessionLog(text: string): SessionEvent[];
/**
 * Read replay identity, ordering, and fork-seed facts from the JSONL header.
 *
 * @param text - the raw `.jsonl` file contents (only the header line is read).
 * @returns the header's `id`, `createdAt`, and `seedLength`, defaulted when absent.
 */
export declare function parseSessionHeader(text: string): {
    id: string;
    createdAt: number;
    seedLength: number;
};
/**
 * Reconstruct the per-`stream()` replay script from a recorded session log.
 *
 * Splits `assistant/chunk` events at every `finish`, using turn and step changes
 * to detect an unterminated prior call. A `compaction/summary` explicitly marked
 * as one local LLM-stream call becomes a canonical successful stream from its
 * complete `rawOutput` at the summary's log position. A
 * missing assistant terminator means the live stream threw, so derivation
 * rejects and the scenario must provide an explicit override. Multiple calls
 * may share one turn and step when the loop retries.
 * @param events - the recorded session's events.
 * @returns one `chunks` entry per recorded model call, in call order.
 */
export declare function deriveReplayScript(events: SessionEvent[]): ReplayEntry[];
/**
 * One positional patch in an augmentation sidecar: replaces the derived
 * entry at call index `at` (0-based) with `entry`, or appends when `at`
 * equals the derived length (an extra recorded-after-the-fact call, e.g. the
 * retry attempt following an injected transient throw).
 */
export interface ReplayOverridePatch {
    /** 0-based call index into the derived script; == length appends. */
    at: number;
    /** The replacement (or appended) entry at that call position. */
    entry: ReplayEntry;
}
/**
 * Override sidecar document: either a whole-script replacement (a
 * bare `ReplayEntry[]`) or the augmentation form `{ patches }`, which keeps
 * the JSONL-derived script and swaps only the named call indexes — the shape
 * for "turn N errors, everything else replays as recorded".
 */
export type ReplayOverrideDoc = ReplayEntry[] | {
    patches: ReplayOverridePatch[];
};
/**
 * Resolve every `{{fromRequest:<regex>}}` placeholder in one scripted entry
 * against the live request. The corpus is every string leaf of the request
 * messages joined by newlines; the pattern's LAST corpus match wins and its
 * first capture group (or, without one, the whole match) substitutes in place.
 * Scenario sidecars use this to script arguments no static file can know,
 * such as a randomly minted goal id the model must echo back. A pattern that
 * matches nothing, an invalid pattern, and an unterminated placeholder each
 * fail loud. The last two braces of a consecutive `}` run terminate the
 * placeholder, so a pattern may end with a brace quantifier but cannot
 * contain `}}` followed by further pattern content. Derived entries pass
 * through the same resolution as sidecar entries.
 * @param entry - the scripted entry about to replay.
 * @param messages - the live request messages searched by the placeholders.
 * @returns the entry itself when no placeholder appears, else a resolved deep copy.
 */
export declare function resolveScriptedEntry(entry: ReplayEntry, messages: GenerateOptions['messages']): ReplayEntry;
/**
 * Load the PRIMARY session's replay script: the sidecar override when present
 * (whole-script replacement or `{ patches }` augmentation over the derived
 * script), else the script derived from the session JSONL (fail-loud when the
 * fixture is missing).
 * @param config - the fixture paths; only `file` and `overrideFile` are consulted.
 * @returns the resolved primary-session script.
 */
export declare function loadReplayScript(config: ReplayConfig): ReplayEntry[];
/**
 * Load the primary and child scripts in bind order. Child derivation begins at
 * `seedLength` so inherited parent chunks are never replayed as child calls.
 *
 * @param config - the fixture paths: the primary log plus any recorded child logs.
 * @returns the primary script first, then the child scripts in bind order.
 */
export declare function loadSessionScripts(config: ReplayConfig): SessionScript[];
/**
 * Install per-session positional replay. A newly seen live session takes the
 * next ordered recorded script, then advances its own cursor synchronously at
 * invocation time; calls without `sessionId` share one anonymous session. A
 * non-empty provider catalog registers a routed replay adapter; otherwise a
 * catch-all waterfall intercepts requests.
 *
 * @param ctx - the context whose LLM service receives the replay route or waterfall.
 * @param config - the resolved fixture paths (env-var defaulting is `apply`'s job).
 * @returns the {@link ReplayHandle} carrying the disposer and the teardown consumption check.
 */
export declare function installLlmReplay(ctx: Context, config: ReplayConfig): ReplayHandle;
export declare const name = "llm-replay";
export declare const inject: string[];
/** Plugin config: the {@link ReplayConfig} inputs, each defaulting to its `DSH_SNAPSHOT_*` env var in `apply`. */
export interface Config {
    /** Override the fixture path; defaults to `$DSH_SNAPSHOT_FILE`. */
    file?: string;
    /** Override the sidecar path; defaults to `$DSH_SNAPSHOT_OVERRIDE`. */
    overrideFile?: string;
    /**
     * Override the child-log paths; defaults to `$DSH_SNAPSHOT_CHILD_FILES` (a
     * path-separator-delimited list). Each is a recorded subagent session log for
     * a nested-agent scenario; absent/empty for a single-session scenario.
     */
    childFiles?: string[];
    /** Optional replay-only provider catalog; absent or empty selects catch-all waterfall replay. */
    providers?: ReplayProviderConfig[];
    /** Optional per-chunk pacing delay in ms (see {@link ReplayConfig.paceMs}); absent keeps burst yield. */
    paceMs?: number;
}
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map