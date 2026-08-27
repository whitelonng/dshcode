/**
 * Cross-platform native file chooser behind the file-picker native capability.
 * macOS uses `osascript` (`choose file`), Linux uses Zenity with a KDialog
 * fallback (each returning newline-separated absolute paths), and Windows is
 * deliberately unsupported for now — the koffi `IFileOpenDialog` file-multi-select
 * conversation is a later increment, and an unsupported platform fails loud
 * rather than pretending to pick. Every platform command is shell-free and
 * runs through the injectable `NativeCommandRunner`.
 */

import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import type { FilePickerOptions, FilePickerResult } from '@deepseek-ai/dsh-host-file-picker'

/** Testable command boundary; native implementations never invoke a shell. */
export type FilePickerRunner = NativeCommandRunner

/** Injectable platform facts for deterministic adapter tests. */
export interface FilePickerInternals {
  platform?: NodeJS.Platform
  run?: FilePickerRunner
}

/** One newline-separated path per selected file; the trailing newline is stripped. */
function outputPaths(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.replace(/\r$/, '').trim())
    .filter(line => line !== '')
}

function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' || typeof code === 'number' ? code : undefined
}

function errorStderr(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) return ''
  const stderr = (error as { stderr?: unknown }).stderr
  return typeof stderr === 'string' ? stderr : ''
}

function isMissingCommand(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

function rethrowIfAborted(signal: AbortSignal, error: unknown): void {
  if (signal.aborted) throw error
}

/** macOS `choose file` script: multiple-selection asks always; single-selection returns one path. */
function macFilesScript(multiple: boolean): string[] {
  const prompt = multiple ? 'Select Files' : 'Select File'
  return multiple
    ? [
      `set theFiles to choose file with prompt "${prompt}" with multiple selections allowed`,
      'set thePaths to ""',
      'repeat with f in theFiles',
      'set thePaths to thePaths & (POSIX path of f) & linefeed',
      'end repeat',
      'return thePaths',
    ]
    : [
      `set theFile to choose file with prompt "${prompt}"`,
      'return POSIX path of theFile',
    ]
}

/**
 * Open the platform native file picker.
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param options - single or multiple selection.
 * @param internals - Platform and runner hooks for deterministic tests.
 * @returns the selected absolute paths, or null when the user cancels.
 */
export async function pickNativeFiles(
  signal: AbortSignal,
  options: FilePickerOptions,
  internals: FilePickerInternals = {},
): Promise<FilePickerResult | null> {
  const platform = internals.platform ?? process.platform
  const run = internals.run ?? runNativeCommand

  if (platform === 'darwin') {
    try {
      const result = await run('osascript', macFilesScript(options.multiple).map(line => ['-e', line]).flat(), signal)
      const paths = outputPaths(result.stdout)
      return paths.length === 0 ? null : { paths }
    } catch (error: unknown) {
      if (!signal.aborted && errorCode(error) === 1
        && /(?:User canceled|-128)/i.test(errorStderr(error))) return null
      throw error
    }
  }

  if (platform === 'win32') {
    throw new Error('native file picker is unsupported on win32 (see README known limitations)')
  }

  if (platform === 'linux') {
    try {
      const args = options.multiple
        ? ['--file-selection', '--multiple', '--separator=\n', '--title=Select Files']
        : ['--file-selection', '--title=Select File']
      const result = await run('zenity', args, signal)
      const paths = outputPaths(result.stdout)
      return paths.length === 0 ? null : { paths }
    } catch (error: unknown) {
      rethrowIfAborted(signal, error)
      if (errorCode(error) === 1) return null
      if (!isMissingCommand(error)) throw error
    }

    try {
      const args = options.multiple
        ? ['--getopenfilename', '.', '*', '--multiple', '--separate-output', '--title', 'Select Files']
        : ['--getopenfilename', '.', '*', '--title', 'Select File']
      const result = await run('kdialog', args, signal)
      const paths = outputPaths(result.stdout)
      return paths.length === 0 ? null : { paths }
    } catch (error: unknown) {
      rethrowIfAborted(signal, error)
      if (errorCode(error) === 1) return null
      if (isMissingCommand(error)) {
        throw new Error('no supported native file picker found (install zenity or kdialog)')
      }
      throw error
    }
  }

  throw new Error(`native file picker is unsupported on ${platform}`)
}
