/**
 * Numbered hand-written SQL migration segments for the engine ledger.
 *
 * Each segment lands inside one transaction together with its
 * `PRAGMA user_version` stamp, so a half-applied segment rolls back whole.
 * SQL lives in TS template strings rather than `.sql` files so the compiled
 * `lib/` output stays self-contained (tsc does not copy asset files); every
 * review property the spec names — numbered, monotonic, diff-readable — is
 * kept. See docs/spec/01-durable-execution.md §4.
 * @module @daypaw/store/migrations
 */

/**
 * One migration segment.
 */
export interface Migration {
  /** Target `PRAGMA user_version` after this segment; strictly increasing. */
  readonly version: number
  /** Segment name for diagnostics. */
  readonly name: string
  /** SQL text applied inside the segment's transaction. */
  readonly sql: string
}

const INIT_SQL = `
CREATE TABLE runs (
  run_id              TEXT PRIMARY KEY,
  def_kind            TEXT NOT NULL CHECK (def_kind IN ('workflow', 'agent')),
  def_name            TEXT NOT NULL,
  def_version         TEXT NOT NULL,
  input_json          TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('running', 'waiting', 'done', 'failed', 'cancelled')),
  waiting_gate        TEXT,
  parent_run_id       TEXT,
  parent_step_key     TEXT,
  attempt             INTEGER NOT NULL DEFAULT 1,
  retried_from_run_id TEXT,
  output_json         TEXT,
  error_json          TEXT,
  cancel_cause        TEXT,
  claimed_by          TEXT,
  claimed_at          INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  finished_at         INTEGER
) STRICT;

CREATE TABLE journal (
  run_id      TEXT NOT NULL REFERENCES runs(run_id),
  step_key    TEXT NOT NULL,
  name        TEXT NOT NULL,
  occurrence  INTEGER NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'step',
  status      TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'failed')),
  value_json  TEXT,
  error_json  TEXT,
  attempt     INTEGER NOT NULL DEFAULT 1,
  session_id  TEXT,
  session_seq INTEGER,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY (run_id, step_key)
) STRICT;

CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_journal_run ON journal(run_id);
`

const PROMISES_SQL = `
CREATE TABLE promises (
  run_id            TEXT NOT NULL REFERENCES runs(run_id),
  gate              TEXT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'resolved', 'rejected', 'timedout', 'cancelled')),
  payload_json      TEXT,
  schema_json       TEXT,
  timeout_at        INTEGER,
  resolution_source TEXT CHECK (resolution_source IN ('sdk', 'manager', 'webhook')),
  created_at        INTEGER NOT NULL,
  resolved_at       INTEGER,
  PRIMARY KEY (run_id, gate)
) STRICT;
`

/**
 * Ordered migration segments; the last entry's version is the current
 * schema version. Append-only: never edit a shipped segment.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'init', sql: INIT_SQL },
  { version: 2, name: 'promises', sql: PROMISES_SQL },
]
