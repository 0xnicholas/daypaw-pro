/** projectInboxBoard: the hybrid run+session+roster projection — dedupe, session-less workflow rows, status grouping, merge order. */
import { describe, expect, it } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WireRun, WireRunStatus } from '../src/client/runs-api.ts'
import { projectInboxBoard } from '../src/client/task-projection.ts'

function run(overrides: Partial<WireRun> = {}): WireRun {
  return {
    runId: 'r1',
    defKind: 'workflow',
    defName: 'close-the-books',
    status: 'running',
    parentRunId: null,
    outputJson: null,
    updatedAt: 100,
    ...overrides,
  }
}

interface SummarySpec {
  id: string
  running?: boolean
  blank?: boolean
  title?: string
  updatedAt?: number
}

function listState(rows: readonly SummarySpec[]): SessionListState {
  const byId: SessionListState['byId'] = {}
  for (const row of rows) {
    byId[row.id as SessionId] = {
      id: row.id as SessionId,
      displayTitle: row.title ?? `title-${row.id}`,
      running: row.running ?? false,
      blank: row.blank ?? false,
      updatedAt: row.updatedAt ?? 1,
    }
  }
  return {
    ids: rows.map(row => row.id as SessionId),
    byId,
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

/** Roster entry carrying one effective interaction kind. */
const interaction = (kind: string): SessionPendingInteraction =>
  ({ key: `fx-${kind}`, kind, sessionId: 'x' as SessionId }) as unknown as SessionPendingInteraction

/** Roster map helper: id → effective kind. */
function roster(entries: readonly (readonly [string, string])[]): ReadonlyMap<SessionId, SessionPendingInteraction> {
  return new Map(entries.map(([id, kind]) => [id as SessionId, interaction(kind)]))
}

describe('projectInboxBoard', () => {
  it('projects an empty board from nothing', () => {
    expect(projectInboxBoard(listState([]), [], roster([]))).toEqual({
      counts: { pending: 0, running: 0, done: 0 },
      rows: { pending: [], running: [], done: [] },
    })
  })

  it('projects run-less sessions verbatim: blank drafts and unlisted ids never row', () => {
    const list = listState([{ id: 'a', running: true }, { id: 'b' }, { id: 'draft', blank: true }])
    // An id the list names but byId lacks (reconnect re-pull window) projects no row.
    list.ids.push('ghost' as SessionId)
    const board = projectInboxBoard(list, [], roster([]))
    expect(board.counts).toEqual({ pending: 0, running: 1, done: 1 })
    expect(board.rows.running.map(row => [row.title, row.sessionId, row.run])).toEqual([['title-a', 'a', undefined]])
    expect(board.rows.done.map(row => row.title)).toEqual(['title-b'])
  })

  it('projects an agent run as a session-backed row and dedupes its session twin', () => {
    const list = listState([{ id: 'r1', title: 'Fix the flaky test', updatedAt: 50 }])
    const board = projectInboxBoard(list, [run({ runId: 'r1', defKind: 'agent', defName: 'fix-tests', updatedAt: 300 })], roster([]))
    expect(board.counts).toEqual({ pending: 0, running: 1, done: 0 })
    // The session's displayTitle wins over the defName; the twin session row is skipped.
    expect(board.rows.running).toEqual([{
      sessionId: 'r1',
      title: 'Fix the flaky test',
      updatedAt: 300,
      run: { runId: 'r1', status: 'running', defKind: 'agent' },
    }])
  })

  it('projects an unlisted agent run session-less (sessions.open fails loud on unlisted ids)', () => {
    const board = projectInboxBoard(listState([]), [run({ runId: 'r1', defKind: 'agent', defName: 'fix-tests' })], roster([]))
    expect(board.rows.running).toEqual([{
      title: 'fix-tests',
      updatedAt: 100,
      run: { runId: 'r1', status: 'running', defKind: 'agent' },
    }])
  })

  it('falls back to the defName when the agent run\'s session twin is a blank draft (still deduped)', () => {
    const board = projectInboxBoard(
      listState([{ id: 'r1', blank: true }]),
      [run({ runId: 'r1', defKind: 'agent', defName: 'fix-tests' })],
      roster([]),
    )
    expect(board.rows.running.map(row => row.title)).toEqual(['fix-tests'])
    expect(board.counts).toEqual({ pending: 0, running: 1, done: 0 })
  })

  it('projects a workflow run as a session-less row titled by its defName', () => {
    const board = projectInboxBoard(listState([]), [run({ runId: 'r1', defKind: 'workflow', defName: 'close-the-books' })], roster([]))
    expect(board.rows.running).toEqual([{
      title: 'close-the-books',
      updatedAt: 100,
      run: { runId: 'r1', status: 'running', defKind: 'workflow' },
    }])
  })

  it.each([
    ['running', 'running'],
    ['waiting', 'running'],
    ['done', 'done'],
    ['failed', 'done'],
    ['cancelled', 'done'],
  ] as const)('groups a %s run into %s', (status: WireRunStatus, group: 'running' | 'done') => {
    const board = projectInboxBoard(listState([]), [run({ status })], roster([]))
    expect(board.counts[group]).toBe(1)
    expect(board.rows[group][0]?.run?.status).toBe(status)
  })

  it('never lists child runs (parent_run_id set)', () => {
    const board = projectInboxBoard(listState([]), [
      run({ runId: 'parent' }),
      run({ runId: 'child', parentRunId: 'parent' }),
    ], roster([]))
    expect(board.counts).toEqual({ pending: 0, running: 1, done: 0 })
    expect(board.rows.running[0]?.run?.runId).toBe('parent')
  })

  it('merges run rows and session rows in updatedAt-desc order, ties keep collection order (runs first)', () => {
    const list = listState([
      { id: 'old-session', updatedAt: 10 },
      { id: 'tie-session', running: true, updatedAt: 100 },
    ])
    const board = projectInboxBoard(list, [
      run({ runId: 'tie-run', defKind: 'workflow', updatedAt: 100 }),
      run({ runId: 'new-run', defKind: 'workflow', status: 'done', updatedAt: 500 }),
      run({ runId: 'mid-run', defKind: 'workflow', status: 'done', updatedAt: 50 }),
    ], roster([]))
    expect(board.rows.running.map(row => row.title)).toEqual(['close-the-books', 'title-tie-session'])
    // Done group: the two runs lead (updatedAt desc), the settled session trails.
    expect(board.rows.done.map(row => row.run?.runId ?? 'session')).toEqual(['new-run', 'mid-run', 'session'])
  })

  it('routes an approval-badged run row to 等待你确认 and flags it, whatever the run status', () => {
    const board = projectInboxBoard(
      listState([{ id: 'r1', title: 'Fix the flaky test' }]),
      [run({ runId: 'r1', defKind: 'agent', defName: 'fix-tests', updatedAt: 300 })],
      roster([['r1', 'approval']]),
    )
    expect(board.counts).toEqual({ pending: 1, running: 0, done: 0 })
    expect(board.rows.pending).toEqual([{
      sessionId: 'r1',
      title: 'Fix the flaky test',
      updatedAt: 300,
      run: { runId: 'r1', status: 'running', defKind: 'agent' },
      awaitingApproval: true,
    }])
  })

  it('routes an approval-badged run-less session to 等待你确认', () => {
    const board = projectInboxBoard(listState([{ id: 'a', running: true }]), [], roster([['a', 'approval']]))
    expect(board.counts).toEqual({ pending: 1, running: 0, done: 0 })
    expect(board.rows.pending.map(row => [row.sessionId, row.awaitingApproval])).toEqual([['a', true]])
  })

  it('keeps question and other interaction kinds in their status groups (the board is the 审批 surface)', () => {
    const list = listState([
      { id: 'q', running: true },
      { id: 'o' },
    ])
    const board = projectInboxBoard(list, [], roster([['q', 'question'], ['o', 'other']]))
    expect(board.counts).toEqual({ pending: 0, running: 1, done: 1 })
    expect(board.rows.running.every(row => row.awaitingApproval === undefined)).toBe(true)
    expect(board.rows.done.every(row => row.awaitingApproval === undefined)).toBe(true)
  })
})
