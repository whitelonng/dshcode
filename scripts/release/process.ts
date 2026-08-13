/**
 * Process helpers shared by the release scripts: the release steps drive `git`,
 * `pnpm`, `npm`, and `tar`, and each needs one of three failure behaviours.
 */

import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Where and with what environment a release step runs a command. */
export interface RunOptions {
  /** Working directory; defaults to the current one. */
  readonly cwd?: string
  /** Child environment; defaults to this process's. */
  readonly env?: NodeJS.ProcessEnv
}

/** What a command produced, for a caller that decides what a failure means. */
export interface CommandResult {
  /** Exit status, or null when a signal ended the process. */
  readonly status: number | null
  /** Captured standard output. */
  readonly stdout: string
  /** Captured standard error. */
  readonly stderr: string
}

/**
 * Run a command and capture its output without judging the exit status.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 * @returns The exit status and captured streams.
 */
export function attempt(command: string, args: readonly string[], options: RunOptions = {}): CommandResult {
  const result = spawnSync(command, [...args], { cwd: options.cwd, env: options.env, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Run a command, capture its standard output, and fail on a non-zero exit.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 * @returns The trimmed standard output.
 */
export function capture(command: string, args: readonly string[], options: RunOptions = {}): string {
  const result = attempt(command, args, options)
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}:\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

/**
 * Run a command with inherited streams, so its progress reaches the log, and
 * fail on a non-zero exit.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 */
export function run(command: string, args: readonly string[], options: RunOptions = {}): void {
  const result = spawnSync(command, [...args], { cwd: options.cwd, env: options.env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

/**
 * Whether this module is the process entry point.
 *
 * The release scripts are both commands and modules: a test imports their pure
 * logic, and importing a module runs its body, so an unguarded `main()` would
 * run the wrong command with the wrong arguments.
 * @param moduleUrl - the caller's `import.meta.url`.
 * @returns True when Node started this module.
 */
export function isEntry(moduleUrl: string): boolean {
  const invoked = process.argv[1]
  if (invoked === undefined) return false
  return realpathSync(invoked) === realpathSync(fileURLToPath(moduleUrl))
}
