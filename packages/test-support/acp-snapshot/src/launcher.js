/**
 * Shared launcher for ACP tests that drive an agent subprocess over JSON-RPC
 * stdio. It owns source-or-built launch resolution, workspace environment,
 * stdout tee, SDK client, update collection, permission fallback, and process
 * shutdown so e2e and snapshot suites do not each reconstruct that boundary.
 *
 * @module @deepseek-ai/dsh-acp-snapshot/launcher
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream, } from '@agentclientprotocol/sdk';
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke';
const EXIT_MARKER_GRACE_MS = 250;
/**
 * Boot an ACP agent subprocess and connect an SDK client to its stdio.
 *
 * @param options Agent paths, cwd, environment, and optional permission handler.
 * @returns The running process, connected client, captures, and shutdown handle.
 */
export function launchAcpTestAgent(options) {
    const { agent, cwd } = options;
    const launch = resolveExampleLaunch({
        srcBin: agent.binScript,
        libBin: agent.libBinScript,
        configArgs: ['--config', options.configPath ?? agent.configPath],
        tsconfigPath: agent.tsconfigPath,
        env: {
            ...options.env,
            DSH_HOME: join(cwd, '.dsh'),
            DSH_AGENTS_HOME: join(cwd, '.agents'),
        },
    });
    const child = spawn(launch.command, launch.args, {
        cwd,
        env: { ...process.env, ...launch.env },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    // A spawn-level failure is an asynchronous `error` event. Observe it in the
    // same tick as spawn so a missing cwd or OS rejection cannot crash the test
    // runner, then make startup and shutdown surface the original error.
    // Keep observing after the first error: a fallback kill attempted during
    // shutdown may itself report another process error, which must not become an
    // unhandled EventEmitter error after the promise has already settled.
    const childFailure = new Promise(resolve => child.on('error', resolve));
    const spawned = Promise.race([
        new Promise(resolve => child.once('spawn', resolve)),
        childFailure.then((error) => { throw error; }),
    ]);
    // `spawned` is public and close() also awaits it, but a caller may ignore both.
    // Keep that misuse from turning the already-observed child error into an
    // unhandled promise rejection.
    void spawned.catch(() => undefined);
    const stderrChunks = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    const rawBuffers = [];
    const passthrough = new Readable({ read() { } });
    const updates = [];
    const updateWaiters = [];
    let updateStreamFailure;
    const closeUpdateStream = () => {
        if (updateStreamFailure !== undefined)
            return;
        updateStreamFailure = new Error('ACP test agent update stream closed before a matching session update arrived');
        for (const waiter of updateWaiters.splice(0))
            waiter.reject(updateStreamFailure);
    };
    child.stdout.on('data', (buffer) => {
        rawBuffers.push(buffer);
        passthrough.push(buffer);
    });
    child.stdout.on('end', () => {
        passthrough.push(null);
    });
    const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(passthrough));
    const inFlightClientCallbacks = new Set();
    const trackClientCallback = (callback) => {
        const pending = Promise.resolve().then(callback);
        inFlightClientCallbacks.add(pending);
        const untrack = () => { inFlightClientCallbacks.delete(pending); };
        void pending.then(untrack, untrack);
        return pending;
    };
    const requestPermission = options.requestPermission
        ?? (() => Promise.resolve({ outcome: { outcome: 'cancelled' } }));
    const makeClient = (_agent) => ({
        sessionUpdate(params) {
            return trackClientCallback(() => {
                updates.push(params.update);
                for (let index = updateWaiters.length - 1; index >= 0; index--) {
                    const waiter = updateWaiters[index];
                    /* v8 ignore next 1 -- index is bounded by the array length */
                    if (waiter === undefined)
                        continue;
                    let matches;
                    try {
                        matches = waiter.match(params.update);
                    }
                    catch (error) {
                        updateWaiters.splice(index, 1);
                        waiter.reject(error);
                        continue;
                    }
                    if (!matches)
                        continue;
                    updateWaiters.splice(index, 1);
                    waiter.resolve(params.update);
                }
            });
        },
        requestPermission: params => trackClientCallback(() => requestPermission(params)),
    });
    const client = new ClientSideConnection(makeClient, stream);
    // `exit` only reports the parent process's status. Descendants may retain
    // inherited stdout/stderr handles and buffered ACP frames may still be
    // crossing the SDK parser. Node's `close` follows stdio closure; the SDK's
    // `closed` follows parser exhaustion. Capture both eagerly so a caller that
    // invokes close after process exit still joins the complete drain boundary.
    const stdioClosed = new Promise(resolve => child.once('close', () => { resolve(); }));
    const drained = Promise.all([stdioClosed, client.closed]).then(async () => {
        // The ACP SDK's readable loop dispatches client callbacks without awaiting
        // them. Once `closed` settles no new callbacks can start, but callbacks
        // already in flight still belong to this launch's teardown boundary.
        while (inFlightClientCallbacks.size > 0) {
            await Promise.allSettled([...inFlightClientCallbacks]);
        }
    });
    // A caller may await a pending update without calling close(). Make natural
    // stream exhaustion terminal for those waiters too, but only after the
    // parser has dispatched every buffered frame.
    void client.closed.then(closeUpdateStream);
    return {
        child,
        spawned,
        client,
        updates,
        rawStdout: () => Buffer.concat(rawBuffers).toString('utf8'),
        stderr: () => stderrChunks.join(''),
        waitForUpdate(match) {
            if (updateStreamFailure !== undefined)
                return Promise.reject(updateStreamFailure);
            return new Promise((resolve, reject) => updateWaiters.push({ match, resolve, reject }));
        },
        async close(signal) {
            try {
                await spawned;
            }
            catch (error) {
                await drained;
                closeUpdateStream();
                throw error;
            }
            if (!isRunning(child)) {
                await drained;
                closeUpdateStream();
                return;
            }
            const exited = waitForExit(child);
            if (signal === undefined)
                child.stdin.end();
            else
                child.kill(signal);
            const failure = await Promise.race([
                exited.then(() => undefined),
                childFailure,
            ]);
            if (failure === undefined) {
                await drained;
                closeUpdateStream();
                return;
            }
            const propagateFailureAfterDrain = async () => {
                await drained;
                closeUpdateStream();
                throw failure;
            };
            // Windows implements the supported signal names as forced termination. The exit markers
            // may therefore arrive after the error wins the race above but before fallback begins.
            if (!isRunning(child) || await exitMarkerWithinGrace(exited))
                return propagateFailureAfterDrain();
            // An `error` after spawn is not an exit edge: in particular, a failed
            // signal can leave the subprocess live. Force termination, await the
            // already-observed exit edge, and only then propagate the child error so
            // callers may safely remove cwd/session resources after close rejects.
            const fallbackError = Promise.withResolvers();
            const observeFallbackError = (error) => { fallbackError.resolve(error); };
            child.once('error', observeFallbackError);
            if (!child.kill('SIGKILL')) {
                child.off('error', observeFallbackError);
                // A successful earlier signal may win between the live check and this fallback call.
                // In that case `kill()` correctly reports no process to signal; the original child error
                // remains the shutdown result once inherited stdio and callbacks have drained.
                if (!isRunning(child) || await exitMarkerWithinGrace(exited))
                    return propagateFailureAfterDrain();
                closeUpdateStream();
                throw new AggregateError([failure, new Error('Fallback SIGKILL was not accepted by the child process')], 'ACP test agent failed and fallback termination was refused');
            }
            const fallbackFailure = await Promise.race([
                exited.then(() => undefined),
                fallbackError.promise,
            ]);
            child.off('error', observeFallbackError);
            if (fallbackFailure !== undefined) {
                closeUpdateStream();
                throw new AggregateError([failure, fallbackFailure], 'ACP test agent failed and fallback termination was refused');
            }
            return propagateFailureAfterDrain();
        },
    };
}
/** Resolve once a running child exits. */
function waitForExit(child) {
    return new Promise(resolve => child.once('exit', () => { resolve(); }));
}
/** Give an accepted Windows termination request a bounded window to publish its exit marker. */
function exitMarkerWithinGrace(exited) {
    return Promise.race([
        exited.then(() => true),
        new Promise((resolve) => {
            const timer = setTimeout(() => { resolve(false); }, EXIT_MARKER_GRACE_MS);
            timer.unref();
        }),
    ]);
}
/** Whether the child still lacks either OS termination marker. */
function isRunning(child) {
    return child.exitCode === null && child.signalCode === null;
}
//# sourceMappingURL=launcher.js.map