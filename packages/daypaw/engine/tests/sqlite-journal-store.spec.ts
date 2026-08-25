import { describe, expect, it } from 'vitest'
import { openLedgerDatabase } from '@daypaw/store'
import { SqliteJournalStore } from '@daypaw/engine'
import type { RunInsert } from '@daypaw/engine'

/** A complete insert payload; tests override the fields under test. */
function insert(overrides: Partial<RunInsert>): RunInsert {
  const now = Date.now()
  return {
    runId: 'row-1',
    defKind: 'workflow',
    defName: 'demo',
    defVersion: '1',
    inputJson: 'null',
    parentRunId: undefined,
    parentStepKey: undefined,
    claimedBy: 'test-instance',
    claimedAt: now,
    createdAt: now,
    ...overrides,
  }
}

describe('SqliteJournalStore.insertRun attempt-chain fields', () => {
  it('defaults attempt to 1 and retried_from_run_id to null', async () => {
    const db = await openLedgerDatabase(':memory:')
    try {
      const store = new SqliteJournalStore(db)
      store.insertRun(insert({}))
      const row = store.selectRun('row-1')
      expect(row?.attempt).toBe(1)
      expect(row?.retried_from_run_id).toBeNull()
    } finally {
      db.close()
    }
  })

  it('round-trips an explicit attempt and retriedFromRunId', async () => {
    const db = await openLedgerDatabase(':memory:')
    try {
      const store = new SqliteJournalStore(db)
      store.insertRun(insert({ runId: 'origin-1' }))
      store.insertRun(insert({ runId: 'retry-1', attempt: 2, retriedFromRunId: 'origin-1' }))
      const row = store.selectRun('retry-1')
      expect(row?.attempt).toBe(2)
      expect(row?.retried_from_run_id).toBe('origin-1')
    } finally {
      db.close()
    }
  })
})
