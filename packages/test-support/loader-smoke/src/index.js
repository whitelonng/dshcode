/**
 * Shared subprocess harness for keyless example smokes that boot a real
 * `cordis.yml` through an app bin and Cordis Loader.
 *
 * It also owns the mode-aware launch resolver every example subprocess harness shares
 * ({@link resolveExampleLaunch}): booting an example bin from TypeScript source under `tsx` (the
 * zero-build dev path, resolving `@deepseek-ai/dsh-*` / `@cordisjs/*` through the tsconfig `paths`
 * map) or from built `lib/` under plain Node (resolving bare packages through real `exports`, as an
 * installed consumer does, while Node type-strips relative example-local TypeScript plugins).
 *
 * @module @deepseek-ai/dsh-loader-smoke
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
export { runFixtureTurn, } from "./agent-turn.js";
const DEFAULT_PROCESS_TIMEOUT_MS = 30_000;
/** Vitest deadline that leaves room for the subprocess-owned 30-second diagnostic timeout. */
export const LOADER_SMOKE_TEST_TIMEOUT_MS = DEFAULT_PROCESS_TIMEOUT_MS + 15_000;
/** Environment variable selecting the mode; CI sets it to `lib`, dev leaves it unset (`src`). */
export const EXAMPLE_MODE_ENV = 'DSH_EXAMPLE_MODE';
/**
 * Parse an {@link ExampleMode} from a raw string, defaulting to `src` when absent so an unset
 * environment reproduces the dev/tsx behavior. Throws on any other value rather than silently
 * falling back, so a typo in a gate's env fails loud.
 * @param raw - the raw value; defaults to `process.env.DSH_EXAMPLE_MODE`.
 * @returns the validated mode.
 */
export function resolveExampleMode(raw = process.env[EXAMPLE_MODE_ENV]) {
    switch (raw) {
        case undefined:
        case '':
        case 'src':
            return 'src';
        case 'lib':
            return 'lib';
        default:
            throw new Error(`${EXAMPLE_MODE_ENV} must be 'src' or 'lib', got ${JSON.stringify(raw)}.`);
    }
}
/** Derive the built-lib bin (`<pkg>/lib/<name>.js`) from a source bin (`<pkg>/src/<name>.ts`). */
function toLibBin(srcBin) {
    const markerLength = '/src/'.length;
    const cut = Math.max(srcBin.lastIndexOf('/src/'), srcBin.lastIndexOf('\\src\\'));
    if (cut === -1) {
        throw new Error(`resolveExampleLaunch: expected a "/src/" segment or Windows equivalent in bin path ${JSON.stringify(srcBin)}.`);
    }
    const separator = srcBin.slice(cut, cut + 1);
    const tail = srcBin.slice(cut + markerLength).replace(/\.ts$/, '.js');
    return `${srcBin.slice(0, cut)}${separator}lib${separator}${tail}`;
}
/**
 * Resolve how to spawn an example bin in the selected mode.
 *
 * `src` yields `node --import <tsx> <srcBin> <configArgs>` with `TSX_TSCONFIG_PATH` set so the
 * tsconfig `paths` map resolves workspace imports to source. `lib` yields
 * `node <libBin> <configArgs>` under plain Node with no tsx and no paths map, so
 * bare package plugins resolve through real package `exports` into built `lib/`; relative example-local
 * TypeScript plugins remain source files loaded through Node's built-in type stripping. Bare resolution
 * requires the config to live below a workspace that declares its `cordis.yml` package dependencies.
 *
 * @param options - the source bin, config arguments, mode, and environment.
 * @returns the command, argument vector, and mode-specific environment to spawn with.
 */
export function resolveExampleLaunch(options) {
    const mode = options.mode ?? resolveExampleMode();
    const configArgs = options.configArgs ?? [];
    const env = { ...options.env };
    if (mode === 'src') {
        if (options.tsconfigPath === undefined) {
            throw new Error("resolveExampleLaunch: 'src' mode needs tsconfigPath for the workspace paths map.");
        }
        const tsxLoader = import.meta.resolve('tsx');
        env.TSX_TSCONFIG_PATH = options.tsconfigPath;
        return { command: process.execPath, args: ['--import', tsxLoader, options.srcBin, ...configArgs], env };
    }
    return { command: process.execPath, args: [options.libBin ?? toLibBin(options.srcBin), ...configArgs], env };
}
/**
 * Boot one real Loader tree from an isolated cwd, close stdin immediately, and
 * await a clean exit. The helper owns process kill and temp-directory cleanup on
 * every outcome, and picks src/lib via {@link resolveExampleLaunch}.
 * @param options - example paths, mode, environment, and diagnostic identity.
 * @returns captured stdout and stderr after a zero exit.
 */
export async function runLoaderSmoke(options) {
    const cwd = await mkdtemp(join(tmpdir(), options.tempDirPrefix));
    const processTimeoutMs = options.processTimeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    try {
        await options.prepare?.(cwd);
        const launch = resolveExampleLaunch({
            srcBin: options.binScript,
            libBin: options.libBinScript,
            configArgs: options.binArgs ?? [options.configPath],
            ...options.mode !== undefined ? { mode: options.mode } : {},
            tsconfigPath: options.tsconfigPath,
            env: { DSH_HOME: join(cwd, '.dsh'), DSH_AGENTS_HOME: join(cwd, '.agents'), ...options.env },
        });
        // `input: ''` writes nothing and closes stdin — the fixture-visible
        // stdin-close contract. `reject: false` folds spawn errors, the SIGKILL
        // deadline, and nonzero exits into independent result fields, so the
        // diagnostics below embed both streams on every failure.
        const result = await execa(launch.command, launch.args, {
            cwd,
            env: launch.env,
            input: '',
            timeout: processTimeoutMs,
            killSignal: 'SIGKILL',
            reject: false,
            stripFinalNewline: false,
        });
        if (result.timedOut) {
            throw new Error(`${options.label} did not exit within ${processTimeoutMs / 1_000}s. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
        }
        const expectedExitCode = options.expectedExitCode ?? 0;
        if (result.exitCode !== expectedExitCode) {
            throw new Error(`${options.label} exited ${String(result.exitCode)} (expected ${expectedExitCode}). stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
        }
        await options.inspect?.(cwd);
        return { stdout: result.stdout, stderr: result.stderr };
    }
    finally {
        await rm(cwd, { recursive: true, force: true });
    }
}
//# sourceMappingURL=index.js.map