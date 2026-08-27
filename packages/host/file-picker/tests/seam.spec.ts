/** Contract behavior the seam itself owns: registration identity and the capability shape. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FilePicker } from '../src/index.ts'
import type { FilePickerCapability } from '../src/index.ts'

/** Minimal concrete backend: all a subclass owes the abstract class is capability(). */
class StubPicker extends FilePicker {
  private readonly stub: FilePickerCapability = {
    kind: 'native',
    pickFiles: async () => null,
  }
  capability(): FilePickerCapability {
    return this.stub
  }
}

describe('FilePicker seam', () => {
  it('registers a subclass as ctx.filePicker and leaves with its fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(StubPicker)
    await fiber.await()
    expect(ctx.get('filePicker')).toBeInstanceOf(StubPicker)
    expect(ctx.get('filePicker')!.capability().kind).toBe('native')
    await fiber.dispose()
    expect(ctx.get('filePicker')).toBeUndefined()
  })
})
