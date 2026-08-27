/**
 * Native backend of the file-picker seam: registers `ctx.filePicker` with the
 * `native` capability, opening one native OS chooser on the host display per
 * pick. Only viable when the operator sits at the host's screen; remote
 * deployments have no display to open a chooser on.
 * @module @deepseek-ai/dsh-host-file-picker-native
 */

import { FilePicker } from '@deepseek-ai/dsh-host-file-picker'
import type { FilePickerCapability } from '@deepseek-ai/dsh-host-file-picker'
import { pickNativeFiles } from './native-picker.ts'

export type { FilePickerInternals, FilePickerRunner } from './native-picker.ts'
export { pickNativeFiles } from './native-picker.ts'

/** The `ctx.filePicker` native implementation (stable capability object per service life). */
export default class NativeFilePicker extends FilePicker {
  private readonly nativeCapability: FilePickerCapability = {
    kind: 'native',
    /* v8 ignore next -- pure forward to pickNativeFiles (its spec owns behavior); invoking here opens a real chooser. */
    pickFiles: (options, signal) => pickNativeFiles(signal, options),
  }

  /**
   * The native interaction capability.
   * @returns the stable `native` capability object.
   */
  capability(): FilePickerCapability {
    return this.nativeCapability
  }
}
