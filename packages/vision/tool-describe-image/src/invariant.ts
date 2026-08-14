/** Package-owned invariant companion for `@deepseek-ai/dsh-tool-describe-image`. @module @deepseek-ai/dsh-tool-describe-image/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-describe-image'

/** Cordis companion plugin name. */
export const name = 'describe-image-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the tool writes no durable session events — the image never enters the
 * conversation, and the per-call text answer reaches the log only through the ordinary
 * tool-result path, which the tools registry already validates.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
