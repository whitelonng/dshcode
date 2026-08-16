/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-notifications`.
 * @module @deepseek-ai/dsh-client-ui-notifications/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-notifications'

/** Cordis companion plugin name. */
export const name = 'client-ui-notifications-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin owns a client-side observer over the
 * `sessions.list` snapshot store and a settings-scope mirror; both are
 * presentation projections of authoritative runtime data (the manager and the
 * Host settings document) and are exercised by the service spec. The node half
 * registers one settings namespace whose registration/disposal is proven by
 * the Host spec. No cross-plugin mutable state is held.
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
