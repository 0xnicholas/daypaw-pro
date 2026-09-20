/** The wire parsers: every field the browser planes read validates fail-loud. */
import { describe, expect, it } from 'vitest'
import {
  parseOptionalWireRun,
  parseWireDefinition,
  parseWireJournalEntry,
  parseWireRun,
} from '../src/client/wire.ts'

/** A complete, valid wire run row. */
function runRow(): Record<string, unknown> {
  return {
    run_id: 'run-1',
    def_kind: 'agent',
    def_name: 'weekly-report',
    status: 'running',
    waiting_gate: null,
    parent_run_id: null,
    output_json: null,
    updated_at: 1_000,
  }
}

/** A complete, valid wire journal row. */
function journalRow(): Record<string, unknown> {
  return {
    step_key: 'collect',
    name: 'Collect updates',
    occurrence: 1,
    kind: 'step',
    status: 'completed',
    session_id: null,
    started_at: 1_000,
    finished_at: 2_000,
  }
}

/** A complete, valid wire definition entry. */
function definitionRow(): Record<string, unknown> {
  return {
    kind: 'agent',
    name: 'weekly-report',
    version: '1.2.0',
    display: { title: 'Weekly report', description: 'Drafts the weekly report.' },
    inputKind: 'text',
  }
}

describe('parseWireRun', () => {
  it('projects a valid row to camelCase', () => {
    expect(parseWireRun(runRow())).toEqual({
      runId: 'run-1',
      defKind: 'agent',
      defName: 'weekly-report',
      status: 'running',
      waitingGate: null,
      parentRunId: null,
      outputJson: null,
      updatedAt: 1_000,
    })
  })

  it('accepts the settled shapes: workflow kind, parent, output, every status', () => {
    for (const status of ['waiting', 'done', 'failed', 'cancelled'] as const) {
      const row = runRow()
      row['status'] = status
      expect(parseWireRun(row).status).toBe(status)
    }
    const row = runRow()
    row['def_kind'] = 'workflow'
    row['parent_run_id'] = 'parent-1'
    row['output_json'] = '{"result":"ok"}'
    const parsed = parseWireRun(row)
    expect(parsed.defKind).toBe('workflow')
    expect(parsed.parentRunId).toBe('parent-1')
    expect(parsed.outputJson).toBe('{"result":"ok"}')
    const gated = runRow()
    gated['status'] = 'waiting'
    gated['waiting_gate'] = 'owner-approval'
    expect(parseWireRun(gated).waitingGate).toBe('owner-approval')
  })

  it('rejects non-objects', () => {
    expect(() => parseWireRun(null)).toThrow('durable-client: run row is not an object')
    expect(() => parseWireRun('row')).toThrow('durable-client: run row is not an object')
  })

  it('rejects every missing or malformed field it reads', () => {
    const cases: readonly [string, unknown][] = [
      ['run_id', 7],
      ['def_name', 7],
      ['def_kind', 'cron'],
      ['status', 'paused'],
      ['waiting_gate', 7],
      ['parent_run_id', 7],
      ['output_json', 7],
      ['updated_at', '1000'],
    ]
    for (const [field, bad] of cases) {
      const row = runRow()
      row[field] = bad
      expect(() => parseWireRun(row), field).toThrow('durable-client: run row')
    }
  })
})

describe('parseOptionalWireRun', () => {
  it('reads absent members as undefined', () => {
    expect(parseOptionalWireRun(null)).toBeUndefined()
    expect(parseOptionalWireRun(undefined)).toBeUndefined()
  })

  it('parses present members', () => {
    expect(parseOptionalWireRun(runRow())?.runId).toBe('run-1')
  })
})

describe('parseWireJournalEntry', () => {
  it('projects a valid row to camelCase', () => {
    expect(parseWireJournalEntry(journalRow())).toEqual({
      stepKey: 'collect',
      name: 'Collect updates',
      occurrence: 1,
      kind: 'step',
      status: 'completed',
      sessionId: null,
      startedAt: 1_000,
      finishedAt: 2_000,
    })
  })

  it('accepts segment rows, unfinished steps, and session-bound steps', () => {
    const row = journalRow()
    row['kind'] = 'segment'
    row['status'] = 'started'
    row['session_id'] = 'run-1'
    row['finished_at'] = null
    const parsed = parseWireJournalEntry(row)
    expect(parsed.kind).toBe('segment')
    expect(parsed.status).toBe('started')
    expect(parsed.sessionId).toBe('run-1')
    expect(parsed.finishedAt).toBeNull()
  })

  it('rejects non-objects', () => {
    expect(() => parseWireJournalEntry(null)).toThrow('durable-client: journal entry is not an object')
  })

  it('rejects every missing or malformed field it reads', () => {
    const cases: readonly [string, unknown][] = [
      ['step_key', 7],
      ['name', 7],
      ['occurrence', '1'],
      ['kind', 'note'],
      ['status', 'skipped'],
      ['session_id', 7],
      ['started_at', '1000'],
      ['finished_at', '2000'],
    ]
    for (const [field, bad] of cases) {
      const row = journalRow()
      row[field] = bad
      expect(() => parseWireJournalEntry(row), field).toThrow('durable-client: journal entry')
    }
  })
})

describe('parseWireDefinition', () => {
  it('projects a valid entry with display metadata', () => {
    expect(parseWireDefinition(definitionRow())).toEqual({
      kind: 'agent',
      name: 'weekly-report',
      version: '1.2.0',
      display: { title: 'Weekly report', description: 'Drafts the weekly report.' },
      inputKind: 'text',
    })
  })

  it('accepts an absent display key, a null inputKind, and workflow kinds', () => {
    const row = definitionRow()
    delete row['display']
    row['inputKind'] = null
    row['kind'] = 'workflow'
    const parsed = parseWireDefinition(row)
    expect('display' in parsed).toBe(false)
    expect(parsed.inputKind).toBeNull()
    expect(parsed.kind).toBe('workflow')
  })

  it('rejects non-objects', () => {
    expect(() => parseWireDefinition(null)).toThrow('durable-client: definition entry is not an object')
  })

  it('rejects every missing or malformed field it reads', () => {
    const cases: readonly [string, unknown][] = [
      ['kind', 'cron'],
      ['name', 7],
      ['version', 7],
      ['inputKind', 'yaml'],
      ['display', 7],
    ]
    for (const [field, bad] of cases) {
      const row = definitionRow()
      row[field] = bad
      expect(() => parseWireDefinition(row), field).toThrow('durable-client: definition')
    }
    const partialDisplay = definitionRow()
    partialDisplay['display'] = { title: 'Weekly report' }
    expect(() => parseWireDefinition(partialDisplay)).toThrow('durable-client: definition display misses title/description')
  })
})
