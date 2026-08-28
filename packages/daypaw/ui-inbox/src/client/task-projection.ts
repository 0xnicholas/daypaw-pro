/**
 * The inbox board projection: the single derivation from the sessions list,
 * the engine's run ledger, and the pending-interaction roster to per-group
 * counts and task rows, shared by InboxNav's group counts and
 * WorkspaceSwitch's task-list owner props.
 * Business grouping over the wire: a top-level run (agent or workflow) or a
 * run-less session still running/waiting is 进行中, a settled one is 已完成,
 * and either kind whose session carries the effective 'approval' pending
 * interaction moves to 「等待你确认」 regardless of its status group — the
 * roster is the interactive-approval face's cross-session aggregation
 * (Remote-Event replay restores it on every reconnect), and answering the
 * approval clears it, so the row falls back to its status group. Only the
 * approval kind routes here: question and other interaction kinds never do
 * (the board is the 审批待办 surface, not the ask-user one).
 *
 * Merge order: within one group, rows sort by updatedAt descending (most
 * recently active first); ties keep collection order, which is run rows (in
 * ledger order) before run-less session rows (in sessions-list order).
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
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

/** The effective pending interaction a session currently carries, if any. */
export type InboxPending = ReadonlyMap<SessionId, SessionPendingInteraction>

/** Whether the session's effective pending interaction is an approval (the 等待你确认 triage). */
function awaitsApproval(id: SessionId, pending: InboxPending): boolean {
  return pending.get(id)?.kind === 'approval'
}

/**
 * Project the sessions list snapshot, the run ledger, and the pending-interaction
 * roster into the inbox board.
 * @param list - the sessions list snapshot (useSessions standard feed).
 * @param runs - the run ledger's rows (the board store's latest fetch).
 * @param pending - the pending-interaction roster (useSessionPendingInteraction feed).
 * @returns counts and rows for the three groups.
 */
export function projectInboxBoard(list: SessionListState, runs: readonly WireRun[], pending: InboxPending): InboxBoard {
  const runRows: Record<InboxGroup, TaskRow[]> = { pending: [], running: [], done: [] }
  // Agent runs claim their session twin: an agent run's session identity IS
  // its runId, so the sessions-list row of the same id would double-list.
  const claimed = new Set<string>()
  for (const run of runs) {
    // Child runs live under their parent's lineage, never on the board.
    if (run.parentRunId !== null) continue
    const summary = list.byId[run.runId as SessionId]
    const awaiting = awaitsApproval(run.runId as SessionId, pending)
    const row: TaskRow = {
      // The row carries a session identity only when the twin is actually
      // listed: sessions.open fails loud on unlisted ids, so an untwinned
      // agent run routes through the run selection like a workflow run (the
      // engine creates the session with the first drive; the list projection
      // lags the ledger). Workflow runs never have one.
      ...run.defKind === 'agent' && summary !== undefined ? { sessionId: run.runId as SessionId } : {},
      title: run.defKind === 'agent' && summary !== undefined && !summary.blank ? summary.displayTitle : run.defName,
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
    const awaiting = awaitsApproval(id, pending)
    const row: TaskRow = {
      sessionId: id,
      title: summary.displayTitle,
      updatedAt: summary.updatedAt,
      ...awaiting ? { awaitingApproval: true as const } : {},
    }
    const group: InboxGroup = awaiting ? 'pending' : summary.running ? 'running' : 'done'
    sessionRows[group].push(row)
  }
  const merge = (group: InboxGroup): readonly TaskRow[] =>
    [...runRows[group], ...sessionRows[group]].sort((a, b) => b.updatedAt - a.updatedAt)
  const pendingRows = merge('pending')
  const runningRows = merge('running')
  const doneRows = merge('done')
  return {
    counts: { pending: pendingRows.length, running: runningRows.length, done: doneRows.length },
    rows: { pending: pendingRows, running: runningRows, done: doneRows },
  }
}
