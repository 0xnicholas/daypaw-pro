/**
 * Journal storage seam: the one replaceable interface the walking skeleton
 * lands. Promise/timer seams land together with their primitives
 * (`ctx.waitFor` / `ctx.sleep`, demand-driven). Wrapping this seam is also
 * the fault-injection surface for the crash test suite (spec 01 §7/§9).
 * @module @daypaw/engine/seams
 */

import type { JournalRow, RunDefKind, RunRow } from '@daypaw/store'

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
  /** @returns the step row, or undefined when the step never started. */
  selectJournalStep(runId: string, stepKey: string): JournalRow | undefined
  /** @param row - started-step payload; status defaults to `started`. */
  insertJournalStep(row: JournalStepInsert): void
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
}
