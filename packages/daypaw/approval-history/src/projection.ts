/**
 * The `approvalHistory` projection unit: a pure fold of the `approval/asked`
 * + `approval/decided` audit pair into the ordered per-session approval list
 * the daypaw browser shell renders in a task's detail pane.
 *
 * Pairing is by `ApprovalRequestId`: the approval service appends the asked
 * event before its decided event in every valid log, so a decision whose id
 * matches no entry has nothing to pair with and folds to the same reference
 * rather than synthesizing an ask-less row.
 *
 * @module @daypaw/approval-history/projection
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ApprovalHistoryEntry, ApprovalHistoryProjection } from './types.ts'

const approvalHistorySchema: ZodType<ApprovalHistoryProjection> = z.array(z.object({
  id: z.string(),
  toolName: z.string(),
  // exactOptional: the fold never writes undefined-valued keys (JSON
  // checkpointing and the wire value agree on absence), so the schema rejects
  // an explicit undefined the way it rejects a wrong type.
  reason: z.string().exactOptional(),
  outcome: z.enum(['allowed-once', 'rejected', 'cancelled', 'unavailable']).exactOptional(),
}).strict())

/**
 * Fold state: the entries themselves, one per ask in log order — plain JSON
 * per the unit contract (persisted-cache precondition), so the state IS the
 * value and `view` returns it unchanged.
 */
type ApprovalHistoryState = ApprovalHistoryEntry[]

/** The `approvalHistory` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const approvalHistoryProjectionDefinition: ProjectionDefinition<'approvalHistory', ApprovalHistoryState> = {
  key: 'approvalHistory',
  schema: approvalHistorySchema,
  init: () => [],
  apply: (state, event) => {
    // Every uninteresting event returns the same reference (Object.is gates the change feed).
    if (event.type === 'approval/asked') {
      const entry: ApprovalHistoryEntry = { id: event.data.id, toolName: event.data.toolName }
      // Absent reason stays ABSENT: an undefined-valued key would survive
      // neither the strict value schema nor JSON checkpointing.
      if (event.data.reason !== undefined) entry.reason = event.data.reason
      return [...state, entry]
    }
    if (event.type === 'approval/decided') {
      const asked = state.find(entry => entry.id === event.data.id)
      if (asked === undefined) return state
      return state.map(entry => (entry === asked ? { ...entry, outcome: event.data.outcome } : entry))
    }
    return state
  },
  view: state => state,
  stateVersion: 1,
}
