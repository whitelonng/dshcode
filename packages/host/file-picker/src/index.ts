/**
 * Service Definition for the `ctx.filePicker` capability seam: how the web-GUI host lets an
 * operator select one or more local files by absolute path. Unlike the directory-picker seam,
 * a file picker has only a `native` interaction — a remote client cannot open an OS chooser
 * on a display it has no access to — so the single capability returns selected absolute paths
 * straight back to the caller. The complementary basename-location helpers live in `./locate.ts`
 * (they resolve a dragged file's `File.name` back to an absolute path without staging bytes).
 * @module @deepseek-ai/dsh-host-file-picker
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** Options for one native file selection. */
export interface FilePickerOptions {
  /** Whether the chooser allows selecting several files in one pick. */
  multiple: boolean
}

/** Settled result of one native file pick carrying every selected absolute path in selection order. */
export interface FilePickerResult {
  /** Absolute host paths; never empty for a settled (non-cancelled) pick. */
  paths: string[]
}

/** The native interaction: one OS file chooser on the host display. */
export interface FilePickerNativeCapability {
  kind: 'native'
  /**
   * Open the chooser and wait for the operator.
   * @param options - selection shape (single/multiple).
   * @param signal - caller/connection lifetime; abort terminates the chooser.
   * @returns the selected absolute paths, or null when the operator cancels.
   */
  pickFiles(options: FilePickerOptions, signal: AbortSignal): Promise<FilePickerResult | null>
}

/**
 * Merge-extensible registry of interaction shapes keyed by capability kind. The
 * only backend today is `native`; a future backend declaration-merges its shape
 * here instead of editing this package.
 */
export interface FilePickerCapabilities {
  native: FilePickerNativeCapability
}

/** Union of interaction shapes a backend can provide. */
export type FilePickerCapability = FilePickerCapabilities[keyof FilePickerCapabilities]

declare module '@deepseek-ai/cordis' {
  interface Context {
    filePicker: FilePicker
  }
}

/**
 * Abstract file-picking service. Subclass, implement `capability()`, and load
 * the subclass as a plugin — it registers as `ctx.filePicker` (one
 * implementation per context). The capability object must be stable for the
 * service lifetime: consumers may capture it across calls.
 */
export abstract class FilePicker extends Service {
  constructor(ctx: Context) {
    super(ctx, 'filePicker')
  }

  /**
   * The backend's interaction capability.
   * @returns the discriminated capability consumers switch on.
   */
  abstract capability(): FilePickerCapability
}

export default FilePicker
