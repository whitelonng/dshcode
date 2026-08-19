/**
 * Shared subprocess harness for ACP snapshot suites. A library module driven by
 * the suite factory in ./suite.ts (and directly by harness-level specs); each
 * example's `*.snapshot.ts` names its own agent-under-test paths.
 *
 * It boots the REAL agent bin subprocess via the cordis Loader (so the
 * export-shape bug class stays guarded — see docs/postmortem/0001), drives it
 * over real ACP JSON-RPC stdio with a deterministic input script, tees raw
 * stdout (for the expected-output and purity checks) into an SDK `ClientSideConnection`,
 * and — in record mode — harvests the persisted session JSONL after a graceful
 * shutdown flush. The pure normalizers in ./normalize.ts turn the captured
 * stdout frames and the session-log events into stable, snapshot-able text.
 *
 * See .agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md.
 *
 * @module @deepseek-ai/dsh-acp-snapshot/harness
 */
import { type ContentBlock as AcpContentBlock } from '@agentclientprotocol/sdk';
import { type AgentUnderTest } from './launcher.ts';
export type { AgentUnderTest } from './launcher.ts';
/**
 * One step of a scenario's deterministic input script (`input.json`). The
 * harness interprets these in order. `newSession` captures the server-issued
 * (random) session id into a `{{sessionId}}` variable that later steps
 * reference, since a committed file cannot know the id in advance.
 *
 * `promptAndCancel` starts a prompt without awaiting completion, waits for a
 * readiness condition, then cancels and awaits completion. Its optional
 * `waitForFile` observes a cwd-relative marker; otherwise it waits for the
 * durable turn start. The standalone `waitForFile` holds the next script step
 * behind the same marker.
 * `promptAndWaitForAgentMessage` arms an exact text-chunk waiter before sending
 * the prompt, then keeps the application live until that later update arrives.
 * `waitForTurnStart` waits for an open durable turn, optionally at or beyond a
 * specified turn number. `waitForTurnEnd` holds the subprocess open until the
 * selected session's latest complete raw-JSONL turn boundary is `turn/end`.
 * `waitForGoalPhase` waits for the latest durable goal snapshot to reach one phase.
 * `waitForInboxMessage` waits for inserted inbox text containing a scenario marker.
 * `waitForSubagentTurnEnd` waits until one background child has persisted a
 * closed model-work turn after its own descriptor; child progress has no ACP
 * update to wait on.
 * `waitForTitleAfterTurnEnd` additionally waits for a later durable title.
 * `waitForEventAfterTurnEnd` waits until a complete record of the given event
 * type follows the latest closed turn — for scenarios whose asserted state
 * (e.g. a goal pause) is appended only after cancellation reaches idle.
 * A standalone `cancel` may also wait for a cwd-relative readiness marker.
 * All wait timeouts default to 10s.
 */
export type InputStep = {
    op: 'initialize';
} | {
    op: 'newSession';
} | {
    op: 'newSessionExpectError';
    additionalDirectories?: string[];
} | {
    op: 'prompt';
    text: string;
} | {
    op: 'promptContent';
    content: AcpContentBlock[];
} | {
    op: 'promptAndWaitForAgentMessage';
    text: string;
    waitForText: string;
} | {
    op: 'promptExpectError';
    text: string;
} | {
    op: 'promptAndCancel';
    text: string;
    waitForFile?: {
        path: string;
        timeoutMs?: number;
    };
} | {
    op: 'waitForFile';
    path: string;
    timeoutMs?: number;
} | {
    op: 'waitForTurnStart';
    minimumTurn?: number;
    timeoutMs?: number;
} | {
    op: 'waitForTurnEnd';
    timeoutMs?: number;
} | {
    op: 'waitForSubagentTurnEnd';
    child?: number;
    minimumTurn?: number;
    timeoutMs?: number;
} | {
    op: 'waitForGoalPhase';
    phase: 'active' | 'paused' | 'blocked' | 'complete';
    timeoutMs?: number;
} | {
    op: 'waitForInboxMessage';
    text: string;
    timeoutMs?: number;
} | {
    op: 'waitForTitleAfterTurnEnd';
    timeoutMs?: number;
} | {
    op: 'waitForEventAfterTurnEnd';
    type: string;
    timeoutMs?: number;
} | {
    op: 'cancel';
    waitForFile?: {
        path: string;
        timeoutMs?: number;
    };
};
/** A scenario's `input.json`: an ordered list of input steps. */
export interface InputScript {
    steps: InputStep[];
    /**
     * Ordered answers for the agent's `session/request_permission` round-trips,
     * consumed FIFO — the Nth request gets the Nth answer. Each answer selects
     * by option KIND: option ids are agent-issued randoms a committed script
     * cannot know, while kinds are the ACP-stable vocabulary, so the client maps
     * kind → the offered `optionId` at answer time. A request beyond the queue
     * (or with no queue at all) is answered `cancelled` — the stub behavior a
     * scenario without approvals relies on. A scripted kind the request does
     * not offer REJECTS the run: the scenario scripted an impossible selection,
     * and {@link runScenario} throws once the in-flight step settles (the
     * agent itself just sees `cancelled`, so it cannot absorb the bug).
     */
    permissionAnswers?: PermissionAnswer[];
}
/** One scripted answer to a permission request: which offered option kind to select. */
export interface PermissionAnswer {
    /** The `PermissionOption.kind` to select (`allow_once`, `reject_always`, …). */
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}
/** One harvested session log plus the identifying facts off its header line. */
export interface HarvestedLog {
    /** The recorded session id (header `id`). */
    id: string;
    /** Session creation time (header `createdAt`) — the child-ordering key. */
    createdAt: number;
    /** The parent session id, if this log is a subagent child (header `parentSession`). */
    parentSession?: string;
    /** The full `.jsonl` file content. */
    content: string;
}
/** The result of running a scenario: raw stdout + the harvested session log(s). */
export interface RunResult {
    /** Raw stdout bytes (decoded utf8), every newline-delimited JSON-RPC frame. */
    rawStdout: string;
    /** stderr (for diagnostics on failure). */
    stderr: string;
    /** The session id the server issued (undefined if no session was created). */
    sessionId?: string;
    /** The generated cwd the session ran in (the bash workspace). */
    cwd: string;
    /** Filesystem-resolved spellings of {@link cwd} that child processes may report. */
    cwdAliases: string[];
    /**
     * Every persisted session log harvested after the run, ordered primary-first:
     * the top-level (parent) session — the one with no `parentSession` — then each
     * subagent child by ascending `createdAt`. A single-session scenario harvests
     * exactly one; a nested-agent scenario harvests the parent plus one per child.
     */
    sessionLogs: HarvestedLog[];
}
/** How to run one scenario: the agent to boot, the mode, and the fixture wiring. */
export interface RunOptions {
    /** The agent composition to boot. */
    agent: AgentUnderTest;
    /** `replay` (default, keyless) or `record` (real API, harvests the log). */
    mode: 'replay' | 'record';
    /** Scenario-specific deployment environment layered into the subprocess. */
    env?: NodeJS.ProcessEnv;
    /** The recorded session JSONL fixture path (replay reads it; record writes near it). */
    fixtureFile: string;
    /** Optional sidecar override path (replay). */
    overrideFile?: string;
    /**
     * Recorded SUBAGENT child-session fixture paths (replay). A nested-agent
     * scenario ships one per child (`session.1.jsonl`, …); the harness forwards
     * them to `dsh-llm-replay` via `$DSH_SNAPSHOT_CHILD_FILES` so each child
     * session replays from its own recorded script. Empty for single-session
     * scenarios. Ignored in record mode (children are harvested, not replayed).
     */
    childFiles?: string[];
    /**
     * Optional `<scenario>/workspace/` directory whose contents are copied into
     * the generated cwd BEFORE the run — the standard way to seed files the agent
     * operates on (a file to read, edit, or grep). Absent for scenarios that
     * start from an empty workspace.
     */
    workspaceDir?: string;
    /**
     * Optional final workspace preparation, run after {@link workspaceDir} is
     * copied and before the agent starts. This is for fixtures that cannot be
     * represented portably in Git (for example, a POSIX-only filename that is
     * invalid on Windows); ordinary seeded files belong in `workspaceDir`.
     */
    prepareWorkspace?: (cwd: string) => void | Promise<void>;
    /**
     * Parent directory for the generated session cwd. Defaults to
     * `os.tmpdir()`. A scenario that must distinguish its workspace from the
     * sandbox's always-writable temporary roots can place the generated child
     * under `os.homedir()` instead. The harness removes only that generated
     * child, never the supplied parent.
     */
    workspaceParent?: string;
    /**
     * Alternate LIVE config path for the boot (absolute), overriding
     * {@link AgentUnderTest.configPath} for this run. A scenario needing a
     * differently-composed tree (the Code Mode scenarios) ships an overlay
     * whose basename still ends in `cordis.yml`, so the bin's replay swap
     * resolves the sibling `*cordis.snapshot.yml` the same way it does for
     * the default.
     */
    configPath?: string;
}
/**
 * Derive one stable, fixed-length spill root owned by this scenario.
 * Windows uses a two-character-shorter root because drive resolution adds its drive prefix.
 * @param fixtureFile - The scenario fixture whose parent directory provides the stable identity.
 * @param platform - the host platform, injectable for unit coverage.
 * @returns the root-relative snapshot spill directory.
 */
export declare function snapshotSpillRoot(fixtureFile: string, platform?: NodeJS.Platform): string;
/**
 * Run a scenario end-to-end against a freshly-spawned subprocess. Owns the
 * child and its generated dirs; always tears them down. Returns the captured stdout
 * and (record mode) the harvested session-log path.
 *
 * @param input The scenario's input script (steps + optional permission answers).
 * @param opts The agent to boot, the mode, and the fixture wiring.
 * @returns The captured stdout/stderr, session id, generated cwd, and harvested logs.
 */
export declare function runScenario(input: InputScript, opts: RunOptions): Promise<RunResult>;
//# sourceMappingURL=harness.d.ts.map