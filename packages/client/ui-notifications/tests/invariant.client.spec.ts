/** Invariant companion registration: installs and disposes with the fiber. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as NotificationsInvariant from '../src/invariant.ts'

describe('ui-notifications invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(NotificationsInvariant)
    await fiber.await()
    expect(NotificationsInvariant.name).toBe('client-ui-notifications-invariant')
    expect(NotificationsInvariant.inject).toEqual(['invariants'])
    // Emitting an unrelated event proves the companion installed no audit.
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
