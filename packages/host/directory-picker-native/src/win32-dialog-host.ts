/**
 * Real-process half of the Win32 dialog driver: spawn the dialog child
 * process (source or built plane) and close a dialog thread's windows. The
 * module itself loads everywhere (the import chain from native-picker.ts is
 * static); what stays win32-only is koffi, imported dynamically inside the
 * bindings' functions. The driver's logic is tested against fakes of this
 * surface instead.
 */

import { spawn, type StdioOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Win32DialogWorkerData } from './win32-dialog-worker.ts'

/**
 * Spawn the dialog child process. Built consumers launch the bundled CJS
 * entry next to this module under plain node; unbuilt (source) consumers
 * run the worker directly under Node's native type stripping (stable since
 * 22.18, covered by the engines range) — the worker's three modules use
 * only erasable TS syntax, so no tsx bootstrap is needed. The dialog is the
 * child's first window, so Windows activates it without a foreground call.
 * @param data - the child payload (dialog title).
 * @returns the spawned child process.
 */
export function spawnDialogWorker(data: Win32DialogWorkerData): ReturnType<typeof spawn> {
  // A packaged Electron host uses its branded application as process.execPath;
  // child-only Node mode bypasses application startup and its single-instance lock.
  const env = { ...process.env, DSH_DIALOG_TITLE: data.title, ELECTRON_RUN_AS_NODE: '1' }
  const stdio: StdioOptions = ['ignore', 'inherit', 'inherit', 'ipc']
  // Pathname (not the raw URL): bundlers/tests append query strings (?v=...) to
  // the URL, which would misclassify source modules as built and silently test
  // the wrong arm. The pathname ends with .ts only for the unbuilt source plane.
  /* v8 ignore next 3 -- the built-output arm: tests always run unbuilt (src/) */
  if (!new URL(import.meta.url).pathname.endsWith('.ts')) {
    return spawn(process.execPath, [fileURLToPath(new URL('./worker.cjs', import.meta.url))], { env, stdio, windowsHide: true })
  }
  // `node <absolute .ts path>`: Node's ESM loader accepts a file path here (no
  // tsx hook in front of it), so the absolute Windows path cannot be misparsed
  // as an `e:` scheme URL — the failure mode when tsx's loader chain is active.
  return spawn(process.execPath, [fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], { env, stdio, windowsHide: true })
}

export { closeThreadWindows } from './win32-dialog-bindings.ts'
