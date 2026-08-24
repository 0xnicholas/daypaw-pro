/**
 * The inbox board projection: the single derivation from the sessions list to
 * per-group counts and task rows, shared by InboxNav's group counts and
 * WorkspaceSwitch's task-list owner props. Business grouping over the wire
 * summary: a non-blank session still running is 进行中, a non-blank settled
 * one is 已完成; 「等待你确认」 stays an empty placeholder until the approval
 * board ticket (#58) wires pending interactions.
 */
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { TaskRow } from './contract.ts'
import type { InboxGroup } from './selection.ts'

/** Per-group counts and rows, one projection pass. */
export interface InboxBoard {
  /** Row counts keyed by group (pending is the placeholder zero). */
  counts: Record<InboxGroup, number>
  /** Projected rows keyed by group, in sessions-list order. */
  rows: Record<InboxGroup, readonly TaskRow[]>
}

/**
 * Project the sessions list snapshot into the inbox board.
 * @param list - the sessions list snapshot (useSessions standard feed).
 * @returns counts and rows for the three groups.
 */
export function projectInboxBoard(list: SessionListState): InboxBoard {
  const running: TaskRow[] = []
  const done: TaskRow[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    // Blank sessions are reusable drafts, not tasks; unlisted ids cannot row.
    if (summary === undefined || summary.blank) continue
    const row: TaskRow = {
      sessionId: id,
      title: summary.displayTitle,
      updatedAt: summary.updatedAt,
      ...summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset },
    }
    ;(summary.running ? running : done).push(row)
  }
  return {
    counts: { pending: 0, running: running.length, done: done.length },
    rows: { pending: [], running, done },
  }
}
