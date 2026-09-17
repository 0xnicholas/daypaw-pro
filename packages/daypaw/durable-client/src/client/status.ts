/**
 * The durable run-status vocabulary (spec 05 §2, strict acceptance gate):
 * the one home for the five statuses' shared client predicates and their
 * `'durable'`-namespace copy keys, shared by every browser plane that names a
 * run status — the status text never diverges between surfaces.
 */
import type { WireRunStatus } from './wire.ts'
import type { DurableKey } from './locales.ts'

/**
 * Whether a wire run status is unfinished — the one partition every
 * client-side plane agrees on (the board's running/done grouping, the
 * conversation seat's follow-up liveness).
 * @param status - the wire run status to test.
 * @returns whether the run may still consume a steer segment.
 */
export function isUnfinishedWireRun(status: WireRunStatus): boolean {
  return status === 'running' || status === 'waiting'
}

/** Run status → locale key, one home for every surface that names a status. */
const RUN_STATUS_KEY: Record<WireRunStatus, DurableKey> = {
  running: 'status.running',
  waiting: 'status.waiting',
  done: 'status.done',
  failed: 'status.failed',
  cancelled: 'status.cancelled',
}

/**
 * Resolve a durable run status to its locale key.
 * @param status - the wire run status.
 * @returns the `durable` namespace key for the status's product copy.
 */
export function runStatusKey(status: WireRunStatus): DurableKey {
  return RUN_STATUS_KEY[status]
}
