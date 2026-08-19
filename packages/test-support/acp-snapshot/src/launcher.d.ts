/**
 * Shared launcher for ACP tests that drive an agent subprocess over JSON-RPC
 * stdio. It owns source-or-built launch resolution, workspace environment,
 * stdout tee, SDK client, update collection, permission fallback, and process
 * shutdown so e2e and snapshot suites do not each reconstruct that boundary.
 *
 * @module @deepseek-ai/dsh-acp-snapshot/launcher
 */
import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { ClientSideConnection, type RequestPermissionRequest, type RequestPermissionResponse, type SessionNotification } from '@agentclientprotocol/sdk';
/** The source/built agent entry, leaf config, and workspace tsconfig an ACP test boots. */
export interface AgentUnderTest {
    /** The agent source bin entry (for example `packages/examples/acp-demo/src/bin.ts`). */
    binScript: string;
    /** Explicit built-mode entry for fixtures whose source path is not under `src/`. */
    libBinScript?: string | undefined;
    /** The leaf `cordis.yml` loaded by the bin. */
    configPath: string;
    /** The repo tsconfig whose paths resolve unbuilt workspace imports. */
    tsconfigPath: string;
}
/** Options for one ACP test subprocess. */
export interface AcpTestLaunchOptions {
    /** The agent composition to boot. */
    agent: AgentUnderTest;
    /** Process cwd and default session-home root. */
    cwd: string;
    /** Alternate leaf config for this launch. */
    configPath?: string;
    /** Extra environment values layered over the parent environment. */
    env?: NodeJS.ProcessEnv;
    /** Permission handler; omitted requests fail closed as `cancelled`. */
    requestPermission?: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
}
/** A running ACP test process and its captured client-side outputs. */
export interface LaunchedAcpTestAgent {
    /** The child process, exposed for process-level assertions. */
    child: ChildProcessWithoutNullStreams;
    /** Resolve when the OS spawns the child; reject with its asynchronous spawn failure. */
    spawned: Promise<void>;
    /** The SDK connection backed by the child's stdio. */
    client: ClientSideConnection;
    /** Session updates in receive order. */
    updates: SessionNotification['update'][];
    /** Decode all stdout bytes captured so far. */
    rawStdout(): string;
    /** Decode all stderr chunks captured so far. */
    stderr(): string;
    /** Resolve when a future session update matches the predicate. */
    waitForUpdate(match: (update: SessionNotification['update']) => boolean): Promise<SessionNotification['update']>;
    /** Close the process and drain its streams and callbacks; rejects promptly if fallback termination is refused. */
    close(signal?: NodeJS.Signals): Promise<void>;
}
/**
 * Boot an ACP agent subprocess and connect an SDK client to its stdio.
 *
 * @param options Agent paths, cwd, environment, and optional permission handler.
 * @returns The running process, connected client, captures, and shutdown handle.
 */
export declare function launchAcpTestAgent(options: AcpTestLaunchOptions): LaunchedAcpTestAgent;
//# sourceMappingURL=launcher.d.ts.map