/**
 * The run-status vocabulary (spec 05 §2, strict acceptance gate): one home
 * for the five durable run statuses' locale keys, shared by the nav counts,
 * the task list, and the detail header — status copy never diverges between
 * the three columns.
 */
import type { InboxKey } from './locales.ts'
import type { WireRunStatus } from './runs-api.ts'

/** Run status → locale key, one home for nav/list/detail. */
const RUN_STATUS_KEY: Record<WireRunStatus, InboxKey> = {
  running: 'status.running',
  waiting: 'status.waiting',
  done: 'status.done',
  failed: 'status.failed',
  cancelled: 'status.cancelled',
}

/**
 * Resolve a durable run status to its locale key.
 * @param status - the wire run status.
 * @returns the `inbox` namespace key for the status's product copy.
 */
export function runStatusKey(status: WireRunStatus): InboxKey {
  return RUN_STATUS_KEY[status]
}
