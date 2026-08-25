/**
 * Function plugin registering the `approvalHistory` projection unit: the
 * per-session approval audit list (one entry per `approval/asked`, paired with
 * its `approval/decided` outcome) served through the session-projection seam
 * — registry snapshot, change feed, and every projection carrier — so the
 * daypaw browser shell renders a task's approval history from the durable log
 * alone. The plugin owns only the fold; delivery is the seam's.
 *
 * @module @daypaw/approval-history
 */

import type { Context } from '@deepseek-ai/cordis'
import { approvalHistoryProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'approval-history'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `approvalHistory` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(approvalHistoryProjectionDefinition)
}
