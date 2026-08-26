/**
 * The inbox board projection: the single derivation from the sessions list
 * plus the engine's run ledger to per-group counts and task rows, shared by
 * InboxNav's group counts and WorkspaceSwitch's task-list owner props.
 * Business grouping over the wire: a top-level run (agent or workflow) or a
 * run-less session still running/waiting is 进行中, a settled one is 已完成,
 * and either kind carrying the runtime list row's `pendingInteraction:
 * 'approval'` badge moves to 「等待你确认」 regardless of its status group —
 * the badge is the dsh interactive-approval face's cross-session aggregation
 * (apiproxy pending replay restores it on every mux open), and answering the
 * approval clears it, so the row falls back to its status group. The badge
 * collapses a session's pending interactions to one actionable status with
 * questions winning over approvals, so a question-shadowed approval does not
 * route here; plan-review and question badges never do (the board is the
 * 审批待办 surface, not the ask-user one).
 *
 * Merge order: within one group, rows sort by updatedAt descending (most
 * recently active first); ties keep collection order, which is run rows (in
 * ledger order) before run-less session rows (in sessions-list order).
 */
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { TaskRow } from './contract.ts'
import type { WireRun } from './runs-api.ts'
import type { InboxGroup } from './selection.ts'

/** Per-group counts and rows, one projection pass. */
export interface InboxBoard {
  /** Row counts keyed by group. */
  counts: Record<InboxGroup, number>
  /** Projected rows keyed by group, in merge order (updatedAt desc). */
  rows: Record<InboxGroup, readonly TaskRow[]>
}

/** The status group a run lands in when no approval pends. */
function runGroup(run: WireRun): 'running' | 'done' {
  return run.status === 'running' || run.status === 'waiting' ? 'running' : 'done'
}

/** Whether the session row carries a pending approval (the 等待你确认 triage). */
function awaitsApproval(summary: SessionSummary | undefined): boolean {
  return summary?.pendingInteraction === 'approval'
}

/**
 * Project the sessions list snapshot and the run ledger into the inbox board.
 * @param list - the sessions list snapshot (useSessions standard feed).
 * @param runs - the run ledger's rows (the board store's latest fetch).
 * @returns counts and rows for the three groups.
 */
export function projectInboxBoard(list: SessionListState, runs: readonly WireRun[]): InboxBoard {
  const runRows: Record<InboxGroup, TaskRow[]> = { pending: [], running: [], done: [] }
  // Agent runs claim their session twin: an agent run's session identity IS
  // its runId, so the sessions-list row of the same id would double-list.
  const claimed = new Set<string>()
  for (const run of runs) {
    // Child runs live under their parent's lineage, never on the board.
    if (run.parentRunId !== null) continue
    const summary = list.byId[run.runId as SessionId]
    const awaiting = awaitsApproval(summary)
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
      ...awaiting ? { awaitingApproval: true as const } : {},
    }
    if (run.defKind === 'agent') claimed.add(run.runId)
    runRows[awaiting ? 'pending' : runGroup(run)].push(row)
  }
  const sessionRows: Record<InboxGroup, TaskRow[]> = { pending: [], running: [], done: [] }
  for (const id of list.ids) {
    const summary = list.byId[id]
    // Blank sessions are reusable drafts, not tasks; unlisted ids cannot row;
    // a run-claimed id is the agent run's twin.
    if (summary === undefined || summary.blank || claimed.has(id)) continue
    const awaiting = awaitsApproval(summary)
    const row: TaskRow = {
      sessionId: id,
      title: summary.displayTitle,
      updatedAt: summary.updatedAt,
      ...summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset },
      ...awaiting ? { awaitingApproval: true as const } : {},
    }
    const group: InboxGroup = awaiting ? 'pending' : summary.running ? 'running' : 'done'
    sessionRows[group].push(row)
  }
  const merge = (group: InboxGroup): readonly TaskRow[] =>
    [...runRows[group], ...sessionRows[group]].sort((a, b) => b.updatedAt - a.updatedAt)
  const pending = merge('pending')
  const running = merge('running')
  const done = merge('done')
  return {
    counts: { pending: pending.length, running: running.length, done: done.length },
    rows: { pending, running, done },
  }
}
