/**
 * Package-owned invariant companion for the native file-picker backend.
 * @module @deepseek-ai/dsh-host-file-picker-native/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-file-picker-native'

/** Cordis companion plugin name. */
export const name = 'host-file-picker-native-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: each pick is one stateless subprocess round trip; the chooser outcome is only the returned paths. */
const install: InvariantInstaller = () => {}

/**
 * Register the native file-picker invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
