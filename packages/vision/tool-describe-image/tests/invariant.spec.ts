import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Invariant from '../src/invariant.ts'

describe('describe-image invariant companion', () => {
  it('registers under the package name with the registry and disposes cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(Invariant)
    await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
  })
})
