/**
 * Pure types of the approval-history domain: the ONE home of the
 * `approvalHistory` projection-key declaration, free of this package's
 * host-side value imports (cordis context, zod), so browser type chains can
 * consume it without loading the host plugin.
 *
 * @module @daypaw/approval-history/types
 */

import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'

/**
 * One approval audit row: an `approval/asked`, paired with its outcome once
 * the matching `approval/decided` lands. `reason` is ABSENT (never
 * undefined-valued) when the ask carried none; `outcome` is absent while the
 * ask is unanswered. The event's `callId` stays in the log — the detail-pane
 * list renders one row per ask, not per call.
 */
export interface ApprovalHistoryEntry {
  /** The ask's `ApprovalRequestId`, pairing the entry with its decision. */
  id: string
  /** The tool the question was about. */
  toolName: string
  /** The asker's human-readable explanation, when the ask carried one. */
  reason?: string
  /** The recorded outcome; absent until the decision event lands. */
  outcome?: ApprovalOutcome
}

/**
 * The `approvalHistory` projection's wire value: the session's approval asks
 * in log order. Capability absence (the plugin not composed) is the key's
 * absence, never a value.
 */
export type ApprovalHistoryProjection = readonly ApprovalHistoryEntry[]

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Ordered approval audit entries folded from `approval/asked` + `approval/decided`; see {@link ApprovalHistoryEntry}. */
    approvalHistory: ApprovalHistoryProjection
  }

  interface SessionProjectionStateMap {
    /** Fold state: the entries themselves in log order (plain JSON; the state IS the value). */
    approvalHistory: ApprovalHistoryProjection
  }
}
