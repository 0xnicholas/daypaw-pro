/**
 * The inbox board projection: the single derivation from the sessions list
 * plus the engine's run ledger to per-group counts and task rows, shared by
 * InboxNav's group counts and WorkspaceSwitch's task-list owner props.
 * Business grouping over the wire: a top-level run (agent or workflow) or a
 * run-less session still running/waiting is 进行中, a settled one is 已完成;
 * 「等待你确认」 stays an empty placeholder until the approval board ticket
 * (#58) wires pending interactions.
 *
 * Merge order: within one group, rows sort by updatedAt descending (most
 * recently active first); ties keep collection order, which is run rows (in
 * ledger order) before run-less session rows (in sessions-list order).
 */
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { TaskRow } from './contract.ts'
import type { WireRun } from './runs-api.ts'
import type { InboxGroup } from './selection.ts'

/** Per-group counts and rows, one projection pass. */
export interface InboxBoard {
  /** Row counts keyed by group (pending is the placeholder zero). */
  counts: Record<InboxGroup, number>
  /** Projected rows keyed by group, in merge order (updatedAt desc). */
  rows: Record<InboxGroup, readonly TaskRow[]>
}

/** The group a run status lands in. */
function runGroup(run: WireRun): 'running' | 'done' {
  return run.status === 'running' || run.status === 'waiting' ? 'running' : 'done'
}

/**
 * Project the sessions list snapshot and the run ledger into the inbox board.
 * @param list - the sessions list snapshot (useSessions standard feed).
 * @param runs - the run ledger's rows (the board store's latest fetch).
 * @returns counts and rows for the three groups.
 */
export function projectInboxBoard(list: SessionListState, runs: readonly WireRun[]): InboxBoard {
  const runRows: Record<'running' | 'done', TaskRow[]> = { running: [], done: [] }
  // Agent runs claim their session twin: an agent run's session identity IS
  // its runId, so the sessions-list row of the same id would double-list.
  const claimed = new Set<string>()
  for (const run of runs) {
    // Child runs live under their parent's lineage, never on the board.
    if (run.parentRunId !== null) continue
    const summary = list.byId[run.runId as SessionId]
    const row: TaskRow = {
      // The row carries a session identity only when the twin is actually
      // listed: sessions.open fails loud on unlisted ids, so an untwinned
      // agent run routes through the run selection like a workflow run (the
      // engine creates the session with the first drive; the list projection
      // lags the ledger). Workflow runs never have one.
      ...run.defKind === 'agent' && summary !== undefined ? { sessionId: run.runId as SessionId } : {},
      title: run.defKind === 'agent' && summary !== undefined && !summary.blank ? summary.displayTitle : run.defName,
      ...summary?.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset },
      updatedAt: run.updatedAt,
      run: { runId: run.runId, status: run.status, defKind: run.defKind },
    }
    if (run.defKind === 'agent') claimed.add(run.runId)
    runRows[runGroup(run)].push(row)
  }
  const sessionRows: Record<'running' | 'done', TaskRow[]> = { running: [], done: [] }
  for (const id of list.ids) {
    const summary = list.byId[id]
    // Blank sessions are reusable drafts, not tasks; unlisted ids cannot row;
    // a run-claimed id is the agent run's twin.
    if (summary === undefined || summary.blank || claimed.has(id)) continue
    const row: TaskRow = {
      sessionId: id,
      title: summary.displayTitle,
      updatedAt: summary.updatedAt,
      ...summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset },
    }
    ;(summary.running ? sessionRows.running : sessionRows.done).push(row)
  }
  const merge = (group: 'running' | 'done'): readonly TaskRow[] =>
    [...runRows[group], ...sessionRows[group]].sort((a, b) => b.updatedAt - a.updatedAt)
  const running = merge('running')
  const done = merge('done')
  return {
    counts: { pending: 0, running: running.length, done: done.length },
    rows: { pending: [], running, done },
  }
}
