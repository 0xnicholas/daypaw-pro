/**
 * The run-status vocabulary (spec 05 §2, strict acceptance gate) for the
 * task surfaces: one home for the five durable run statuses' `daypaw-tasks`
 * locale keys, shared by the task-list rows and the detail body's subtask
 * rows so the status copy never diverges between them.
 */
import type { WireRunStatus } from '@daypaw/ui-inbox/client'
import type { DaypawTasksKey } from './locales.ts'

/** Run status → `daypaw-tasks` locale key, one home for list and detail. */
const RUN_STATUS_KEY: Record<WireRunStatus, DaypawTasksKey> = {
  running: 'list.status.running',
  waiting: 'list.status.waiting',
  done: 'list.status.done',
  failed: 'list.status.failed',
  cancelled: 'list.status.cancelled',
}

/**
 * Resolve a durable run status to its locale key.
 * @param status - the wire run status.
 * @returns the `daypaw-tasks` namespace key for the status's product copy.
 */
export function runStatusKey(status: WireRunStatus): DaypawTasksKey {
  return RUN_STATUS_KEY[status]
}
