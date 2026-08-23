import { afterEach, describe, expect, it } from 'vitest'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import {
  DAYPAW_STORE_SCHEMA_VERSION, JOURNAL_TABLE, MIGRATIONS, PROMISES_TABLE, RUNS_TABLE,
  migrateDatabase, newestVersionOf, openLedgerDatabase,
} from '../src/index.ts'
import type { Migration } from '../src/index.ts'

const goldenV1 = fileURLToPath(new URL('./fixtures/golden/0001-v1.db', import.meta.url))
const goldenV2 = fileURLToPath(new URL('./fixtures/golden/0002-v2.db', import.meta.url))

/** Column names of one table, in declaration order. */
function columnsOf(db: DatabaseSync, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .map(row => (row as { name: string }).name)
}

/** Sorted `sqlite_master` DDL entries (tables + indexes), the schema fingerprint. */
function schemaFingerprint(db: DatabaseSync): string[] {
  return (db.prepare(
    'SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY sql',
  ).all() as { sql: string }[]).map(row => row.sql).sort()
}

let root: string | undefined

async function tmpDir(prefix: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix))
  return root
}

describe('openLedgerDatabase', () => {
  it('creates the current schema on a fresh file with pragmas applied', async () => {
    const dir = await tmpDir('daypaw-store-fresh-')
    const db = await openLedgerDatabase(join(dir, 'ledger.db'))
    try {
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
        .toBe(DAYPAW_STORE_SCHEMA_VERSION)
      expect(columnsOf(db, RUNS_TABLE)).toEqual([
        'run_id', 'def_kind', 'def_name', 'def_version', 'input_json', 'status',
        'waiting_gate', 'parent_run_id', 'parent_step_key', 'attempt',
        'retried_from_run_id', 'output_json', 'error_json', 'cancel_cause',
        'claimed_by', 'claimed_at', 'created_at', 'updated_at', 'finished_at',
      ])
      expect(columnsOf(db, JOURNAL_TABLE)).toEqual([
        'run_id', 'step_key', 'name', 'occurrence', 'kind', 'status',
        'value_json', 'error_json', 'attempt', 'session_id', 'session_seq',
        'started_at', 'finished_at',
      ])
      expect(columnsOf(db, PROMISES_TABLE)).toEqual([
        'run_id', 'gate', 'state', 'payload_json', 'schema_json',
        'timeout_at', 'resolution_source', 'created_at', 'resolved_at',
      ])
      expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode)
        .toBe('wal')
      expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys)
        .toBe(1)
      expect((db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout)
        .toBe(5_000)
    } finally {
      db.close()
    }
  })

  it('supports :memory: databases', async () => {
    const db = await openLedgerDatabase(':memory:')
    try {
      expect(columnsOf(db, RUNS_TABLE).length).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  it('reopens an existing ledger without remigrating', async () => {
    const dir = await tmpDir('daypaw-store-reopen-')
    const path = join(dir, 'ledger.db')
    const first = await openLedgerDatabase(path)
    first.exec(`INSERT INTO ${RUNS_TABLE} (run_id, def_kind, def_name, def_version, input_json, status, attempt, created_at, updated_at)
      VALUES ('r1', 'workflow', 'demo', '1', '{}', 'running', 1, 0, 0)`)
    first.close()
    const second = await openLedgerDatabase(path)
    try {
      expect((second.prepare(`SELECT count(*) AS n FROM ${RUNS_TABLE}`).get() as { n: number }).n)
        .toBe(1)
    } finally {
      second.close()
    }
  })

  it('rejects a database stamped newer than this build', async () => {
    const dir = await tmpDir('daypaw-store-future-')
    const path = join(dir, 'ledger.db')
    const stamp = await openLedgerDatabase(path)
    stamp.exec(`PRAGMA user_version = ${DAYPAW_STORE_SCHEMA_VERSION + 5}`)
    stamp.close()
    await expect(openLedgerDatabase(path)).rejects.toThrow(/newer than this build/)
  })

  it('migrates the committed golden v1 fixture to the current schema (spec §4 N-1 → N)', async () => {
    const dir = await tmpDir('daypaw-store-golden-v1-')
    const copy = join(dir, 'golden-copy.db')
    await cp(goldenV1, copy)
    const golden = await openLedgerDatabase(copy)
    const fresh = await openLedgerDatabase(':memory:')
    try {
      expect((golden.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
        .toBe(DAYPAW_STORE_SCHEMA_VERSION)
      expect(schemaFingerprint(golden)).toEqual(schemaFingerprint(fresh))
    } finally {
      golden.close()
      fresh.close()
    }
  })

  it('opens the committed golden v2 fixture without changes', async () => {
    const dir = await tmpDir('daypaw-store-golden-v2-')
    const copy = join(dir, 'golden-copy.db')
    await cp(goldenV2, copy)
    const golden = await openLedgerDatabase(copy)
    const fresh = await openLedgerDatabase(':memory:')
    try {
      expect((golden.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
        .toBe(DAYPAW_STORE_SCHEMA_VERSION)
      expect(schemaFingerprint(golden)).toEqual(schemaFingerprint(fresh))
    } finally {
      golden.close()
      fresh.close()
    }
  })
})

describe('migrateDatabase', () => {
  it('rolls a failed segment back whole and leaves the stamp untouched', async () => {
    const db = await openLedgerDatabase(':memory:')
    try {
      const bad: Migration = {
        version: DAYPAW_STORE_SCHEMA_VERSION + 1,
        name: 'broken',
        sql: 'CREATE TABLE broken (x INTEGER) STRICT; NOT VALID SQL AT ALL;',
      }
      expect(() =>{  migrateDatabase(db, [bad]) }).toThrow()
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
        .toBe(DAYPAW_STORE_SCHEMA_VERSION)
      expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'broken'")
        .get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('commits segments one by one: an earlier good segment survives a later failure', async () => {
    const db = await openLedgerDatabase(':memory:')
    try {
      const good: Migration = {
        version: DAYPAW_STORE_SCHEMA_VERSION + 1,
        name: 'good',
        sql: 'CREATE TABLE good_addition (x INTEGER) STRICT;',
      }
      const bad: Migration = {
        version: DAYPAW_STORE_SCHEMA_VERSION + 2,
        name: 'broken',
        sql: 'CREATE TABLE never_created (x INTEGER) STRICT; ALSO NOT SQL;',
      }
      expect(() =>{  migrateDatabase(db, [good, bad]) }).toThrow()
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
        .toBe(DAYPAW_STORE_SCHEMA_VERSION + 1)
      expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'good_addition'")
        .get()).toEqual({ n: 1 })
      expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'never_created'")
        .get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('applies a pending segment to an older database', async () => {
    const db = await openLedgerDatabase(':memory:')
    try {
      const next: Migration = {
        version: DAYPAW_STORE_SCHEMA_VERSION + 1,
        name: 'add-column',
        sql: `ALTER TABLE ${RUNS_TABLE} ADD COLUMN probe TEXT;`,
      }
      db.exec(`PRAGMA user_version = ${DAYPAW_STORE_SCHEMA_VERSION - 1}`)
      migrateDatabase(db, [next])
      expect(columnsOf(db, RUNS_TABLE)).toContain('probe')
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
        .toBe(DAYPAW_STORE_SCHEMA_VERSION + 1)
    } finally {
      db.close()
    }
  })
})

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('newestVersionOf', () => {
  it('reads 0 from an empty migration list', () => {
    expect(newestVersionOf([])).toBe(0)
  })

  it('reads the last segment version from the shipped list', () => {
    expect(newestVersionOf(MIGRATIONS)).toBe(DAYPAW_STORE_SCHEMA_VERSION)
  })
})

describe('openLedgerDatabase error paths', () => {
  it('migrates nothing for an empty migration list', () => {
    const db = new DatabaseSync(':memory:')
    try {
      expect(() => { migrateDatabase(db, []) }).not.toThrow()
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
        .toBe(0)
    } finally {
      db.close()
    }
  })

  it('propagates non-EEXIST filesystem errors from file creation', async () => {
    const dir = await tmpDir('daypaw-store-enotdir-')
    const plainFile = join(dir, 'plain-file')
    await (await import('node:fs/promises')).writeFile(plainFile, 'x')
    await expect(openLedgerDatabase(join(plainFile, 'nested', 'ledger.db'))).rejects.toThrow()
  })
})

describe('openLedgerDatabase file-mode errors', () => {
  it('propagates non-EEXIST file-creation errors (EACCES parent)', async () => {
    const dir = await tmpDir('daypaw-store-eacces-')
    const ro = join(dir, 'ro')
    await (await import('node:fs/promises')).mkdir(ro, { mode: 0o500 })
    await expect(openLedgerDatabase(join(ro, 'ledger.db'))).rejects.toThrow()
  })
})
