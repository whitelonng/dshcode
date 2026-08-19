/**
 * Keyless-by-default ACP snapshot suite factory. Each scenario drives the real
 * subprocess and compares normalized stdout; comparable session fixtures are
 * both replay input and expected output. Record mode refreshes reproducible
 * model scenarios from the live API, while refresh mode replays committed
 * scripts and rewrites derived artifacts without a key.
 * Replay scenarios run concurrently because each subprocess owns unique temp
 * cwd and persistence roots and reads only committed fixtures. Record and
 * refresh stay serial while writing.
 *
 * Exactly one scenario per header-composition class pins the tokenized header
 * sequence. Its prompt and tool-schema sequences live in independent
 * sidecars, each of which may be shared with another class pin when the bytes
 * are identical. Every live header is checked against the composed pin, so
 * session-dependent composition must declare a separate class instead of
 * escaping coverage.
 * @module @deepseek-ai/dsh-acp-snapshot/suite
 */
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isSurfaceEligibleType } from '@deepseek-ai/dsh-session/surface';
import { describe, expect, it } from 'vitest';
import { runScenario } from "./harness.js";
import { extractSnapshotSpillPaths, normalizeSessionLog, normalizeStdout, scrubRequestHeaders, scrubSystemPrompts, scrubToolSchemas, tokenizeSessionFixtureCwd, } from "./normalize.js";
/** The readable system-prompt snapshot beside its owning header pin. */
const SYSTEM_PROMPT_SNAPSHOT = 'system-prompt.expected.md';
/** The structured tool-schema snapshot beside its owning header pin. */
const TOOL_SCHEMAS_SNAPSHOT = 'tool-schemas.expected.json';
/** Return the dedicated tool-schema sidecar for one child fixture index. */
function childToolSchemasSnapshot(index) {
    return `tool-schemas.${index}.expected.json`;
}
/** Return the dedicated system-prompt sidecar for one child fixture index. */
function childSystemPromptSnapshot(index) {
    return `system-prompt.${index}.expected.md`;
}
/** The optional full Windows-native stdout transcript. */
const WINDOWS_STDOUT_SNAPSHOT = 'stdout.expected.windows.jsonl';
/** Stable session-log token standing in for the sidecar's initial schemas. */
const TOOLS_TOKEN = '{{tools}}';
const PACKED_CHUNK_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks']);
/** Canonical UUID spelling minted for ordinary message identities. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Whether a scenario's run test is skipped for this mode and host: record mode
 * skips authored (non-`recorded`) scenarios, {@link Scenario.posixOnly}
 * scenarios skip on Windows, and {@link Scenario.pwshOnly} scenarios skip
 * when the caller's `hasPwsh` probe is false.
 *
 * @param scenario The scenario whose run test is being registered.
 * @param recording Whether the suite runs in record mode.
 * @param platform The running Node platform, injectable for unit coverage.
 * @param hasPwsh The caller's pwsh-availability probe; `pwshOnly` scenarios
 *   skip unless it is true.
 * @returns True when the scenario's run test must not execute.
 */
export function scenarioSkipped(scenario, recording, platform = process.platform, hasPwsh) {
    if (recording && !scenario.recorded)
        return true;
    if (scenario.posixOnly === true && platform === 'win32')
        return true;
    return scenario.pwshOnly === true && hasPwsh !== true;
}
/**
 * Select the shared stdout expected output plus any platform-native assertion declared by a scenario.
 *
 * @param scenario The scenario whose stdout contract is being selected.
 * @param platform The running Node platform, injectable for unit coverage.
 * @returns The ordered expected-output variants: shared canonical first, then optional Windows native.
 */
export function stdoutExpectedVariants(scenario, platform = process.platform) {
    const canonical = { file: 'stdout.expected.jsonl', cwdPathMode: 'canonical' };
    if (platform !== 'win32' || scenario.pinsNativeWindowsStdout !== true)
        return [canonical];
    return [canonical, { file: WINDOWS_STDOUT_SNAPSHOT, cwdPathMode: 'native' }];
}
/**
 * Record one scenario's generated content for a shared snapshot source.
 * A later claimant must generate identical bytes; otherwise record/refresh
 * would make the final file depend on scenario order.
 *
 * @param claims Claims already made in this suite run, keyed by source path.
 * @param source The shared snapshot path being claimed.
 * @param scenario The scenario generating the content.
 * @param content The complete content the scenario generated.
 * @returns Nothing.
 */
export function claimSharedSnapshot(claims, source, scenario, content) {
    const previous = claims.get(source);
    if (previous !== undefined && previous.content !== content) {
        throw new Error(`acp-snapshot: shared snapshot ${source} diverged between ${previous.scenario} and ${scenario}`);
    }
    if (previous === undefined)
        claims.set(source, { scenario, content });
}
/**
 * Reject byte-identical committed snapshots stored under different paths.
 *
 * @param kind Human-readable snapshot kind for the diagnostic.
 * @param snapshots The committed files to compare.
 * @returns Nothing.
 */
export function assertUniqueSnapshotContents(kind, snapshots) {
    const firstPathByContent = new Map();
    for (const snapshot of snapshots) {
        const firstPath = firstPathByContent.get(snapshot.content);
        if (firstPath !== undefined) {
            throw new Error(`acp-snapshot: identical ${kind} snapshots appear in ${firstPath} and ${snapshot.path}; reuse one source`);
        }
        firstPathByContent.set(snapshot.content, snapshot.path);
    }
}
/**
 * Validate and order a scenario directory's session-fixture filenames.
 *
 * The primary fixture is always `session.jsonl`; child sessions are discovered
 * from contiguous `session.1.jsonl` … filenames. The directory is the source of
 * truth, so scenario tables do not duplicate a child count that can drift from
 * the files. A session-like JSONL with any other suffix fails loud.
 *
 * @param names File names in one scenario directory.
 * @returns The primary and child fixture names in replay/harvest order.
 */
export function sessionFixtureNames(names) {
    if (!names.includes('session.jsonl'))
        throw new Error('missing session.jsonl');
    const children = [];
    for (const name of names) {
        if (name === 'session.jsonl')
            continue;
        if (!name.startsWith('session.') || !name.endsWith('.jsonl'))
            continue;
        const match = /^session\.([1-9]\d*)\.jsonl$/.exec(name);
        if (match === null)
            throw new Error(`invalid child session fixture name: ${name}`);
        children.push({ name, index: Number(match[1]) });
    }
    children.sort((a, b) => a.index - b.index);
    for (const [offset, child] of children.entries()) {
        const expected = offset + 1;
        if (child.index !== expected) {
            throw new Error(`child session fixtures must be contiguous: expected session.${expected}.jsonl, found ${child.name}`);
        }
    }
    return ['session.jsonl', ...children.map(child => child.name)];
}
/** Read one scenario directory's validated session-fixture inventory. */
async function sessionFixtures(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return sessionFixtureNames(entries.filter(entry => entry.isFile()).map(entry => entry.name));
}
/**
 * Derive normalization values from a fixture's own session header. Recorded ids and cwd differ
 * from the live replay run; the non-empty sentinel for missing cwd avoids accidental empty-
 * string replacement.
 *
 * @param fixture The committed `session.jsonl` content.
 * @returns The fixture's own volatile values, ready for {@link normalizeSessionLog}.
 */
export function fixtureContext(fixture) {
    const firstLine = fixture.split('\n').find(line => line.trim().length > 0) ?? '{}';
    const header = JSON.parse(firstLine);
    return {
        sessionIds: typeof header.id === 'string' ? [header.id] : [],
        cwd: typeof header.cwd === 'string' ? header.cwd : '\0no-cwd\0',
    };
}
/**
 * The `data.header` payload of every `request/header` event in a session
 * JSONL, in log order, with the log's volatile values scrubbed first
 * ({@link normalizeSessionLog}) so headers harvested from different runs —
 * each embedding its own generated cwd in the composed prompt — compare on equal
 * footing.
 *
 * @param rawLog The session `.jsonl` content to extract headers from.
 * @param ctx The volatile values of the run that produced it.
 * @returns The normalized `data.header` payloads, in log order.
 */
export function normalizedHeaders(rawLog, ctx) {
    return normalizeSessionLog(rawLog, ctx)
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line))
        .filter(record => record.type === 'request/header')
        .map(record => record.data?.header);
}
/**
 * The normalized string-valued system prompts carried by request headers in a
 * session JSONL, in log order. Headers without a string prompt are omitted so
 * callers can assert one prompt per header explicitly.
 *
 * @param rawLog The session `.jsonl` content to inspect.
 * @param ctx The volatile values of the run that produced it.
 * @returns The normalized system prompts, in header order.
 */
export function normalizedSystemPrompts(rawLog, ctx) {
    return normalizedHeaders(rawLog, ctx).flatMap((header) => {
        if (header === null || typeof header !== 'object')
            return [];
        const system = header.system;
        return typeof system === 'string' ? [system] : [];
    });
}
/**
 * The normalized tool-schema arrays carried by request headers in a session
 * JSONL, in log order. Headers without an array-valued tools field are omitted
 * so callers can assert one schema set per header explicitly.
 *
 * @param rawLog The session `.jsonl` content to inspect.
 * @param ctx The volatile values of the run that produced it.
 * @returns The normalized initial tool-schema arrays, in header order.
 */
export function normalizedToolSchemas(rawLog, ctx) {
    return normalizedHeaders(rawLog, ctx).flatMap((header) => {
        if (header === null || typeof header !== 'object')
            return [];
        const tools = header.tools;
        return Array.isArray(tools) ? [tools] : [];
    });
}
/**
 * Render the full tool-schema sequence as canonical, readable JSON.
 *
 * @param initial The pinned request header's complete tool schemas.
 * @param changes Complete tool schemas from later changed headers.
 * @returns A pretty-printed JSON snapshot ending in one newline.
 */
export function formatToolSchemasSnapshot(initial, changes = []) {
    return `${JSON.stringify({ initial, changes }, null, 2)}\n`;
}
/**
 * Parse and validate the stable top-level fields of a tool-schema sidecar.
 *
 * @param snapshot The JSON sidecar text.
 * @returns Its initial and changed-header schema sets.
 */
export function parseToolSchemasSnapshot(snapshot) {
    const parsed = JSON.parse(snapshot);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('acp-snapshot: tool-schema snapshot must be an object');
    }
    const { initial, changes } = parsed;
    if (!Array.isArray(initial) || !Array.isArray(changes) || !changes.every(Array.isArray)) {
        throw new Error('acp-snapshot: tool-schema snapshot must carry array-valued initial and changes fields');
    }
    return { initial, changes };
}
/**
 * Restore one sidecar schema set into a tokenized pinned header.
 *
 * @param header The parsed request header carrying `tools: "{{tools}}"`.
 * @param schemas The complete schemas for this full header snapshot.
 * @returns A copy of the header with its complete schemas restored.
 */
export function restorePinnedToolSchemas(header, schemas) {
    if (header === null || typeof header !== 'object' || Array.isArray(header)) {
        throw new Error('acp-snapshot: pinned request header must be an object');
    }
    if (header.tools !== TOOLS_TOKEN) {
        throw new Error(`acp-snapshot: pinned request header tools must equal ${TOOLS_TOKEN}`);
    }
    return { ...header, tools: schemas };
}
/**
 * Render a normalized prompt as a repository-friendly Markdown snapshot.
 * Prompt text is unchanged except that a missing terminal newline is added so
 * the committed file follows the repository newline contract.
 *
 * @param prompt The normalized system prompt.
 * @param changes Full normalized prompts from later changed-header snapshots.
 * @returns Markdown snapshot text ending in a newline.
 */
export function formatSystemPromptSnapshot(prompt, changes = []) {
    let snapshot = prompt.endsWith('\n') ? prompt : `${prompt}\n`;
    for (const [index, change] of changes.entries()) {
        snapshot += `\n<!-- request/header change ${index + 1} -->\n\n`;
        snapshot += change.endsWith('\n') ? change : `${change}\n`;
    }
    return snapshot;
}
/**
 * Reject a child prompt sidecar that cannot own distinct, canonical prompt text.
 * @param sidecar - committed child prompt snapshot.
 * @param classPin - initial prompt snapshot owned by the scenario's header class.
 * @param label - repository-relative fixture label for diagnostics.
 */
export function assertChildSystemPromptSnapshot(sidecar, classPin, label) {
    if (sidecar.trim().length === 0)
        throw new Error(`${label} must pin a non-empty prompt`);
    if (!sidecar.endsWith('\n'))
        throw new Error(`${label} must end in a newline`);
    if (sidecar === classPin)
        throw new Error(`${label} must differ from its class pin`);
}
/** Return the initial-prompt portion of a possibly multi-header snapshot. */
function initialSystemPromptSnapshot(snapshot) {
    const marker = snapshot.indexOf('\n<!-- request/header change ');
    return marker < 0 ? snapshot : snapshot.slice(0, marker);
}
/**
 * Count changed `request/header` snapshots in a session JSONL.
 *
 * @param rawLog The session `.jsonl` content.
 * @returns How many headers carry reason `change`.
 */
export function headerChangeCount(rawLog) {
    return rawLog.split('\n')
        .filter(line => line.trim().length > 0)
        .filter((line) => {
        const record = JSON.parse(line);
        return record.type === 'request/header' && record.data?.reason === 'change';
    })
        .length;
}
function parseJsonlRecords(text) {
    return text.split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line));
}
/** Narrow one parsed value to the complete identified-message shape retained by fixtures. */
function completeMessage(value) {
    if (!isRecord(value)
        || typeof value.id !== 'string'
        || !UUID_RE.test(value.id)
        || typeof value.role !== 'string'
        || !Array.isArray(value.content)
        || !isRecord(value.source))
        return undefined;
    return value;
}
/** Return the complete identified message carried by one surface event. */
function surfaceEventMessage(record) {
    const type = record.type;
    if (typeof type !== 'string' || !isSurfaceEligibleType(type))
        return undefined;
    const data = record.data;
    if (!isRecord(data))
        return undefined;
    let message;
    switch (type) {
        case 'user/message':
            message = data;
            break;
        case 'assistant/message':
        case 'tool/result':
            message = data.message;
            break;
        /* v8 ignore next -- the authoritative predicate must fail loud when a new surface shape lands. */
        default: throw new Error(`acp-snapshot: unsupported surface event type "${type}"`);
    }
    return completeMessage(message);
}
/** Return complete message identities structurally owned by one durable record. */
function recordMessages(record) {
    const surfaceMessage = surfaceEventMessage(record);
    if (surfaceMessage !== undefined)
        return [surfaceMessage];
    if (record.type !== 'agent/inbox/spliced' || !isRecord(record.data) || !Array.isArray(record.data.inserted)) {
        return [];
    }
    return record.data.inserted.flatMap((value) => {
        const message = completeMessage(value);
        return message === undefined ? [] : [message];
    });
}
/** Serialize parsed JSON by value rather than insertion order. */
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
/** Index identity-free message values whose ID and fingerprint are mutually unique. */
function uniqueMessageIds(logs) {
    const fingerprintsById = new Map();
    const idsByFingerprint = new Map();
    for (const log of logs) {
        for (const record of parseJsonlRecords(log)) {
            for (const message of recordMessages(record)) {
                const { id, ...withoutId } = message;
                const messageId = id;
                const fingerprint = canonicalJson(withoutId);
                const fingerprints = fingerprintsById.get(messageId);
                if (fingerprints === undefined)
                    fingerprintsById.set(messageId, new Set([fingerprint]));
                else
                    fingerprints.add(fingerprint);
                const ids = idsByFingerprint.get(fingerprint);
                if (ids === undefined)
                    idsByFingerprint.set(fingerprint, new Set([messageId]));
                else
                    ids.add(messageId);
            }
        }
    }
    const unique = new Map();
    for (const [id, fingerprints] of fingerprintsById) {
        if (fingerprints.size !== 1)
            continue;
        const fingerprint = fingerprints.values().next().value;
        if (idsByFingerprint.get(fingerprint)?.size !== 1)
            continue;
        unique.set(fingerprint, id);
    }
    return unique;
}
/**
 * Match unchanged complete messages across a scenario's fresh and existing logs.
 * New, changed, duplicate-content, or otherwise ambiguous messages keep their fresh ids.
 */
function fixtureMessageIdReplacements(logs, fixtures) {
    const freshIds = uniqueMessageIds(logs);
    const existingIds = uniqueMessageIds(fixtures);
    const replacements = new Map();
    for (const [fingerprint, fresh] of freshIds) {
        const existing = existingIds.get(fingerprint);
        if (existing === undefined || fresh === existing)
            continue;
        replacements.set(fresh, existing);
    }
    return replacements;
}
/** Apply literal fixture replacements without changing any other fresh value. */
function applyFixtureReplacements(content, replacements) {
    let stable = content;
    for (const { from, to } of replacements)
        stable = stable.split(from).join(to);
    return stable;
}
/** Rewrite only validated durable-message ID fields, leaving every other occurrence untouched. */
function applyFixtureMessageIds(content, replacements) {
    return content.split('\n').map((line) => {
        if (line.trim().length === 0)
            return line;
        const record = JSON.parse(line);
        let changed = false;
        for (const message of recordMessages(record)) {
            const replacement = replacements.get(message.id);
            if (replacement === undefined)
                continue;
            message.id = replacement;
            changed = true;
        }
        return changed ? JSON.stringify(record) : line;
    }).join('\n');
}
/**
 * Carry committed UUIDs into unchanged, unambiguous messages in fresh session fixtures.
 *
 * @param logs Fresh fixture-ready session JSONL contents for one scenario.
 * @param fixtures Existing fixture contents in matching order; missing fixtures may be empty strings.
 * @returns The fresh contents with only reusable message UUIDs replaced.
 */
export function stabilizeFixtureMessageIds(logs, fixtures) {
    const replacements = fixtureMessageIdReplacements(logs, fixtures);
    return logs.map(log => applyFixtureMessageIds(log, replacements));
}
/** One packed row's member times, or `undefined` for an ordinary record. */
function packedTimes(record) {
    if (!PACKED_CHUNK_ROW_TYPES.has(record.type))
        return undefined;
    const row = record;
    const times = [row.time0];
    for (const gap of row.data.dt)
        times.push(times[times.length - 1] + gap);
    return times;
}
/** Expand packed timing envelopes so refresh alignment follows logical events, not physical lines. */
function logicalRecords(records) {
    return records.flatMap((record) => {
        const times = packedTimes(record);
        return times === undefined ? [record] : times.map(time => ({ type: 'assistant/chunk', time }));
    });
}
/**
 * Find tool calls whose structured result reports `UNKNOWN_TOOL`.
 *
 * Snapshot refresh must not turn a missing registration into accepted behavior;
 * intentional unknown-tool behavior belongs in a focused unit or e2e test.
 *
 * @param rawLog The session JSONL to inspect.
 * @returns The failing call ids in log order, using a diagnostic placeholder when absent.
 */
export function unknownToolCallIds(rawLog) {
    return parseJsonlRecords(rawLog).flatMap((record) => {
        if (record.type !== 'tool/result')
            return [];
        const data = record.data;
        if (data === null || typeof data !== 'object')
            return [];
        const { message, error } = data;
        if (error === null || typeof error !== 'object')
            return [];
        if (error.code !== 'UNKNOWN_TOOL')
            return [];
        const source = typeof message === 'object' && message !== null
            ? message.source
            : undefined;
        const callId = typeof source === 'object' && source !== null
            ? source.callId
            : undefined;
        return [typeof callId === 'string' ? callId : '<missing callId>'];
    });
}
/**
 * Build refresh write-back replacements for per-log session ids, cwd values,
 * and spill paths. Durable message ids have a later structural owner.
 *
 * @param logs The freshly harvested logs, in fixture order.
 * @param fixtures The existing fixture contents, in matching order.
 * @returns Literal replacements from fresh values to the fixture's existing values.
 */
export function refreshFixtureReplacements(logs, fixtures) {
    const replacements = [];
    for (let i = 0; i < logs.length; i++) {
        const fresh = parseJsonlRecords(logs[i].content)[0];
        const existing = parseJsonlRecords(fixtures[i] ?? '')[0];
        for (const field of ['id', 'cwd']) {
            const from = fresh?.[field];
            const to = existing?.[field];
            if (typeof from === 'string' && typeof to === 'string' && from.length > 0 && from !== to) {
                replacements.push({ from, to });
            }
        }
        // Stabilize snapshot spill paths: match by filename suffix so the raw
        // fixture does not churn on every refresh from a different session run.
        const freshSpills = extractSnapshotSpillPaths(logs[i].content);
        const existingSpills = extractSnapshotSpillPaths(fixtures[i] ?? '');
        for (const [name, existingPath] of existingSpills) {
            const freshPath = freshSpills.get(name);
            if (freshPath !== undefined && freshPath !== existingPath) {
                replacements.push({ from: freshPath, to: existingPath });
            }
        }
    }
    return replacements;
}
function preserveFixtureVolatiles(record, existing) {
    if (existing === undefined || existing.type !== record.type)
        return;
    if (record.type === 'session') {
        for (const field of ['id', 'createdAt', 'cwd', 'parentSession']) {
            if (field in record && field in existing)
                record[field] = existing[field];
        }
        return;
    }
    if ('time' in record && 'time' in existing)
        record.time = existing.time;
    if (record.type !== 'hook/result')
        return;
    const data = record.data;
    const existingData = existing.data;
    if (data !== null && typeof data === 'object'
        && existingData !== null && typeof existingData === 'object'
        && 'durationMs' in data && 'durationMs' in existingData) {
        data.durationMs = existingData.durationMs;
    }
}
/** Carry logical member times into a fresh packed row while leaving its fragment arrays untouched. */
function preservePackedMemberTimes(record, existingMembers) {
    if (!PACKED_CHUNK_ROW_TYPES.has(record.type))
        return;
    const row = record;
    const firstTime = existingMembers[0]?.time;
    if (!Number.isSafeInteger(firstTime))
        return;
    row.time0 = firstTime;
    if (existingMembers.length !== row.data.dt.length + 1)
        return;
    const times = existingMembers.map(member => Number.isSafeInteger(member.time) ? member.time : undefined);
    if (times.some(time => time === undefined))
        return;
    const memberTimes = times;
    const gaps = memberTimes.slice(1).map((time, index) => time - memberTimes[index]);
    if (gaps.some(gap => !Number.isSafeInteger(gap)))
        return;
    row.data.dt = gaps;
}
/** Whether a parsed JSON value is a non-array object. */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/**
 * Reuse existing leaves whose normalized values equal the fresh values.
 * Objects merge by key; arrays merge only when their positions still align.
 */
function preserveNormalizedVolatiles(fresh, existing, normalizedFresh, normalizedExisting, stringMappings) {
    if (Array.isArray(fresh)
        && Array.isArray(existing)
        && Array.isArray(normalizedFresh)
        && Array.isArray(normalizedExisting)) {
        if (fresh.length !== existing.length
            || fresh.length !== normalizedFresh.length
            || fresh.length !== normalizedExisting.length)
            return fresh;
        return fresh.map((value, index) => preserveNormalizedVolatiles(value, existing[index], normalizedFresh[index], normalizedExisting[index], stringMappings));
    }
    if (isRecord(fresh)
        && isRecord(existing)
        && isRecord(normalizedFresh)
        && isRecord(normalizedExisting)) {
        return Object.fromEntries(Object.entries(fresh).map(([key, value]) => [
            key,
            Object.hasOwn(existing, key)
                && Object.hasOwn(normalizedFresh, key)
                && Object.hasOwn(normalizedExisting, key)
                ? preserveNormalizedVolatiles(value, existing[key], normalizedFresh[key], normalizedExisting[key], stringMappings)
                : value,
        ]));
    }
    if (typeof fresh === 'string'
        && typeof existing === 'string'
        && typeof normalizedFresh === 'string'
        && normalizedFresh === normalizedExisting) {
        return stringMappings.get(JSON.stringify([normalizedFresh, fresh])) === existing
            ? existing
            : fresh;
    }
    return Object.is(normalizedFresh, normalizedExisting) ? existing : fresh;
}
/** Normalize one aligned record with the same contract used by fixture comparison. */
function normalizedRefreshRecord(record, context) {
    return JSON.parse(normalizeSessionLog(`${JSON.stringify(record)}\n`, context));
}
/**
 * Add normalized-equivalent string replacements to a bijection.
 * Structural differences are fresh-owned and therefore contribute no mapping.
 */
function collectNormalizedStringMappings(fresh, existing, normalizedFresh, normalizedExisting, excludedStrings, forward, reverse) {
    if (Array.isArray(fresh)
        && Array.isArray(existing)
        && Array.isArray(normalizedFresh)
        && Array.isArray(normalizedExisting)) {
        if (fresh.length !== existing.length
            || fresh.length !== normalizedFresh.length
            || fresh.length !== normalizedExisting.length)
            return true;
        return fresh.every((value, index) => collectNormalizedStringMappings(value, existing[index], normalizedFresh[index], normalizedExisting[index], excludedStrings, forward, reverse));
    }
    if (isRecord(fresh)
        && isRecord(existing)
        && isRecord(normalizedFresh)
        && isRecord(normalizedExisting)) {
        return Object.entries(fresh).every(([key, value]) => !Object.hasOwn(existing, key)
            || !Object.hasOwn(normalizedFresh, key)
            || !Object.hasOwn(normalizedExisting, key)
            || collectNormalizedStringMappings(value, existing[key], normalizedFresh[key], normalizedExisting[key], excludedStrings, forward, reverse));
    }
    if (typeof fresh !== 'string'
        || typeof existing !== 'string'
        || typeof normalizedFresh !== 'string'
        || normalizedFresh !== normalizedExisting
        || fresh === existing
        || excludedStrings.has(fresh)
        || excludedStrings.has(existing))
        return true;
    const freshKey = JSON.stringify([normalizedFresh, fresh]);
    const existingKey = JSON.stringify([normalizedFresh, existing]);
    const mappedExisting = forward.get(freshKey);
    const mappedFresh = reverse.get(existingKey);
    if (mappedExisting !== undefined && mappedExisting !== existing
        || mappedFresh !== undefined && mappedFresh !== fresh)
        return false;
    forward.set(freshKey, existing);
    reverse.set(existingKey, fresh);
    return true;
}
/**
 * Build a log-wide bijection for normalized-equivalent strings.
 * Any unexplained record mismatch or conflicting replacement disables reuse.
 */
function normalizedStringMappings(records, freshRecords, existingRecords, freshContext, existingContext) {
    const excludedStrings = new Set();
    for (const record of [...freshRecords, ...existingRecords]) {
        for (const message of recordMessages(record))
            excludedStrings.add(message.id);
    }
    const forward = new Map();
    const reverse = new Map();
    let existingIndex = 0;
    for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
        const record = records[recordIndex];
        const existingRecord = existingRecords[existingIndex];
        const memberCount = packedTimes(record)?.length ?? 1;
        if (record.type === 'session/title' && existingRecord?.type !== 'session/title')
            continue;
        if (memberCount > 1) {
            const existingMembers = existingRecords.slice(existingIndex, existingIndex + memberCount);
            if (existingMembers.length !== memberCount
                || existingMembers.some(member => member.type !== 'assistant/chunk'))
                return undefined;
        }
        else {
            if (existingRecord === undefined || existingRecord.type !== record.type)
                return undefined;
            if (!collectNormalizedStringMappings(record, existingRecord, normalizedRefreshRecord(freshRecords[recordIndex], freshContext), normalizedRefreshRecord(existingRecord, existingContext), excludedStrings, forward, reverse))
                return undefined;
        }
        existingIndex += memberCount;
    }
    return existingIndex === existingRecords.length ? forward : undefined;
}
/**
 * Rewrite a fresh replay-produced log so repeated refreshes do not churn
 * volatile fixture fields. Meaningful event payloads come from `fresh`; the
 * existing fixture lends normalized-equivalent values, including non-message ids, paths,
 * creation/event times, spill locators, and hook durations, only when the
 * complete record layout aligns and volatile strings form a consistent
 * bijection. Complete durable-message ids are excluded because the later
 * fixture-ready structural pass owns them. Ambiguous layouts or mappings
 * keep fresh strings. Packed timing envelopes expand for alignment, so
 * packing does not shift later records;
 * fresh semantic values and fragment arrays remain authoritative.
 *
 * @param fresh The newly harvested session JSONL.
 * @param existing The committed fixture JSONL being refreshed.
 * @param replacements Cross-log literal replacements from {@link refreshFixtureReplacements}.
 * @param freshContext The harvested run's ids, cwd, and every cwd alias.
 * @returns The stabilized JSONL content to write back.
 */
export function stabilizeRefreshLog(fresh, existing, replacements, freshContext) {
    const freshRecords = parseJsonlRecords(fresh);
    const stable = applyFixtureReplacements(fresh, replacements);
    const existingRecords = logicalRecords(parseJsonlRecords(existing));
    const records = parseJsonlRecords(stable);
    const existingContext = fixtureContext(existing);
    const stringMappings = normalizedStringMappings(records, freshRecords, existingRecords, freshContext, existingContext);
    let existingIndex = 0;
    let previousEventTime;
    for (let i = 0; i < records.length; i++) {
        let record = records[i];
        const existingRecord = existingRecords[existingIndex];
        const memberCount = packedTimes(record)?.length ?? 1;
        const insertedTitle = record.type === 'session/title' && existingRecord?.type !== 'session/title';
        if (insertedTitle) {
            /* v8 ignore next -- a title is turn-enclosed, so a preceding event time exists in every valid fixture. */
            if (typeof previousEventTime !== 'number')
                throw new Error('acp-snapshot: inserted title has no preceding event time');
            record.time = previousEventTime;
        }
        else {
            if (stringMappings !== undefined
                && memberCount === 1
                && existingRecord !== undefined
                && existingRecord.type === record.type) {
                record = preserveNormalizedVolatiles(record, existingRecord, normalizedRefreshRecord(freshRecords[i], freshContext), normalizedRefreshRecord(existingRecord, existingContext), stringMappings);
                records[i] = record;
            }
            preservePackedMemberTimes(record, existingRecords.slice(existingIndex, existingIndex + memberCount));
            preserveFixtureVolatiles(record, existingRecord);
            existingIndex += memberCount;
        }
        if (typeof record.time === 'number')
            previousEventTime = record.time;
    }
    return records.map(record => JSON.stringify(record)).join('\n') + '\n';
}
/**
 * Register the suite: one test per scenario (the expected-output and log comparisons and
 * the header-uniformity guard) plus the fixture guard block (no orphan
 * scenario dirs, required files present, exactly one pin per header class,
 * shared sidecars unique and well-formed, every JSONL prompt-scrubbed,
 * non-pinning fixtures fully header-scrubbed). Must
 * run at vitest collection time — it calls `describe`/`it`. Throws
 * immediately if any header class lacks a pinning scenario or carries two
 * (the uniformity guard needs exactly one comparison anchor per class).
 *
 * @param options The agent, snapshots directory, scenario table, and mode.
 */
export function defineAcpSnapshotSuite(options) {
    const { agent, snapshotsDir, scenarios, mode } = options;
    const RECORDING = mode === 'record';
    const REFRESHING = mode === 'refresh';
    const childMode = RECORDING ? 'record' : 'replay';
    const scenarioSuite = mode === 'replay' ? describe.concurrent : describe;
    /** The class a scenario's header composition belongs to (see {@link Scenario.headerClass}). */
    const classOf = (scenario) => scenario.headerClass ?? 'default';
    const scenariosByName = new Map();
    for (const scenario of scenarios) {
        if (scenariosByName.has(scenario.name)) {
            throw new Error(`acp-snapshot: duplicate scenario name "${scenario.name}"`);
        }
        scenariosByName.set(scenario.name, scenario);
        for (const field of ['systemPromptSource', 'toolSchemasSource']) {
            if (scenario[field] !== undefined && scenario.pinsHeader !== true) {
                throw new Error(`acp-snapshot: ${scenario.name}.${field} is only valid on a header-pinning scenario`);
            }
        }
    }
    /** Each header class's single pinning scenario. Guarded here (and by meta-tests) so a pin cannot silently vanish or split. */
    const pinningByClass = new Map();
    for (const scenario of scenarios) {
        if (scenario.pinsHeader !== true)
            continue;
        const cls = classOf(scenario);
        const existing = pinningByClass.get(cls);
        if (existing)
            throw new Error(`acp-snapshot: header class "${cls}" pinned by both ${existing.name} and ${scenario.name}`);
        pinningByClass.set(cls, scenario);
    }
    for (const scenario of scenarios) {
        if (!pinningByClass.has(classOf(scenario))) {
            throw new Error(`acp-snapshot: no scenario pins the request-header content of class "${classOf(scenario)}" (needed by ${scenario.name})`);
        }
    }
    const sourceFor = (pinningScenario, field, label) => {
        const sourceName = pinningScenario[field] ?? pinningScenario.name;
        const source = scenariosByName.get(sourceName);
        if (source === undefined) {
            throw new Error(`acp-snapshot: ${pinningScenario.name} names unknown ${label} source "${sourceName}"`);
        }
        if (source.pinsHeader !== true) {
            throw new Error(`acp-snapshot: ${pinningScenario.name} names non-pinning ${label} source "${sourceName}"`);
        }
        if (source[field] !== undefined && source[field] !== source.name) {
            throw new Error(`acp-snapshot: ${pinningScenario.name} names ${label} source "${sourceName}", which does not own its sidecar`);
        }
        const expectedChanges = pinningScenario.expectedHeaderChanges ?? 0;
        const sourceChanges = source.expectedHeaderChanges ?? 0;
        if (sourceChanges !== expectedChanges) {
            throw new Error(`acp-snapshot: ${pinningScenario.name} and ${sourceName} declare different header-change counts for shared ${label}`);
        }
        return source;
    };
    const promptSourceByClass = new Map();
    const schemaSourceByClass = new Map();
    for (const [cls, pinningScenario] of pinningByClass) {
        promptSourceByClass.set(cls, sourceFor(pinningScenario, 'systemPromptSource', 'system-prompt snapshot'));
        schemaSourceByClass.set(cls, sourceFor(pinningScenario, 'toolSchemasSource', 'tool-schema snapshot'));
    }
    const promptOwners = new Set([...promptSourceByClass.values()].map(source => source.name));
    const schemaOwners = new Set([...schemaSourceByClass.values()].map(source => source.name));
    const promptClaims = new Map();
    const schemaClaims = new Map();
    scenarioSuite('snapshot scenarios', () => {
        for (const scenario of scenarios) {
            // In RECORD mode, only re-run the `recorded` (live-API) scenarios; the `authored` ones
            // (sidecar-driven errors/cancel) are never re-recorded. `posixOnly` scenarios skip on Windows;
            // `pwshOnly` scenarios skip when the caller's `hasPwsh` probe is false.
            it.skipIf(scenarioSkipped(scenario, RECORDING, process.platform, options.hasPwsh))(`snapshot: ${scenario.name} matches the expected outputs`, async ({ expect }) => {
                const dir = join(snapshotsDir, scenario.name);
                const input = JSON.parse(await readFile(join(dir, 'input.json'), 'utf8'));
                const overrideFile = join(dir, 'replay.override.json');
                const workspaceDir = join(dir, 'workspace');
                // Replay/refresh need the committed inventory up front because those
                // files drive the model scripts. Record mode creates that inventory
                // from the harvested live logs, so it must also work for a brand-new
                // scenario with no session.jsonl yet.
                let fixtureFiles = RECORDING ? [] : await sessionFixtures(dir);
                const childFixtureFiles = fixtureFiles.slice(1);
                const comparesLog = scenario.comparesLog ?? scenario.hasModelTurn;
                const result = await runScenario(input, {
                    agent,
                    mode: childMode,
                    fixtureFile: join(dir, 'session.jsonl'),
                    ...scenario.env !== undefined ? { env: scenario.env } : {},
                    ...existsSync(overrideFile) ? { overrideFile } : {},
                    // In REPLAY, forward the recorded child fixtures so each subagent session
                    // replays from its own script. In RECORD they are harvested, not read.
                    ...!RECORDING && childFixtureFiles.length > 0 ? { childFiles: childFixtureFiles.map(file => join(dir, file)) } : {},
                    ...existsSync(workspaceDir) ? { workspaceDir } : {},
                    ...scenario.prepareWorkspace !== undefined ? { prepareWorkspace: scenario.prepareWorkspace } : {},
                    ...scenario.workspaceParent !== undefined ? { workspaceParent: scenario.workspaceParent } : {},
                    // A scenario booting an overlay tree passes its own live config; the
                    // bin's replay swap derives the sibling `*cordis.snapshot.yml` from it.
                    ...scenario.configPath !== undefined ? { configPath: scenario.configPath } : {},
                });
                for (const log of result.sessionLogs) {
                    expect(unknownToolCallIds(log.content), `session ${log.id}: snapshot scenarios must not accept UNKNOWN_TOOL`)
                        .toEqual([]);
                }
                // Scrub every volatile id the run produced: the ACP server-issued session id plus every
                // harvested log's recorded id (a subagent child id never surfaces over ACP, but it
                // appears in the child's own log header).
                const ctx = {
                    sessionIds: [
                        ...result.sessionId !== undefined ? [result.sessionId] : [],
                        ...result.sessionLogs.map(l => l.id),
                    ],
                    cwd: result.cwd,
                    cwdAliases: result.cwdAliases,
                };
                const childSchemaPins = new Set(scenario.pinsChildToolSchemas ?? []);
                const childPromptPins = new Set(scenario.pinsChildSystemPrompts ?? []);
                // Record writes live model fixtures; keyless refresh writes every comparable replayed
                // fixture. Pinning JSONL keeps prefixes but moves prompts and schemas into sidecars.
                const scrub = scenario.pinsHeader === true
                    ? (log) => scrubToolSchemas(scrubSystemPrompts(log))
                    : scrubRequestHeaders;
                const portableFixture = scenario.workspaceParent === undefined
                    ? tokenizeSessionFixtureCwd
                    : (log) => log;
                const writesSessionFixtures = (RECORDING && scenario.recorded && scenario.hasModelTurn)
                    || (REFRESHING && comparesLog);
                if (writesSessionFixtures) {
                    expect(result.sessionLogs.length, `${mode} produced no session log to harvest`).toBeGreaterThan(0);
                    if (REFRESHING) {
                        expect(result.sessionLogs.length, `expected ${fixtureFiles.length} session logs (parent + children)`)
                            .toBe(fixtureFiles.length);
                    }
                    const outputFixtureFiles = [
                        'session.jsonl',
                        ...Array.from({ length: result.sessionLogs.length - 1 }, (_, i) => `session.${i + 1}.jsonl`),
                    ];
                    const existingFixtures = await Promise.all(outputFixtureFiles.map(async (file) => {
                        const path = join(dir, file);
                        return existsSync(path) ? readFile(path, 'utf8') : '';
                    }));
                    const refreshReplacements = REFRESHING
                        ? refreshFixtureReplacements(result.sessionLogs, existingFixtures)
                        : [];
                    const freshFixtures = REFRESHING
                        ? result.sessionLogs.map((log, index) => scrub(portableFixture(stabilizeRefreshLog(log.content, existingFixtures[index], refreshReplacements, ctx))))
                        : result.sessionLogs.map(log => scrub(portableFixture(log.content)));
                    const outputFixtures = stabilizeFixtureMessageIds(freshFixtures, existingFixtures);
                    await Promise.all(outputFixtures.map((fixture, index) => writeFile(join(dir, outputFixtureFiles[index]), fixture)));
                    if (RECORDING) {
                        const outputNames = new Set(outputFixtureFiles);
                        const entries = await readdir(dir, { withFileTypes: true });
                        await Promise.all(entries
                            .filter(entry => entry.isFile()
                            // Only valid numbered children are record-owned stale output.
                            // Malformed session-like names stay for the inventory guard to
                            // reject instead of being silently deleted during mutation.
                            && /^session\.[1-9]\d*\.jsonl$/.test(entry.name)
                            && !outputNames.has(entry.name))
                            .map(entry => rm(join(dir, entry.name))));
                        fixtureFiles = outputFixtureFiles;
                    }
                    if (scenario.pinsHeader === true) {
                        const primary = result.sessionLogs[0];
                        const prompts = normalizedSystemPrompts(primary.content, ctx);
                        expect(prompts.length, `${mode} produced no system prompt to snapshot`).toBeGreaterThan(0);
                        const promptSnapshot = formatSystemPromptSnapshot(prompts[0], prompts.slice(1));
                        /* v8 ignore next -- registration guarantees every scenario class has resolved sources. */
                        const promptSource = promptSourceByClass.get(classOf(scenario)) ?? scenario;
                        const promptPath = join(snapshotsDir, promptSource.name, SYSTEM_PROMPT_SNAPSHOT);
                        claimSharedSnapshot(promptClaims, promptPath, scenario.name, promptSnapshot);
                        await writeFile(promptPath, promptSnapshot);
                        const schemaSets = normalizedToolSchemas(primary.content, ctx);
                        expect(schemaSets.length, `${mode} produced no tool schemas to snapshot`).toBeGreaterThan(0);
                        expect(schemaSets.length, `${mode} produced a tool-schema sequence that differs from its prompt sequence`)
                            .toBe(prompts.length);
                        const toolSchemasSnapshot = formatToolSchemasSnapshot(schemaSets[0], schemaSets.slice(1));
                        /* v8 ignore next -- registration guarantees every scenario class has resolved sources. */
                        const schemaSource = schemaSourceByClass.get(classOf(scenario)) ?? scenario;
                        const schemaPath = join(snapshotsDir, schemaSource.name, TOOL_SCHEMAS_SNAPSHOT);
                        claimSharedSnapshot(schemaClaims, schemaPath, scenario.name, toolSchemasSnapshot);
                        await writeFile(schemaPath, toolSchemasSnapshot);
                    }
                    for (const index of childSchemaPins) {
                        const log = result.sessionLogs[index];
                        expect(log, `${mode}: no child session log at index ${index} to snapshot schemas from`)
                            .toBeDefined();
                        const schemaSets = normalizedToolSchemas(log.content, ctx);
                        expect(schemaSets.length, `${mode}: child ${index} produced no tool schemas to snapshot`)
                            .toBeGreaterThan(0);
                        await writeFile(join(dir, childToolSchemasSnapshot(index)), formatToolSchemasSnapshot(schemaSets[0], schemaSets.slice(1)));
                    }
                    for (const index of childPromptPins) {
                        const log = result.sessionLogs[index];
                        expect(log, `${mode}: no child session log at index ${index} to snapshot a prompt from`)
                            .toBeDefined();
                        const prompts = normalizedSystemPrompts(log.content, ctx);
                        expect(prompts.length, `${mode}: child ${index} produced no system prompt to snapshot`)
                            .toBeGreaterThan(0);
                        await writeFile(join(dir, childSystemPromptSnapshot(index)), formatSystemPromptSnapshot(prompts[0]));
                    }
                }
                for (const expected of stdoutExpectedVariants(scenario)) {
                    const stdout = normalizeStdout(result.rawStdout, ctx, { cwdPathMode: expected.cwdPathMode });
                    if (REFRESHING) {
                        await writeFile(join(dir, expected.file), stdout);
                    }
                    await expect(stdout, `${expected.file} mismatch`).toMatchFileSnapshot(join(dir, expected.file));
                }
                // A model turn always produces a log worth comparing; an explicitly
                // authored non-model scenario may opt in independently.
                if (comparesLog) {
                    // The harvested logs (primary-first) must match their committed fixtures 1:1.
                    expect(result.sessionLogs.length, 'this scenario must persist one log per session fixture').toBe(fixtureFiles.length);
                    for (let i = 0; i < fixtureFiles.length; i++) {
                        const harvested = scrub(result.sessionLogs[i].content);
                        const fixture = scrub(await readFile(join(dir, fixtureFiles[i]), 'utf8'));
                        expect(normalizeSessionLog(harvested, ctx), `${fixtureFiles[i]} mismatch`)
                            .toEqual(normalizeSessionLog(fixture, fixtureContext(fixture)));
                    }
                }
                // Every live full header must equal its class pin reconstructed from
                // tokenized JSONL plus readable prompt and structured schema sidecars.
                /* v8 ignore next -- construction guarantees the pin exists; a miss would fail the one-header assertion loudly. */
                const pinningScenario = pinningByClass.get(classOf(scenario)) ?? scenario;
                /* v8 ignore next -- registration guarantees every scenario class has resolved sources. */
                const promptSource = promptSourceByClass.get(classOf(scenario)) ?? pinningScenario;
                /* v8 ignore next -- registration guarantees every scenario class has resolved sources. */
                const schemaSource = schemaSourceByClass.get(classOf(scenario)) ?? pinningScenario;
                const pinningDir = join(snapshotsDir, pinningScenario.name);
                const pinnedFixture = await readFile(join(pinningDir, 'session.jsonl'), 'utf8');
                const pinned = normalizedHeaders(pinnedFixture, fixtureContext(pinnedFixture));
                const promptSnapshot = await readFile(join(snapshotsDir, promptSource.name, SYSTEM_PROMPT_SNAPSHOT), 'utf8');
                const initialPromptSnapshot = initialSystemPromptSnapshot(promptSnapshot);
                expect(pinned.length, `the pinning fixture (${pinningScenario.name}) has an unexpected request/header count`)
                    .toBe(1 + (pinningScenario.expectedHeaderChanges ?? 0));
                const toolSchemasSnapshot = await readFile(join(snapshotsDir, schemaSource.name, TOOL_SCHEMAS_SNAPSHOT), 'utf8');
                const toolSchemas = parseToolSchemasSnapshot(toolSchemasSnapshot);
                const pinnedSchemaSets = [toolSchemas.initial, ...toolSchemas.changes];
                expect(pinnedSchemaSets.length, `the schema source (${schemaSource.name}) has an unexpected tool-schema count`)
                    .toBe(pinned.length);
                const pinnedHeaders = pinned.map((header, index) => restorePinnedToolSchemas(header, pinnedSchemaSets[index]));
                const childPinnedSchemas = new Map();
                for (const index of childSchemaPins) {
                    const sidecar = await readFile(join(dir, childToolSchemasSnapshot(index)), 'utf8');
                    const parsed = parseToolSchemasSnapshot(sidecar);
                    childPinnedSchemas.set(index, [parsed.initial, ...parsed.changes]);
                }
                const childPinnedPrompts = new Map();
                for (const index of childPromptPins) {
                    childPinnedPrompts.set(index, await readFile(join(dir, childSystemPromptSnapshot(index)), 'utf8'));
                }
                for (const [logIndex, log] of result.sessionLogs.entries()) {
                    const childSchemas = childPinnedSchemas.get(logIndex);
                    const expectedChanges = scenario.pinsHeader === true && logIndex === 0
                        ? scenario.expectedHeaderChanges ?? 0
                        : 0;
                    expect(headerChangeCount(log.content), `session ${log.id}: changed request/header count`)
                        .toBe(expectedChanges);
                    const headers = normalizedHeaders(scrubSystemPrompts(log.content), ctx);
                    const prompts = normalizedSystemPrompts(log.content, ctx);
                    const schemaSets = normalizedToolSchemas(log.content, ctx);
                    expect(prompts.length, `session ${log.id}: every request/header must carry a string system prompt`)
                        .toBe(headers.length);
                    expect(schemaSets.length, `session ${log.id}: every request/header must carry an array-valued tools field`)
                        .toBe(headers.length);
                    if (childSchemas !== undefined) {
                        expect(childSchemas.length, `session ${log.id}: ${childToolSchemasSnapshot(logIndex)} has an unexpected tool-schema count`)
                            .toBe(schemaSets.length);
                    }
                    for (const [k, header] of headers.entries()) {
                        const classPin = expectedChanges > 0 ? pinnedHeaders[k] : pinnedHeaders[0];
                        const expected = childSchemas === undefined
                            ? classPin
                            : { ...classPin, tools: childSchemas[k] };
                        expect(header, `session ${log.id}: request/header #${k + 1} diverged from the pinned (${pinningScenario.name}) header`)
                            .toEqual(expected);
                        if (expectedChanges === 0) {
                            // A pinned child owns its whole prompt: its scope-local sections
                            // are exactly what the class pin cannot describe.
                            const childPrompt = childPinnedPrompts.get(logIndex);
                            const promptOrigin = childPrompt === undefined
                                ? `${promptSource.name}/${SYSTEM_PROMPT_SNAPSHOT}`
                                : childSystemPromptSnapshot(logIndex);
                            expect(formatSystemPromptSnapshot(prompts[k]), `session ${log.id}: initial system prompt #${k + 1} diverged from ${promptOrigin}`)
                                .toEqual(childPrompt ?? initialPromptSnapshot);
                        }
                    }
                    if (scenario.pinsHeader === true && logIndex === 0) {
                        expect(formatSystemPromptSnapshot(prompts[0], prompts.slice(1)), `session ${log.id}: changed system prompts diverged from ${promptSource.name}/${SYSTEM_PROMPT_SNAPSHOT}`)
                            .toEqual(promptSnapshot);
                        expect(formatToolSchemasSnapshot(schemaSets[0], schemaSets.slice(1)), `session ${log.id}: changed tool schemas diverged from ${schemaSource.name}/${TOOL_SCHEMAS_SNAPSHOT}`)
                            .toEqual(toolSchemasSnapshot);
                    }
                }
            });
        }
    });
    describe('snapshot fixtures', () => {
        it('every scenario directory is registered (no orphans)', async () => {
            // toMatchFileSnapshot does not prune orphaned expected-output or fixture files, so a
            // renamed/removed scenario could leave a stale dir that nothing exercises.
            // Fail loud on any snapshots/<dir> not present in the scenario table.
            const entries = await readdir(snapshotsDir, { withFileTypes: true });
            const onDisk = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
            const registered = scenarios.map(s => s.name).sort();
            expect(onDisk).toEqual(registered);
        });
        it('every registered scenario has its required fixture files', async () => {
            // Every scenario needs input, stdout, a primary session fixture, and matching optional sidecars.
            for (const { name, overridden, pinsNativeWindowsStdout, pinsChildToolSchemas, pinsChildSystemPrompts } of scenarios) {
                const dir = join(snapshotsDir, name);
                const files = (await readdir(dir, { withFileTypes: true }))
                    .filter(entry => entry.isFile())
                    .map(entry => entry.name);
                const childIndices = (pattern) => new Set(files
                    .map(file => pattern.exec(file))
                    .filter((match) => match !== null)
                    .map(match => Number(match[1])));
                expect(childIndices(/^tool-schemas\.([1-9]\d*)\.expected\.json$/), `${name}: child tool-schema sidecars must match \`pinsChildToolSchemas\``)
                    .toEqual(new Set(pinsChildToolSchemas ?? []));
                expect(childIndices(/^system-prompt\.([1-9]\d*)\.expected\.md$/), `${name}: child system-prompt sidecars must match \`pinsChildSystemPrompts\``)
                    .toEqual(new Set(pinsChildSystemPrompts ?? []));
                expect(existsSync(join(dir, 'input.json')), `${name}/input.json`).toBe(true);
                expect(existsSync(join(dir, 'stdout.expected.jsonl')), `${name}/stdout.expected.jsonl`).toBe(true);
                expect(existsSync(join(dir, WINDOWS_STDOUT_SNAPSHOT)), `${name}/${WINDOWS_STDOUT_SNAPSHOT} presence must match \`pinsNativeWindowsStdout\``).toBe(pinsNativeWindowsStdout === true);
                expect(existsSync(join(dir, 'session.jsonl')), `${name}/session.jsonl`).toBe(true);
                expect(existsSync(join(dir, 'replay.override.json')), `${name}/replay.override.json presence must match \`overridden\``)
                    .toBe(overridden === true);
                expect(existsSync(join(dir, SYSTEM_PROMPT_SNAPSHOT)), `${name}/${SYSTEM_PROMPT_SNAPSHOT} presence must match snapshot-source ownership`)
                    .toBe(promptOwners.has(name));
                expect(existsSync(join(dir, TOOL_SCHEMAS_SNAPSHOT)), `${name}/${TOOL_SCHEMAS_SNAPSHOT} presence must match snapshot-source ownership`)
                    .toBe(schemaOwners.has(name));
                await expect(sessionFixtures(dir), `${name}: session fixture inventory`).resolves.toBeDefined();
            }
        });
        it('exactly one scenario pins the request-header content of each header class', () => {
            // Zero pins would drop a class's structural header surface from the suite entirely; two
            // would split it.
            const pins = new Map();
            for (const scenario of scenarios.filter(s => s.pinsHeader === true)) {
                const cls = classOf(scenario);
                pins.set(cls, [...pins.get(cls) ?? [], scenario.name]);
            }
            expect(Object.fromEntries([...pins].map(([cls, names]) => [cls, names.length]))).toEqual(Object.fromEntries([...pinningByClass.keys()].map(cls => [cls, 1])));
            for (const scenario of scenarios) {
                expect(pinningByClass.has(classOf(scenario)), `class "${classOf(scenario)}" (scenario ${scenario.name}) has a pin`).toBe(true);
            }
        });
        it('every pinning fixture composes one tokenized header sequence with its referenced sidecars', async () => {
            // Assert the committed pin directly because a class containing only its
            // pinning scenario has no non-pinning live run to catch undeclared changes.
            for (const scenario of pinningByClass.values()) {
                /* v8 ignore next -- registration guarantees every pin has resolved sources. */
                const promptSource = promptSourceByClass.get(classOf(scenario)) ?? scenario;
                /* v8 ignore next -- registration guarantees every pin has resolved sources. */
                const schemaSource = schemaSourceByClass.get(classOf(scenario)) ?? scenario;
                const fixture = await readFile(join(snapshotsDir, scenario.name, 'session.jsonl'), 'utf8');
                const headers = normalizedHeaders(fixture, fixtureContext(fixture));
                const promptSnapshot = await readFile(join(snapshotsDir, promptSource.name, SYSTEM_PROMPT_SNAPSHOT), 'utf8');
                expect(headers.length, `${scenario.name}: unexpected request/header count`)
                    .toBe(1 + (scenario.expectedHeaderChanges ?? 0));
                const toolSchemasSnapshot = await readFile(join(snapshotsDir, schemaSource.name, TOOL_SCHEMAS_SNAPSHOT), 'utf8');
                const toolSchemas = parseToolSchemasSnapshot(toolSchemasSnapshot);
                const schemaSets = [toolSchemas.initial, ...toolSchemas.changes];
                expect(schemaSets.length, `${schemaSource.name}: tool-schema sequence must match ${scenario.name}'s header sequence`)
                    .toBe(headers.length);
                for (const [index, header] of headers.entries()) {
                    expect(() => restorePinnedToolSchemas(header, schemaSets[index]), `${scenario.name}: tools must use the sidecar token`)
                        .not.toThrow();
                }
                expect(promptSnapshot.length, `${promptSource.name}/${SYSTEM_PROMPT_SNAPSHOT} must not be empty`).toBeGreaterThan(0);
                expect(promptSnapshot.endsWith('\n'), `${promptSource.name}/${SYSTEM_PROMPT_SNAPSHOT} must end in a newline`).toBe(true);
                expect(toolSchemasSnapshot, `${schemaSource.name}/${TOOL_SCHEMAS_SNAPSHOT} must use canonical JSON formatting`)
                    .toBe(formatToolSchemasSnapshot(toolSchemas.initial, toolSchemas.changes));
                expect(headerChangeCount(fixture), `${scenario.name}: a pinning fixture must carry exactly its declared changed headers`)
                    .toBe(scenario.expectedHeaderChanges ?? 0);
            }
        });
        it('stores each distinct prompt and tool-schema snapshot once', async () => {
            const prompts = await Promise.all([...promptOwners].map(async (owner) => ({
                path: `${owner}/${SYSTEM_PROMPT_SNAPSHOT}`,
                content: await readFile(join(snapshotsDir, owner, SYSTEM_PROMPT_SNAPSHOT), 'utf8'),
            })));
            const schemas = await Promise.all([...schemaOwners].map(async (owner) => ({
                path: `${owner}/${TOOL_SCHEMAS_SNAPSHOT}`,
                content: await readFile(join(snapshotsDir, owner, TOOL_SCHEMAS_SNAPSHOT), 'utf8'),
            })));
            assertUniqueSnapshotContents('system-prompt', prompts);
            assertUniqueSnapshotContents('tool-schema', schemas);
        });
        it('every declared child sidecar is canonical and names a real child', async () => {
            for (const scenario of scenarios) {
                const dir = join(snapshotsDir, scenario.name);
                const files = await sessionFixtures(dir);
                for (const index of scenario.pinsChildToolSchemas ?? []) {
                    expect(files[index], `${scenario.name}: child schema pin ${index} must name an existing session.<n>.jsonl fixture`)
                        .toBeDefined();
                    const file = childToolSchemasSnapshot(index);
                    const sidecar = await readFile(join(dir, file), 'utf8');
                    const parsed = parseToolSchemasSnapshot(sidecar);
                    expect(sidecar, `${scenario.name}/${file} must use canonical JSON formatting`)
                        .toBe(formatToolSchemasSnapshot(parsed.initial, parsed.changes));
                    expect(parsed.initial.length, `${scenario.name}/${file} must pin at least one schema`)
                        .toBeGreaterThan(0);
                }
                for (const index of scenario.pinsChildSystemPrompts ?? []) {
                    expect(files[index], `${scenario.name}: child prompt pin ${index} must name an existing session.<n>.jsonl fixture`)
                        .toBeDefined();
                    const file = childSystemPromptSnapshot(index);
                    const sidecar = await readFile(join(dir, file), 'utf8');
                    /* v8 ignore next -- registration guarantees every scenario class has resolved sources. */
                    const promptSource = promptSourceByClass.get(classOf(scenario)) ?? scenario;
                    const classPin = await readFile(join(snapshotsDir, promptSource.name, SYSTEM_PROMPT_SNAPSHOT), 'utf8');
                    assertChildSystemPromptSnapshot(sidecar, initialSystemPromptSnapshot(classPin), `${scenario.name}/${file}`);
                }
            }
        });
        it('every committed JSONL has valid tool results and canonical fixture storage', async () => {
            // Prompts and schemas always leave JSONL. Header pins retain prefixes;
            // every other fixture tokenizes those too. Portable cwd tokens never
            // retain a platform realpath prefix. Fixed-point checks make these
            // storage rules fail loud.
            for (const scenario of scenarios) {
                const dir = join(snapshotsDir, scenario.name);
                const files = await sessionFixtures(dir);
                for (const file of files) {
                    const fixture = await readFile(join(dir, file), 'utf8');
                    expect(unknownToolCallIds(fixture), `${scenario.name}/${file} contains UNKNOWN_TOOL`)
                        .toEqual([]);
                    expect(fixture, `${scenario.name}/${file} carries a non-canonical macOS cwd token`)
                        .not.toContain('/private{{cwd}}');
                    expect(scrubSystemPrompts(fixture), `${scenario.name}/${file} carries an unscrubbed system prompt`)
                        .toEqual(fixture);
                    expect(scrubToolSchemas(fixture), `${scenario.name}/${file} carries unscrubbed tool schemas`)
                        .toEqual(fixture);
                    if (scenario.pinsHeader !== true) {
                        expect(scrubRequestHeaders(fixture), `${scenario.name}/${file} carries unscrubbed header content`)
                            .toEqual(fixture);
                    }
                }
            }
        });
    });
}
//# sourceMappingURL=suite.js.map