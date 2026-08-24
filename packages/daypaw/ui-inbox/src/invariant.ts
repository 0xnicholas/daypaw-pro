/**
 * Package-owned invariant companion for `@daypaw/ui-inbox`.
 * @module @daypaw/ui-inbox/invariant
 */

/* jscpd:ignore-start -- fork carrier: same companion shape every package
   carries; only PACKAGE_NAME and the empty-installer reason differ. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@daypaw/ui-inbox'

/** Cordis companion plugin name. */
export const name = 'daypaw-ui-inbox-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure-presentation plugin whose only state is the
 * apply-closure selection store asserted directly by this package's
 * apply/component specs — it emits no cordis events and owns no durable or
 * cross-plugin mutable state; the slot registry's own package carries the
 * registration-lifecycle relation.
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
