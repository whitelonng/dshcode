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
export { runFixtureTurn, type FixtureTurnOptions, type FixtureTurnResult, } from './agent-turn.ts';
/** Vitest deadline that leaves room for the subprocess-owned 30-second diagnostic timeout. */
export declare const LOADER_SMOKE_TEST_TIMEOUT_MS: number;
/** Which artifact an example bin is booted from: unbuilt `src` via tsx, or built `lib` via plain Node. */
export type ExampleMode = 'src' | 'lib';
/** Environment variable selecting the mode; CI sets it to `lib`, dev leaves it unset (`src`). */
export declare const EXAMPLE_MODE_ENV = "DSH_EXAMPLE_MODE";
/**
 * Parse an {@link ExampleMode} from a raw string, defaulting to `src` when absent so an unset
 * environment reproduces the dev/tsx behavior. Throws on any other value rather than silently
 * falling back, so a typo in a gate's env fails loud.
 * @param raw - the raw value; defaults to `process.env.DSH_EXAMPLE_MODE`.
 * @returns the validated mode.
 */
export declare function resolveExampleMode(raw?: string | undefined): ExampleMode;
/** Inputs to {@link resolveExampleLaunch}. */
export interface ExampleLaunchOptions {
    /** Absolute path to the example bin's TypeScript source entry (`<pkg>/src/bin.ts`); the `lib` bin is derived from it. */
    readonly srcBin: string;
    /** Explicit plain-Node entry for `lib` mode; test fixtures may point this at Node-type-strippable TypeScript. */
    readonly libBin?: string | undefined;
    /** Arguments passed after the bin — the config, positional (`[configPath]`) or flagged (`['--config', configPath]`). */
    readonly configArgs?: readonly string[];
    /** The mode to launch in; defaults to {@link resolveExampleMode} of the environment. */
    readonly mode?: ExampleMode;
    /** Absolute repo tsconfig whose `paths` map resolves unbuilt workspace imports. Required in `src` mode, ignored in `lib`. */
    readonly tsconfigPath?: string;
    /** Extra environment entries the mode-specific ones layer over; the caller then merges the result over `process.env`. */
    readonly env?: NodeJS.ProcessEnv;
}
/** The resolved spawn: `spawn(command, args, { env: { ...process.env, ...env } })`. */
export interface ExampleLaunch {
    /** The executable to spawn — always the current Node binary. */
    readonly command: string;
    /** Node flags, the resolved bin, then the caller's `configArgs`. */
    readonly args: string[];
    /** Mode-specific environment (`TSX_TSCONFIG_PATH` in `src`, nothing added in `lib`) layered over the caller's `env`. */
    readonly env: NodeJS.ProcessEnv;
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
export declare function resolveExampleLaunch(options: ExampleLaunchOptions): ExampleLaunch;
/** Inputs that vary between real-Loader example smokes. */
export interface LoaderSmokeOptions {
    /** Human-readable example name used in failure diagnostics. */
    readonly label: string;
    /** Prefix for the isolated temporary process cwd. */
    readonly tempDirPrefix: string;
    /** Absolute app-bin source path (`<pkg>/src/bin.ts`); the `lib` bin is derived from it. */
    readonly binScript: string;
    /** Explicit plain-Node entry for `lib` mode; intended for test fixtures outside a package `src/` tree. */
    readonly libBinScript?: string | undefined;
    /** Absolute real Loader config path, passed as the sole bin argument by default. */
    readonly configPath: string;
    /** Complete argv after the bin path; overrides the default `[configPath]`. */
    readonly binArgs?: readonly string[];
    /** Absolute repo tsconfig path used for unbuilt workspace-package resolution (required in `src` mode). */
    readonly tsconfigPath: string;
    /** Boot from source via tsx (`src`) or built lib via plain Node (`lib`); defaults to the environment's mode. */
    readonly mode?: ExampleMode;
    /** Environment overrides layered over the parent and isolated DSH homes. */
    readonly env?: Readonly<NodeJS.ProcessEnv>;
    /** Process deadline override for harness tests. */
    readonly processTimeoutMs?: number;
    /** Optional world-state setup run in the isolated cwd before process start. */
    readonly prepare?: (cwd: string) => Promise<void> | void;
    /** Optional world-state assertion run in the isolated cwd before cleanup. */
    readonly inspect?: (cwd: string) => Promise<void> | void;
    /**
     * Exact process exit code this smoke expects; defaults to `0`. Scenarios
     * pinning a designed failure surface (a one-shot turn ending in an error
     * result) declare its nonzero exit here, and a run that exits any other
     * way — including succeeding — still fails the smoke.
     */
    readonly expectedExitCode?: number;
}
/** Captured output from a Loader smoke that exited successfully. */
export interface LoaderSmokeResult {
    /** Complete stdout after clean exit. */
    readonly stdout: string;
    /** Complete stderr after clean exit. */
    readonly stderr: string;
}
/**
 * Boot one real Loader tree from an isolated cwd, close stdin immediately, and
 * await a clean exit. The helper owns process kill and temp-directory cleanup on
 * every outcome, and picks src/lib via {@link resolveExampleLaunch}.
 * @param options - example paths, mode, environment, and diagnostic identity.
 * @returns captured stdout and stderr after a zero exit.
 */
export declare function runLoaderSmoke(options: LoaderSmokeOptions): Promise<LoaderSmokeResult>;
//# sourceMappingURL=index.d.ts.map