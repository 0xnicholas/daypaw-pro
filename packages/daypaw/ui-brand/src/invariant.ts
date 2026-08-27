/**
 * Package-owned invariant companion for `@daypaw/ui-brand`.
 * @module @daypaw/ui-brand/invariant
 */

/* jscpd:ignore-start -- fork carrier: same companion shape every package
   carries; only PACKAGE_NAME and the empty-installer reason differ. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@daypaw/ui-brand'

/** Cordis companion plugin name. */
export const name = 'daypaw-ui-brand-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin's only effect is one token-override layer
 * on the theme service, whose stacking, per-scheme composition, and teardown
 * are the theme service's own contract and are asserted directly by this
 * package's apply spec; the layer owns no state of its own.
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
