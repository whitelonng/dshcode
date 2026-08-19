/**
 * @deepseek-ai/dsh-cmdline — the command line a dsh launcher hands to the app
 * it boots.
 *
 * The launcher parses only its own flags (`--profile`, `--patch`, the config
 * dumps) and hands everything after them to the tree verbatim through the
 * {@link CmdlineArgs} service, so an app owns its flag family, its `--help`
 * text, and its parse errors instead of the launcher knowing them.
 *
 * Any app plugin can inject `cmdlineArgs` and call {@link parseCmdline}. A
 * provider may publish the parsed values as its own service from its program's
 * commander action, and ordinary rows
 * can inject that service and read it from lazily resolved config —
 * `port: !!js ctx.webStartup.port ?? 3080` — so a flag beats the value written
 * beside it. No row has launcher-level command-line status.
 * @module @deepseek-ai/dsh-cmdline
 */
import type { Command } from 'commander';
import type { Context } from '@deepseek-ai/cordis';
/**
 * The invocation's inner arguments: everything after the launcher's own flags,
 * verbatim and in argv order. `dsh --profile tui --resume abc` yields
 * `['--resume', 'abc']`.
 */
export interface CmdlineArgs {
    /**
     * Read the inner arguments.
     * @returns the arguments in argv order; empty when the invocation carried none.
     */
    get(): readonly string[];
}
/** Request bounded process exit; the launcher wires it to its shutdown controller. */
export interface AppExit {
    /**
     * Request exit once the tree has been disposed.
     * @param code - the process exit code.
     */
    (code: number): void;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** The invocation's inner arguments; provided by a launcher before the tree mounts. */
        cmdlineArgs?: CmdlineArgs;
        /** Bounded process-exit request; provided by a launcher before the tree mounts. */
        appExit?: AppExit;
    }
}
/** The launcher facts an app needs. */
export interface CmdlineHost {
    /** The invocation's inner arguments, in argv order. */
    args: readonly string[];
    /** Bounded process-exit request. */
    exit: AppExit;
}
/**
 * Provide the command line and the exit request on a host context before any
 * tree entry mounts. Both are launcher facts, not config: an embedding host
 * with no command line provides an empty argument list.
 * @param ctx - the host context the tree will mount under.
 * @param host - the invocation's arguments and its exit request.
 */
export declare function provideCmdline(ctx: Context, host: CmdlineHost): void;
/** The process streams commander output is written to; production writes to the process. */
export declare const internals: {
    stdout: {
        write(chunk: string): unknown;
    };
    stderr: {
        write(chunk: string): unknown;
    };
};
/**
 * Parse the launcher's immutable argument snapshot with an app's commander
 * program. Commander runs the program's own synchronous action handler on a
 * successful parse; app code there publishes its service and rejects an
 * invalid invocation with `program.error(...)`. This helper has no Loader-row
 * or service ownership semantics.
 *
 * Help, version, and rejected arguments — from the grammar or from an action
 * — are terminal for the process: commander writes the text and the helper
 * requests `ctx.appExit`. The action never runs on help, version, or a
 * grammar rejection; an action must reject before it publishes, because
 * statements before its `program.error(...)` have already run.
 * @param ctx - plugin context carrying `cmdlineArgs` and `appExit`.
 * @param program - the app's commander program, with its flags, description,
 * actions, and any subcommands already declared.
 * @throws when the launcher did not provide the command line and exit request,
 * or when no command in the program declares an action.
 */
export declare function parseCmdline(ctx: Context, program: Command): void;
//# sourceMappingURL=index.d.ts.map