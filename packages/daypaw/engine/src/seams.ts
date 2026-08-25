/**
 * Journal storage seam: the one replaceable interface the walking skeleton
 * lands; `ctx.waitFor` extended it with the promise rows (spec 01 §6).
 * Promise resolution itself lives in the engine core (in-process push plus a
 * poll fallback); the PromiseResolver/TimerScheduler seams extract when a
 * second implementation appears. Wrapping this seam is also the
 * fault-injection surface for the crash test suite (spec 01 §7/§9).
 * @module @daypaw/engine/seams
 */

import type { JournalRow, PromiseResolutionSource, PromiseRow, RunDefKind, RunRow, RunStatusDb } from '@daypaw/store'

/** Status restriction for {@link JournalStore.selectRuns}. */
export interface RunListFilter {
  /** Keep only runs in this status; omitted matches every status. */
  readonly status?: RunStatusDb
}

/** Insert payload for a new run row. */
export interface RunInsert {
  readonly runId: string
  readonly defKind: RunDefKind
  readonly defName: string
  readonly defVersion: string
  readonly inputJson: string
  readonly parentRunId: string | undefined
  readonly parentStepKey: string | undefined
  readonly claimedBy: string
  readonly claimedAt: number
  readonly createdAt: number
}

/** Terminal patch for a run row; applies only while the run is unfinished. */
export interface RunFinalize {
  readonly status: 'done' | 'failed' | 'cancelled'
  readonly outputJson: string | undefined
  readonly errorJson: string | undefined
  readonly cancelCause: string | undefined
  readonly finishedAt: number
}

/** Insert payload for a started journal step. */
export interface JournalStepInsert {
  readonly runId: string
  readonly stepKey: string
  readonly name: string
  readonly occurrence: number
  readonly startedAt: number
}

/**
 * Insert payload for one steer segment boundary (issue #53). A segment row
 * is a fact, not an execution unit: it lands `completed` at insert and no
 * re-drive ever re-executes it. Step keys derive as `steer:<seq>`; the
 * `steer:` prefix never collides with step keys.
 */
export interface JournalSegmentInsert {
  readonly runId: string
  /** Segment sequence, 1-based in record order (segment 0 is the run input on the `runs` row). */
  readonly seq: number
  /** JSON-encoded steered input. */
  readonly inputJson: string
  readonly createdAt: number
}

/** Insert payload for a pending durable promise (gate). */
export interface PromiseInsert {
  readonly runId: string
  readonly gate: string
  /** JSON Schema rendering projection of the gate's value contract, when one was declared. */
  readonly schemaJson: string | undefined
  /** Timeout deadline (epoch ms), when the gate declared one. */
  readonly timeoutAt: number | undefined
  readonly createdAt: number
}

/**
 * First-wins settlement patch for a pending promise. `payloadJson` carries
 * the resolved value, or the rejection reason for a `rejected` settlement.
 */
export interface PromiseSettle {
  readonly state: 'resolved' | 'rejected' | 'timedout' | 'cancelled'
  readonly payloadJson: string | undefined
  readonly source: PromiseResolutionSource | undefined
  readonly resolvedAt: number
}

/**
 * Durable storage behind the engine: runs and journal steps. All methods are
 * synchronous (SQLite `DatabaseSync`); call ordering and state-machine
 * decisions live in the engine core.
 */
export interface JournalStore {
  /** @param runId - run identity. @returns the row, or undefined when unknown. */
  selectRun(runId: string): RunRow | undefined
  /** @param row - complete insert payload; the run starts unfinished and claimed. */
  insertRun(row: RunInsert): void
  /**
   * Conditionally take the single-writer claim: succeeds only when the run is
   * unfinished and currently unclaimed or claimed by another instance.
   * @param runId - run identity.
   * @param claimedBy - claiming instance id.
   * @param at - claim timestamp (epoch ms).
   * @returns whether this call won the claim.
   */
  claimRun(runId: string, claimedBy: string, at: number): boolean
  /**
   * Write a terminal patch; a no-op returning false when the run is already
   * terminal (first terminal outcome wins).
   * @param runId - run identity.
   * @param patch - terminal fields.
   * @returns whether the patch applied.
   */
  finalizeRun(runId: string, patch: RunFinalize): boolean
  /** @returns ids of every run in a non-terminal status, for boot scan. */
  selectUnfinishedRunIds(): string[]
  /**
   * Read side of the run table (spec 05 §5): the one query home for hosts,
   * so query knowledge evolves with the schema instead of scattering SQL
   * into host code.
   * @param filter - optional status restriction.
   * @returns matching run rows, newest first (insertion order reversed).
   */
  selectRuns(filter?: RunListFilter): RunRow[]
  /**
   * @param parentRunId - parent run identity.
   * @returns the run's direct children, oldest first (insertion order).
   */
  selectChildRuns(parentRunId: string): RunRow[]
  /**
   * @param runId - run identity.
   * @returns the run's journal steps in start order.
   */
  selectJournalSteps(runId: string): JournalRow[]
  /** @returns the step row, or undefined when the step never started. */
  selectJournalStep(runId: string, stepKey: string): JournalRow | undefined
  /** @param row - started-step payload; status defaults to `started`. */
  insertJournalStep(row: JournalStepInsert): void
  /**
   * Record one steer segment boundary, complete at insert (issue #53).
   * @param row - segment payload; the step key derives as `steer:<seq>`.
   */
  insertJournalSegment(row: JournalSegmentInsert): void
  /**
   * @param runId - run identity.
   * @returns the run's steer segment rows in record order.
   */
  selectJournalSegments(runId: string): JournalRow[]
  /**
   * Record a step's recorded-result commit (the dedup gate's write side).
   * @param runId - run identity.
   * @param stepKey - idempotency key.
   * @param valueJson - JSON-encoded step result.
   * @param finishedAt - completion timestamp (epoch ms).
   */
  completeJournalStep(runId: string, stepKey: string, valueJson: string, finishedAt: number): void
  /**
   * Record a step failure.
   * @param runId - run identity.
   * @param stepKey - idempotency key.
   * @param errorJson - JSON-encoded failure description.
   * @param finishedAt - failure timestamp (epoch ms).
   */
  failJournalStep(runId: string, stepKey: string, errorJson: string, finishedAt: number): void
  /**
   * Move an unfinished run into `waiting` on one gate; a no-op when the run
   * already waits (re-drive reaching the same `waitFor` again).
   * @param runId - run identity.
   * @param gate - gate name, recorded on `waiting_gate`.
   * @param at - transition timestamp (epoch ms).
   */
  setRunWaiting(runId: string, gate: string, at: number): void
  /**
   * Move a waiting run back to `running` and clear `waiting_gate`; a no-op
   * when the run is not waiting.
   * @param runId - run identity.
   * @param at - transition timestamp (epoch ms).
   */
  resumeRun(runId: string, at: number): void
  /** @param row - pending-promise payload; state defaults to `pending`. */
  insertPromise(row: PromiseInsert): void
  /** @returns the promise row, or undefined when the gate never registered. */
  selectPromise(runId: string, gate: string): PromiseRow | undefined
  /**
   * Settle a pending promise (first-wins): applies only while the row is
   * `pending`; a second settler is a no-op returning false.
   * @param runId - run identity.
   * @param gate - gate name.
   * @param patch - terminal state, payload, and source.
   * @returns whether this call won the settlement.
   */
  settlePromise(runId: string, gate: string, patch: PromiseSettle): boolean
  /**
   * @param now - current time (epoch ms).
   * @returns pending promises whose timeout already passed, for the boot-scan sweep.
   */
  selectOverduePromises(now: number): PromiseRow[]
  /**
   * Cancel every pending promise of one run (run cancellation settles its
   * gates as `cancelled`, first-wins against concurrent resolvers).
   * @param runId - run identity.
   * @param at - cancellation timestamp (epoch ms).
   */
  cancelPendingPromises(runId: string, at: number): void
}
