/**
 * Package-owned invariant companion for `@daypaw/engine`.
 * @module @daypaw/engine/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@daypaw/engine'

/** Cordis companion plugin name. */
export const name = 'daypaw-engine-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the engine core is deliberately Cordis-free (no
 * event stream to hook — gap-2 ruling in the backend-gaps resolution), and
 * the run/journal/promise state machines are asserted by the
 * fault-injection suite at every append point (spec 01 §9). Ledger
 * relational checks land when the core gains a checkable surface.
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
