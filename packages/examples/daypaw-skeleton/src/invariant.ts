/**
 * Package-owned invariant companion for `daypaw-skeleton-example`.
 * @module daypaw-skeleton-example/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Package identity the invariant registry reserves. */
export const PACKAGE_NAME = 'daypaw-skeleton-example'

/** Cordis companion plugin name. */
export const name = 'daypaw-skeleton-example-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the demo example owns no independent event stream or
 * mutable data; the SIGKILL and snapshot suites cover its durable behavior.
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
