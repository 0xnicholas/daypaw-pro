/**
 * Shared SQLite contract for the daypaw engine ledger: table/column name
 * constants, row types, and the open/migrate sequence. No business logic —
 * `@daypaw/engine` owns the writes; future manager/evo subprojects read the
 * same rows through this contract. Schema decisions: docs/spec/01-durable-execution.md §3–§4.
 * @module @daypaw/store
 */

import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, type Migration } from './migrations.ts'

export { MIGRATIONS, type Migration } from './migrations.ts'

/** `runs` table name (spec §3.1). */
export const RUNS_TABLE = 'runs'
/** `journal` table name (spec §3.2). */
export const JOURNAL_TABLE = 'journal'
/** `promises` table name (spec §3.3). */
export const PROMISES_TABLE = 'promises'

/** Current on-disk layout version: the last migration segment's version. */
export const DAYPAW_STORE_SCHEMA_VERSION: number = newestVersionOf(MIGRATIONS)

/**
 * Version of the newest segment in a migration list; an empty list reads as 0.
 * @param migrations - ordered segments.
 * @returns the newest segment's version, or 0 when there are none.
 */
export function newestVersionOf(migrations: readonly Migration[]): number {
  return migrations.at(-1)?.version ?? 0
}

/** SQLite `busy_timeout` applied on open (ms); writers queue rather than fail. */
export const LEDGER_BUSY_TIMEOUT_MS = 5_000

/** Durable run kind recorded on `runs.def_kind`. */
export type RunDefKind = 'workflow' | 'agent'

/** Durable run status recorded on `runs.status` (spec §3.1). */
export type RunStatusDb = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled'

/** Journal step status recorded on `journal.status` (spec §3.2). */
export type JournalStatusDb = 'started' | 'completed' | 'failed'

/**
 * Journal row kind recorded on `journal.kind` (spec §3.2): `step` is an
 * idempotent execution unit; `segment` is a steer segment boundary fact
 * (issue #53), recorded complete at insert and never re-executed.
 */
export type JournalKindDb = 'step' | 'segment'

/** Promise state recorded on `promises.state` (spec §3.3; aligns with the Resonate durable promise state machine). */
export type PromiseStateDb = 'pending' | 'resolved' | 'rejected' | 'timedout' | 'cancelled'

/** Who settled a promise, recorded on `promises.resolution_source` (spec §3.3). */
export type PromiseResolutionSource = 'sdk' | 'manager' | 'webhook'

/** One `runs` row (spec §3.1; skeleton columns). */
export interface RunRow {
  readonly run_id: string
  readonly def_kind: RunDefKind
  readonly def_name: string
  readonly def_version: string
  readonly input_json: string
  readonly status: RunStatusDb
  readonly waiting_gate: string | null
  readonly parent_run_id: string | null
  readonly parent_step_key: string | null
  readonly attempt: number
  readonly retried_from_run_id: string | null
  readonly output_json: string | null
  readonly error_json: string | null
  readonly cancel_cause: string | null
  readonly claimed_by: string | null
  readonly claimed_at: number | null
  readonly created_at: number
  readonly updated_at: number
  readonly finished_at: number | null
}

/** One `journal` row (spec §3.2; skeleton columns — `retry_policy_json` is added by a later migration when the retry surface lands). */
export interface JournalRow {
  readonly run_id: string
  readonly step_key: string
  readonly name: string
  readonly occurrence: number
  readonly kind: JournalKindDb
  readonly status: JournalStatusDb
  readonly value_json: string | null
  readonly error_json: string | null
  readonly attempt: number
  readonly session_id: string | null
  readonly session_seq: number | null
  readonly started_at: number
  readonly finished_at: number | null
}

/** One `promises` row (spec §3.3). `payload_json` carries the resolved value, or the rejection reason for `rejected`. */
export interface PromiseRow {
  readonly run_id: string
  readonly gate: string
  readonly state: PromiseStateDb
  readonly payload_json: string | null
  readonly schema_json: string | null
  readonly timeout_at: number | null
  readonly resolution_source: PromiseResolutionSource | null
  readonly created_at: number
  readonly resolved_at: number | null
}

/**
 * Apply pending migration segments. Each segment runs its SQL plus its
 * `PRAGMA user_version` stamp inside one transaction, so a failed segment
 * rolls back whole and never advances the stamp. A database stamped newer
 * than the newest segment rejects (forward compatibility comes from
 * migrations, backward is not promised — pre-release stance).
 * @param db - Open ledger database.
 * @param migrations - Ordered segments; defaults to the shipped set.
 */
export function migrateDatabase(db: DatabaseSync, migrations: readonly Migration[] = MIGRATIONS): void {
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const newest = newestVersionOf(migrations)
  if (onDisk > newest) {
    throw new Error(
      `daypaw ledger has schema version ${onDisk}, newer than this build (${newest}); upgrade @daypaw/store first`,
    )
  }
  for (const segment of migrations) {
    if (segment.version <= onDisk) continue
    db.exec('BEGIN')
    try {
      db.exec(segment.sql)
      // A validated integer interpolated into a non-bindable PRAGMA.
      db.exec(`PRAGMA user_version = ${segment.version}`)
      db.exec('COMMIT')
    } catch (error: unknown) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

/* jscpd:ignore-start -- deliberately mirrors the storage-sqlite open
   sequence (its copy records the shared-media-helper deferral); this is the
   fourth user of the same owner-only SQLite open ritual. */
/**
 * Exclusively create a missing database file with owner-only permissions;
 * existing files keep their modes, errors other than `EEXIST` propagate.
 * `DatabaseSync` reopens by path, so this does not protect confidentiality
 * or integrity when another principal can replace the database entry in its
 * parent directory.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}
/* jscpd:ignore-end */

/**
 * Open (creating if needed) the engine ledger database and bring it to the
 * current schema version. Missing parent directories and database files are
 * created owner-only; `:memory:` skips filesystem setup. Pragmas: WAL,
 * `busy_timeout` {@link LEDGER_BUSY_TIMEOUT_MS}, `foreign_keys ON`.
 * @param path - Database file path, or `:memory:`.
 * @returns the open, migrated database handle.
 */
export async function openLedgerDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(`PRAGMA busy_timeout = ${LEDGER_BUSY_TIMEOUT_MS}`)
    // WAL on `:memory:` reports `memory` back; the call is still valid.
    db.exec('PRAGMA journal_mode = WAL')
    migrateDatabase(db)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}
