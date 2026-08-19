/**
 * Keyless snapshot-test LLM replay. It derives one model-call script per
 * recorded session from `assistant/chunk` events and explicitly marked local
 * compaction calls, then binds fresh live sessions to parent/child scripts by
 * first-call order. Throw and hang cases require an explicit override because
 * a session log cannot reconstruct them alone.
 * @module @deepseek-ai/dsh-llm-replay
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter as pathDelimiter } from 'node:path';
import { decodeStorageRecord } from '@deepseek-ai/dsh-session';
import { LlmAdapter, LlmError, ReasoningEffortId, assertNever, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
/**
 * Parse a session `.jsonl` buffer into its event list. Line 0 is the session
 * header (a `{type:'session',…}` record), every subsequent non-empty line is a
 * {@link SessionEvent} or a packed chunk row (expanded back into its events, so
 * a fixture recorded with `packChunks` on derives the same script). The header
 * is skipped; malformed lines fail loud.
 * @param text - the raw `.jsonl` file contents.
 * @returns every event after the header, in log order.
 */
export function parseSessionLog(text) {
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    const events = [];
    // The JSONL backend guarantees line 0 is the session header.
    for (let i = 1; i < lines.length; i++) {
        events.push(...decodeStorageRecord(JSON.parse(lines[i])));
    }
    return events;
}
/**
 * Read replay identity, ordering, and fork-seed facts from the JSONL header.
 *
 * @param text - the raw `.jsonl` file contents (only the header line is read).
 * @returns the header's `id`, `createdAt`, and `seedLength`, defaulted when absent.
 */
export function parseSessionHeader(text) {
    const firstLine = text.split('\n').find(line => line.trim().length > 0) ?? '{}';
    const parsed = JSON.parse(firstLine);
    return {
        id: typeof parsed.id === 'string' ? parsed.id : '',
        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
        seedLength: typeof parsed.seedLength === 'number' ? parsed.seedLength : 0,
    };
}
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
export function deriveReplayScript(events) {
    const script = [];
    let currentKey;
    let current = [];
    const close = (key, chunks) => {
        if (chunks.length === 0)
            return;
        if (chunks[chunks.length - 1]?.type !== 'finish') {
            throw new Error(`llm-replay: model call ${key} ended without a finish chunk (a thrown stream); `
                + 'this scenario needs a replay.override.json sidecar');
        }
        script.push({ kind: 'chunks', chunks });
    };
    for (const event of events) {
        if (event.type === 'compaction/summary') {
            close(currentKey, current);
            currentKey = undefined;
            current = [];
            // JSONL decoding crosses an untyped durable boundary, so retain its wider
            // shape even though current in-process producers enforce this correlation.
            const persisted = event.data;
            if (persisted.llmStreamCall === true) {
                if (persisted.rawOutput === undefined) {
                    throw new Error('llm-replay: compaction/summary marks an LLM stream call without rawOutput');
                }
                const chunks = [];
                for (const [index, block] of persisted.rawOutput.entries()) {
                    chunks.push({ type: 'block-start', index, blockType: block.type });
                    chunks.push({ type: 'block-end', index, block });
                }
                if (persisted.usage !== undefined)
                    chunks.push({ type: 'usage', usage: persisted.usage });
                chunks.push({ type: 'finish', reason: { kind: 'stop' } });
                script.push({ kind: 'chunks', chunks });
            }
            continue;
        }
        if (event.type !== 'assistant/chunk')
            continue;
        const { turn, step, chunk } = event.data;
        const key = `${turn}/${step}`;
        if (current.length > 0 && key !== currentKey) {
            close(currentKey, current);
        }
        if (current.length === 0)
            currentKey = key;
        current.push(chunk);
        if (chunk.type === 'finish') {
            close(currentKey, current);
            currentKey = undefined;
            current = [];
        }
    }
    close(currentKey, current);
    return script;
}
const REPLAY_CHUNK_TYPES = new Set([
    'block-start',
    'text-delta',
    'reasoning-delta',
    'tool-call-delta',
    'block-end',
    'usage',
    'finish',
]);
const FROM_REQUEST_OPEN = '{{fromRequest:';
const FROM_REQUEST_CLOSE = '}}';
/** Collect every string leaf of one JSON-compatible value, in traversal order. */
function collectStrings(value, out) {
    if (typeof value === 'string') {
        out.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            collectStrings(item, out);
        return;
    }
    if (value !== null && typeof value === 'object') {
        for (const item of Object.values(value))
            collectStrings(item, out);
    }
}
/** Resolve one placeholder pattern against the request corpus; the LAST match wins. */
function resolveFromRequest(pattern, corpus) {
    let regex;
    try {
        regex = new RegExp(pattern, 'g');
    }
    catch (error) {
        // RegExp construction only throws SyntaxError; String() carries its message.
        throw new Error(`llm-replay: fromRequest has an invalid pattern ${JSON.stringify(pattern)}: ${String(error)}`);
    }
    let last;
    for (const match of corpus.matchAll(regex))
        last = match;
    if (last === undefined) {
        throw new Error(`llm-replay: fromRequest pattern ${JSON.stringify(pattern)} matched nothing in the request`);
    }
    return last[1] ?? last[0];
}
/** Replace every `{{fromRequest:<pattern>}}` occurrence in one scripted string. */
function substituteString(text, corpus) {
    let result = '';
    let cursor = 0;
    while (true) {
        const open = text.indexOf(FROM_REQUEST_OPEN, cursor);
        if (open === -1)
            return result + text.slice(cursor);
        let close = text.indexOf(FROM_REQUEST_CLOSE, open + FROM_REQUEST_OPEN.length);
        if (close === -1) {
            throw new Error(`llm-replay: fromRequest placeholder is unterminated in ${JSON.stringify(text)}`);
        }
        // The last two braces of a consecutive `}` run terminate the placeholder,
        // so a pattern may end with a brace quantifier like `[0-9a-f]{4}`.
        while (text[close + FROM_REQUEST_CLOSE.length] === '}')
            close += 1;
        const pattern = text.slice(open + FROM_REQUEST_OPEN.length, close);
        result += text.slice(cursor, open) + resolveFromRequest(pattern, corpus);
        cursor = close + FROM_REQUEST_CLOSE.length;
    }
}
/** Deep-copy one JSON-compatible value with scripted placeholders resolved. */
function substituteValue(value, corpus) {
    if (typeof value === 'string') {
        return value.includes(FROM_REQUEST_OPEN) ? substituteString(value, corpus) : value;
    }
    if (Array.isArray(value))
        return value.map(item => substituteValue(item, corpus));
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteValue(item, corpus)]));
    }
    return value;
}
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
export function resolveScriptedEntry(entry, messages) {
    if (!JSON.stringify(entry).includes(FROM_REQUEST_OPEN))
        return entry;
    const leaves = [];
    collectStrings(messages, leaves);
    return substituteValue(entry, leaves.join('\n'));
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasExactKeys(value, keys) {
    return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function invalidOverride(file, location, detail) {
    throw new Error(`llm-replay: invalid override ${file}: ${location} ${detail}`);
}
function readChunks(value, file, location) {
    if (!Array.isArray(value))
        invalidOverride(file, location, 'chunks must be an array');
    for (const [index, chunk] of value.entries()) {
        if (!isRecord(chunk)
            || typeof chunk['type'] !== 'string'
            || !REPLAY_CHUNK_TYPES.has(chunk['type'])) {
            invalidOverride(file, `${location}.chunks[${index}]`, 'must have a known StreamChunk type');
        }
    }
    return value;
}
function readReplayEntry(value, file, location) {
    if (!isRecord(value))
        invalidOverride(file, location, 'must be an object');
    switch (value['kind']) {
        case 'chunks': {
            if (!hasExactKeys(value, ['kind', 'chunks']))
                invalidOverride(file, location, 'has invalid chunks-entry fields');
            return { kind: 'chunks', chunks: readChunks(value['chunks'], file, location) };
        }
        case 'throw': {
            if (!hasExactKeys(value, ['kind', 'chunks', 'message', 'code'])) {
                invalidOverride(file, location, 'has invalid throw-entry fields');
            }
            if (typeof value['message'] !== 'string' || value['message'].length === 0) {
                invalidOverride(file, location, 'message must be a non-empty string');
            }
            if (typeof value['code'] !== 'string' || value['code'].length === 0) {
                invalidOverride(file, location, 'code must be a non-empty string');
            }
            return {
                kind: 'throw',
                chunks: readChunks(value['chunks'], file, location),
                message: value['message'],
                code: value['code'],
            };
        }
        case 'hang': {
            const readyFile = value['readyFile'];
            const keys = readyFile === undefined ? ['kind'] : ['kind', 'readyFile'];
            if (!hasExactKeys(value, keys))
                invalidOverride(file, location, 'has invalid hang-entry fields');
            if (readyFile !== undefined && (typeof readyFile !== 'string' || readyFile.length === 0)) {
                invalidOverride(file, location, 'readyFile must be a non-empty string');
            }
            return { kind: 'hang', ...(readyFile === undefined ? {} : { readyFile }) };
        }
        default:
            return invalidOverride(file, location, `has unknown kind ${JSON.stringify(value['kind'])}`);
    }
}
function readOverrideDoc(value, file) {
    if (Array.isArray(value))
        return value.map((entry, index) => readReplayEntry(entry, file, `entry ${index}`));
    if (!isRecord(value) || !hasExactKeys(value, ['patches']) || !Array.isArray(value['patches'])) {
        return invalidOverride(file, 'document', 'must be a ReplayEntry[] or { patches: [...] }');
    }
    return {
        patches: value['patches'].map((value, index) => {
            const location = `patch ${index}`;
            if (!isRecord(value) || !hasExactKeys(value, ['at', 'entry'])) {
                return invalidOverride(file, location, 'must contain exactly at and entry');
            }
            const at = value['at'];
            if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) {
                return invalidOverride(file, location, 'at must be a non-negative safe integer');
            }
            return { at, entry: readReplayEntry(value['entry'], file, `${location}.entry`) };
        }),
    };
}
/**
 * Load the PRIMARY session's replay script: the sidecar override when present
 * (whole-script replacement or `{ patches }` augmentation over the derived
 * script), else the script derived from the session JSONL (fail-loud when the
 * fixture is missing).
 * @param config - the fixture paths; only `file` and `overrideFile` are consulted.
 * @returns the resolved primary-session script.
 */
export function loadReplayScript(config) {
    if (config.overrideFile !== undefined && existsSync(config.overrideFile)) {
        const doc = readOverrideDoc(JSON.parse(readFileSync(config.overrideFile, 'utf8')), config.overrideFile);
        if (Array.isArray(doc))
            return doc;
        const script = deriveScriptFromFile(config.file);
        const derivedLength = script.length;
        const seenIndexes = new Set();
        for (const patch of doc.patches) {
            if (patch.at > derivedLength) {
                throw new Error(`llm-replay: override patch index ${String(patch.at)} out of range `
                    + `(derived script has ${derivedLength} call(s); == length appends): ${config.overrideFile}`);
            }
            if (seenIndexes.has(patch.at)) {
                throw new Error(`llm-replay: duplicate override patch index ${patch.at}: ${config.overrideFile}`);
            }
            seenIndexes.add(patch.at);
            script[patch.at] = patch.entry;
        }
        return script;
    }
    return deriveScriptFromFile(config.file);
}
/** Derive the primary script from the session JSONL, failing loud on a missing fixture. */
function deriveScriptFromFile(file) {
    if (!existsSync(file)) {
        throw new Error(`llm-replay: fixture not found: ${file} — run \`pnpm run test:snapshot:record\` first`);
    }
    return deriveReplayScript(parseSessionLog(readFileSync(file, 'utf8')));
}
/**
 * Load the primary and child scripts in bind order. Child derivation begins at
 * `seedLength` so inherited parent chunks are never replayed as child calls.
 *
 * @param config - the fixture paths: the primary log plus any recorded child logs.
 * @returns the primary script first, then the child scripts in bind order.
 */
export function loadSessionScripts(config) {
    const primaryEntries = loadReplayScript(config);
    // The override path replaces the derived script but carries no header; read
    // the header off the JSONL when it exists, else use a stable default so an
    // override-only fixture (header-less) still orders first as the primary.
    const primaryHeader = existsSync(config.file)
        ? parseSessionHeader(readFileSync(config.file, 'utf8'))
        : { id: '', createdAt: 0 };
    const primary = {
        recordedId: primaryHeader.id, createdAt: primaryHeader.createdAt, entries: primaryEntries, primary: true,
    };
    const children = [];
    for (const childFile of config.childFiles ?? []) {
        if (!existsSync(childFile)) {
            throw new Error(`llm-replay: child fixture not found: ${childFile} — re-record the scenario`);
        }
        const text = readFileSync(childFile, 'utf8');
        const header = parseSessionHeader(text);
        // Derive the child's script from its own events only — events AT OR after the seed
        // boundary.
        const ownEvents = parseSessionLog(text).slice(header.seedLength);
        children.push({
            recordedId: header.id,
            createdAt: header.createdAt,
            entries: deriveReplayScript(ownEvents),
            primary: false,
        });
    }
    // Synchronous children start in creation order; the id only stabilizes timestamp ties.
    // XXX(concurrent-subagents): concurrent children need an explicit first-call ordinal.
    children.sort((a, b) => a.createdAt - b.createdAt || a.recordedId.localeCompare(b.recordedId));
    return [primary, ...children];
}
/** Replay adapter that makes a configured provider catalog discoverable without provider I/O. */
class ReplayAdapter extends LlmAdapter {
    replay;
    providers;
    constructor(providers, replay) {
        super();
        this.replay = replay;
        this.providers = new Map(providers.map(provider => [provider.id, provider]));
    }
    providerInfo(provider) {
        const configured = this.providers.get(provider);
        /* v8 ignore next -- LlmRuntime only asks about routes registered from this same map. */
        if (configured === undefined)
            return super.providerInfo(provider);
        return { id: provider, name: configured.name ?? provider };
    }
    providerRetryPolicy(provider) {
        const configured = this.providers.get(provider);
        /* v8 ignore next -- LlmRuntime only asks about routes registered from this same map. */
        if (configured === undefined)
            return super.providerRetryPolicy(provider);
        return configured.retryPolicy === undefined
            ? undefined
            : resolveRetryPolicy(configured.retryPolicy, `llm-replay: provider "${provider}" retryPolicy`);
    }
    listModels(provider) {
        const configured = this.providers.get(provider);
        /* v8 ignore next -- LlmRuntime only asks about routes registered from this same map. */
        if (configured === undefined)
            return Promise.resolve([]);
        return Promise.resolve((configured.models ?? []).map(model => ({
            provider,
            id: model.id,
            name: model.name ?? model.id,
            ...model.description === undefined ? {} : { description: model.description },
            ...model.inputModalities === undefined ? {} : { inputModalities: [...model.inputModalities] },
        })));
    }
    resolveModel(provider, model) {
        const configured = this.providers.get(provider);
        /* v8 ignore next -- LlmRuntime only asks about routes registered from this same map. */
        if (configured === undefined)
            return Promise.resolve({ provider, id: model, name: model });
        const configuredModel = configured.models?.find(candidate => candidate.id === model);
        return Promise.resolve({
            provider,
            id: model,
            name: configuredModel?.name ?? model,
            ...configuredModel?.description === undefined ? {} : { description: configuredModel.description },
            ...configuredModel?.inputModalities === undefined
                ? {}
                : { inputModalities: [...configuredModel.inputModalities] },
            ...configuredModel?.contextWindow === undefined
                ? {}
                : { context: { contextWindow: configuredModel.contextWindow } },
            ...configuredModel?.defaultMaxTokens === undefined
                ? {}
                : { defaultMaxTokens: configuredModel.defaultMaxTokens },
            ...configuredModel?.reasoningEfforts === undefined
                ? {}
                : {
                    reasoning: {
                        efforts: configuredModel.reasoningEfforts.map(id => ({ id: ReasoningEffortId(id), name: id })),
                        ...configuredModel.defaultReasoningEffort === undefined
                            ? {}
                            : { defaultEffort: ReasoningEffortId(configuredModel.defaultReasoningEffort) },
                    },
                },
        });
    }
    stream(options) {
        return this.replay(options);
    }
}
/**
 * Wait `paceMs` between chunk yields, aborting the wait (and the stream) the
 * moment the signal fires — a paced replay must cancel as promptly as a burst
 * one.
 */
function paceDelay(paceMs, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, paceMs);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
/** Yield a recorded stream back, honoring abort like a real adapter. */
async function* replayEntry(entry, signal, paceMs) {
    switch (entry.kind) {
        case 'chunks':
            for (const chunk of entry.chunks) {
                if (signal?.aborted)
                    throw new Error('aborted');
                if (paceMs > 0)
                    await paceDelay(paceMs, signal);
                yield chunk;
            }
            return;
        case 'throw':
            // Replay the THROW branch of the LLM contract: emit whatever the adapter
            // streamed before it threw (so the loop sees the same partial output it
            // saw live), then throw the recorded error (e.g. a provider 401, or a
            // mid-stream STREAM_CLOSED after partial chunks).
            for (const chunk of entry.chunks) {
                if (signal?.aborted)
                    throw new Error('aborted');
                if (paceMs > 0)
                    await paceDelay(paceMs, signal);
                yield chunk;
            }
            throw new LlmError(entry.message, entry.code);
        case 'hang':
            // Replay a stream that stalls until cancelled (mirrors MockAdapter): one
            // chunk, then wait for abort and surface it as the consumer expects.
            yield { type: 'block-start', index: 0, blockType: 'text' };
            yield { type: 'text-delta', index: 0, text: 'partial' };
            if (entry.readyFile !== undefined)
                writeFileSync(entry.readyFile, '');
            await new Promise((_resolve, reject) => {
                if (signal?.aborted) {
                    reject(new Error('aborted'));
                    return;
                }
                signal?.addEventListener('abort', () => { reject(new Error('aborted')); }, { once: true });
            });
            /* v8 ignore next -- unreachable: the hang promise only ever rejects (on abort), never resolves; control never reaches here */
            return;
        /* v8 ignore next -- sidecar entries are validated before they reach the closed local union. */
        default:
            return assertNever(entry, 'llm-replay replay entry');
    }
}
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
export function installLlmReplay(ctx, config) {
    const paceMs = config.paceMs ?? 0;
    if (!Number.isInteger(paceMs) || paceMs < 0) {
        throw new Error(`llm-replay: paceMs must be a non-negative integer, got ${String(config.paceMs)}`);
    }
    const scripts = loadSessionScripts(config);
    // Live-session → its bound script + cursor. A new live session id claims the
    // next not-yet-bound script (scripts are in bind order); `nextScript` is the
    // index of the next unclaimed one.
    const bound = new Map();
    let nextScript = 0;
    const ANON = '\0anon\0'; // the key for a call that carries no sessionId
    const replay = (options) => {
        const key = options.sessionId ?? ANON;
        let state = bound.get(key);
        let unrecorded = false;
        if (state === undefined) {
            const script = scripts[nextScript];
            if (script === undefined) {
                // More distinct live sessions made calls than the scenario recorded —
                // an unrecorded subagent appeared. Defer the throw into the returned
                // generator (the listener must return an AsyncIterable, not throw).
                unrecorded = true;
                state = { entries: [], cursor: 0 };
            }
            else {
                nextScript++;
                state = { entries: script.entries, cursor: 0 };
                bound.set(key, state);
            }
        }
        const boundState = state;
        const seenSessions = nextScript;
        const totalScripts = scripts.length;
        const index = boundState.cursor++;
        const entry = boundState.entries[index];
        return (async function* () {
            if (unrecorded) {
                throw new Error(`llm-replay: a model call arrived from an unrecorded session (#${seenSessions + 1}); `
                    + `the scenario recorded only ${totalScripts} session(s) — re-record it`);
            }
            if (entry === undefined) {
                throw new Error(`llm-replay: script exhausted — session requested model call #${index + 1} `
                    + `but its script has only ${boundState.entries.length}; re-record the scenario`);
            }
            yield* replayEntry(resolveScriptedEntry(entry, options.messages), options.signal, paceMs);
        })();
    };
    const providers = config.providers ?? [];
    const dispose = providers.length > 0
        ? ctx.llm.registerAdapter(providers.map(provider => provider.id), new ReplayAdapter(providers, replay))
        : ctx.on('llm/stream', (options, _next) => replay(options));
    return {
        dispose,
        assertConsumed() {
            const problems = [];
            if (nextScript < scripts.length) {
                problems.push(`${scripts.length - nextScript} recorded script(s) never bound to a live session`);
            }
            for (const [key, state] of bound) {
                if (state.cursor < state.entries.length) {
                    const who = key === ANON ? 'the anonymous session' : `session ${key}`;
                    problems.push(`${who} consumed ${state.cursor}/${state.entries.length} recorded call(s)`);
                }
            }
            if (problems.length > 0) {
                throw new Error(`llm-replay: fixture not fully consumed — ${problems.join('; ')}; the scenario drove fewer model calls than recorded`);
            }
        },
    };
}
export const name = 'llm-replay';
export const inject = ['llm'];
function validateConfiguredModalities(providers) {
    for (const provider of providers ?? []) {
        for (const model of provider.models ?? []) {
            const modalities = model.inputModalities;
            if (modalities === undefined)
                continue;
            if (!Array.isArray(modalities)
                || !modalities.every((modality) => modality === 'text' || modality === 'image')) {
                throw new Error(`llm-replay: provider "${provider.id}" model "${model.id}" inputModalities `
                    + 'must be an array containing only "text" and "image"');
            }
        }
    }
}
export function apply(ctx, config = {}) {
    const file = config.file ?? process.env.DSH_SNAPSHOT_FILE;
    if (file === undefined || file.length === 0) {
        throw new Error('llm-replay: a fixture path is required (Config.file or $DSH_SNAPSHOT_FILE)');
    }
    validateConfiguredModalities(config.providers);
    const overrideFile = config.overrideFile ?? process.env.DSH_SNAPSHOT_OVERRIDE;
    const childEnv = process.env.DSH_SNAPSHOT_CHILD_FILES;
    const childFiles = config.childFiles
        ?? (childEnv !== undefined && childEnv.length > 0 ? childEnv.split(pathDelimiter) : []);
    installLlmReplay(ctx, {
        file,
        ...overrideFile !== undefined && overrideFile.length > 0 ? { overrideFile } : {},
        ...childFiles.length > 0 ? { childFiles } : {},
        ...config.providers !== undefined ? { providers: config.providers } : {},
        ...config.paceMs !== undefined ? { paceMs: config.paceMs } : {},
    });
}
//# sourceMappingURL=index.js.map