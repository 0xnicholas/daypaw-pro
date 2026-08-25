/**
 * SQLite implementation of the {@link JournalStore} seam over the shared
 * `@daypaw/store` contract. One instance wraps one open `DatabaseSync`;
 * the owning service opens the database (WAL, migrations) and closes it.
 * @module @daypaw/engine/sqlite-journal-store
 */

import type { DatabaseSync } from 'node:sqlite'
import type { JournalRow, PromiseRow, RunRow } from '@daypaw/store'
import type {
  JournalSegmentInsert, JournalStepInsert, JournalStore, PromiseInsert, PromiseSettle, RunFinalize, RunInsert, RunListFilter,
} from './seams.ts'

type Statement = ReturnType<DatabaseSync['prepare']>

/** Unfinished statuses a claim or finalize may act on. */
const UNFINISHED = "('running', 'waiting')"

/**
 * `JournalStore` over one SQLite ledger database. Statements are prepared
 * once at construction.
 */
export class SqliteJournalStore implements JournalStore {
  private readonly selectRunStmt: Statement
  private readonly insertRunStmt: Statement
  private readonly claimRunStmt: Statement
  private readonly finalizeRunStmt: Statement
  private readonly selectUnfinishedStmt: Statement
  private readonly selectRunsStmt: Statement
  private readonly selectRunsByStatusStmt: Statement
  private readonly selectChildrenStmt: Statement
  private readonly selectStepsByRunStmt: Statement
  private readonly selectStepStmt: Statement
  private readonly insertStepStmt: Statement
  private readonly insertSegmentStmt: Statement
  private readonly selectSegmentsStmt: Statement
  private readonly completeStepStmt: Statement
  private readonly failStepStmt: Statement
  private readonly setRunWaitingStmt: Statement
  private readonly resumeRunStmt: Statement
  private readonly insertPromiseStmt: Statement
  private readonly selectPromiseStmt: Statement
  private readonly settlePromiseStmt: Statement
  private readonly selectOverdueStmt: Statement
  private readonly cancelPromisesStmt: Statement

  /**
   * @param db - the open ledger database (schema already migrated).
   */
  constructor(db: DatabaseSync) {
    this.selectRunStmt = db.prepare('SELECT * FROM runs WHERE run_id = ?')
    this.insertRunStmt = db.prepare(`INSERT INTO runs (
      run_id, def_kind, def_name, def_version, input_json, status,
      parent_run_id, parent_step_key, attempt, claimed_by, claimed_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, 1, ?, ?, ?, ?)`)
    this.claimRunStmt = db.prepare(`UPDATE runs
      SET claimed_by = ?, claimed_at = ?, updated_at = ?
      WHERE run_id = ? AND status IN ${UNFINISHED} AND (claimed_by IS NULL OR claimed_by <> ?)`)
    this.finalizeRunStmt = db.prepare(`UPDATE runs
      SET status = ?, output_json = ?, error_json = ?, cancel_cause = ?, finished_at = ?, updated_at = ?
      WHERE run_id = ? AND status IN ${UNFINISHED}`)
    this.selectUnfinishedStmt = db.prepare(`SELECT run_id FROM runs WHERE status IN ${UNFINISHED}`)
    // `rowid` tiebreaks equal-millisecond timestamps into true insertion
    // order, keeping "newest first" / "start order" stable under fast runs.
    this.selectRunsStmt = db.prepare('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC')
    this.selectRunsByStatusStmt = db.prepare('SELECT * FROM runs WHERE status = ? ORDER BY created_at DESC, rowid DESC')
    this.selectChildrenStmt = db.prepare('SELECT * FROM runs WHERE parent_run_id = ? ORDER BY created_at, rowid')
    this.selectStepsByRunStmt = db.prepare('SELECT * FROM journal WHERE run_id = ? ORDER BY started_at, rowid')
    this.selectStepStmt = db.prepare('SELECT * FROM journal WHERE run_id = ? AND step_key = ?')
    this.insertStepStmt = db.prepare(`INSERT INTO journal (
      run_id, step_key, name, occurrence, started_at
    ) VALUES (?, ?, ?, ?, ?)`)
    this.insertSegmentStmt = db.prepare(`INSERT INTO journal (
      run_id, step_key, name, occurrence, kind, status, value_json, started_at, finished_at
    ) VALUES (?, ?, 'steer', ?, 'segment', 'completed', ?, ?, ?)`)
    this.selectSegmentsStmt = db.prepare(
      "SELECT * FROM journal WHERE run_id = ? AND kind = 'segment' ORDER BY occurrence")
    this.completeStepStmt = db.prepare(`UPDATE journal
      SET status = 'completed', value_json = ?, finished_at = ?
      WHERE run_id = ? AND step_key = ?`)
    this.failStepStmt = db.prepare(`UPDATE journal
      SET status = 'failed', error_json = ?, finished_at = ?
      WHERE run_id = ? AND step_key = ?`)
    this.setRunWaitingStmt = db.prepare(`UPDATE runs
      SET status = 'waiting', waiting_gate = ?, updated_at = ?
      WHERE run_id = ? AND status IN ${UNFINISHED}`)
    this.resumeRunStmt = db.prepare(`UPDATE runs
      SET status = 'running', waiting_gate = NULL, updated_at = ?
      WHERE run_id = ? AND status = 'waiting'`)
    this.insertPromiseStmt = db.prepare(`INSERT INTO promises (
      run_id, gate, schema_json, timeout_at, created_at
    ) VALUES (?, ?, ?, ?, ?)`)
    this.selectPromiseStmt = db.prepare('SELECT * FROM promises WHERE run_id = ? AND gate = ?')
    this.settlePromiseStmt = db.prepare(`UPDATE promises
      SET state = ?, payload_json = ?, resolution_source = ?, resolved_at = ?
      WHERE run_id = ? AND gate = ? AND state = 'pending'`)
    this.selectOverdueStmt = db.prepare(
      "SELECT * FROM promises WHERE state = 'pending' AND timeout_at IS NOT NULL AND timeout_at <= ?")
    this.cancelPromisesStmt = db.prepare(`UPDATE promises
      SET state = 'cancelled', resolved_at = ?
      WHERE run_id = ? AND state = 'pending'`)
  }

  /** @inheritdoc */
  selectRun(runId: string): RunRow | undefined {
    return this.selectRunStmt.get(runId) as RunRow | undefined
  }

  /** @inheritdoc */
  insertRun(row: RunInsert): void {
    this.insertRunStmt.run(
      row.runId, row.defKind, row.defName, row.defVersion, row.inputJson,
      row.parentRunId ?? null, row.parentStepKey ?? null,
      row.claimedBy, row.claimedAt, row.createdAt, row.createdAt,
    )
  }

  /** @inheritdoc */
  claimRun(runId: string, claimedBy: string, at: number): boolean {
    return this.claimRunStmt.run(claimedBy, at, at, runId, claimedBy).changes === 1
  }

  /** @inheritdoc */
  finalizeRun(runId: string, patch: RunFinalize): boolean {
    return this.finalizeRunStmt.run(
      patch.status, patch.outputJson ?? null, patch.errorJson ?? null,
      patch.cancelCause ?? null, patch.finishedAt, patch.finishedAt, runId,
    ).changes === 1
  }

  /** @inheritdoc */
  selectUnfinishedRunIds(): string[] {
    return (this.selectUnfinishedStmt.all() as { run_id: string }[]).map(row => row.run_id)
  }

  /** @inheritdoc */
  selectRuns(filter?: RunListFilter): RunRow[] {
    if (filter?.status === undefined) return this.selectRunsStmt.all() as unknown as RunRow[]
    return this.selectRunsByStatusStmt.all(filter.status) as unknown as RunRow[]
  }

  /** @inheritdoc */
  selectChildRuns(parentRunId: string): RunRow[] {
    return this.selectChildrenStmt.all(parentRunId) as unknown as RunRow[]
  }

  /** @inheritdoc */
  selectJournalSteps(runId: string): JournalRow[] {
    return this.selectStepsByRunStmt.all(runId) as unknown as JournalRow[]
  }

  /** @inheritdoc */
  selectJournalStep(runId: string, stepKey: string): JournalRow | undefined {
    return this.selectStepStmt.get(runId, stepKey) as JournalRow | undefined
  }

  /** @inheritdoc */
  insertJournalStep(row: JournalStepInsert): void {
    this.insertStepStmt.run(row.runId, row.stepKey, row.name, row.occurrence, row.startedAt)
  }

  /** @inheritdoc */
  insertJournalSegment(row: JournalSegmentInsert): void {
    this.insertSegmentStmt.run(
      row.runId, `steer:${row.seq}`, row.seq, row.inputJson, row.createdAt, row.createdAt,
    )
  }

  /** @inheritdoc */
  selectJournalSegments(runId: string): JournalRow[] {
    return this.selectSegmentsStmt.all(runId) as unknown as JournalRow[]
  }

  /** @inheritdoc */
  completeJournalStep(runId: string, stepKey: string, valueJson: string, finishedAt: number): void {
    this.completeStepStmt.run(valueJson, finishedAt, runId, stepKey)
  }

  /** @inheritdoc */
  failJournalStep(runId: string, stepKey: string, errorJson: string, finishedAt: number): void {
    this.failStepStmt.run(errorJson, finishedAt, runId, stepKey)
  }

  /** @inheritdoc */
  setRunWaiting(runId: string, gate: string, at: number): void {
    this.setRunWaitingStmt.run(gate, at, runId)
  }

  /** @inheritdoc */
  resumeRun(runId: string, at: number): void {
    this.resumeRunStmt.run(at, runId)
  }

  /** @inheritdoc */
  insertPromise(row: PromiseInsert): void {
    this.insertPromiseStmt.run(row.runId, row.gate, row.schemaJson ?? null, row.timeoutAt ?? null, row.createdAt)
  }

  /** @inheritdoc */
  selectPromise(runId: string, gate: string): PromiseRow | undefined {
    return this.selectPromiseStmt.get(runId, gate) as PromiseRow | undefined
  }

  /** @inheritdoc */
  settlePromise(runId: string, gate: string, patch: PromiseSettle): boolean {
    return this.settlePromiseStmt.run(
      patch.state, patch.payloadJson ?? null, patch.source ?? null, patch.resolvedAt, runId, gate,
    ).changes === 1
  }

  /** @inheritdoc */
  selectOverduePromises(now: number): PromiseRow[] {
    return this.selectOverdueStmt.all(now) as unknown as PromiseRow[]
  }

  /** @inheritdoc */
  cancelPendingPromises(runId: string, at: number): void {
    this.cancelPromisesStmt.run(at, runId)
  }
}
