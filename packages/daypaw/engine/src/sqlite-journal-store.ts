/**
 * SQLite implementation of the {@link JournalStore} seam over the shared
 * `@daypaw/store` contract. One instance wraps one open `DatabaseSync`;
 * the owning service opens the database (WAL, migrations) and closes it.
 * @module @daypaw/engine/sqlite-journal-store
 */

import type { DatabaseSync } from 'node:sqlite'
import type { JournalRow, RunRow } from '@daypaw/store'
import type {
  JournalStepInsert, JournalStore, RunFinalize, RunInsert,
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
  private readonly selectStepStmt: Statement
  private readonly insertStepStmt: Statement
  private readonly completeStepStmt: Statement
  private readonly failStepStmt: Statement

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
    this.selectStepStmt = db.prepare('SELECT * FROM journal WHERE run_id = ? AND step_key = ?')
    this.insertStepStmt = db.prepare(`INSERT INTO journal (
      run_id, step_key, name, occurrence, started_at
    ) VALUES (?, ?, ?, ?, ?)`)
    this.completeStepStmt = db.prepare(`UPDATE journal
      SET status = 'completed', value_json = ?, finished_at = ?
      WHERE run_id = ? AND step_key = ?`)
    this.failStepStmt = db.prepare(`UPDATE journal
      SET status = 'failed', error_json = ?, finished_at = ?
      WHERE run_id = ? AND step_key = ?`)
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
  selectJournalStep(runId: string, stepKey: string): JournalRow | undefined {
    return this.selectStepStmt.get(runId, stepKey) as JournalRow | undefined
  }

  /** @inheritdoc */
  insertJournalStep(row: JournalStepInsert): void {
    this.insertStepStmt.run(row.runId, row.stepKey, row.name, row.occurrence, row.startedAt)
  }

  /** @inheritdoc */
  completeJournalStep(runId: string, stepKey: string, valueJson: string, finishedAt: number): void {
    this.completeStepStmt.run(valueJson, finishedAt, runId, stepKey)
  }

  /** @inheritdoc */
  failJournalStep(runId: string, stepKey: string, errorJson: string, finishedAt: number): void {
    this.failStepStmt.run(errorJson, finishedAt, runId, stepKey)
  }
}
