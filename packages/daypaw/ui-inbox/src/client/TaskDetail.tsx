/**
 * Task detail column (the 'details' occupant, priority -1 shadowing
 * ui-conversation's placeholder): the right column for the current selection.
 * Content keys off the SELECTION, never the session seat — the 'details' slot
 * is strict-session scope and may carry a stale session while a session-less
 * workflow run is selected. A run selection renders the header (run title,
 * strict spec-05 status copy, and the 「重试」 button for failed runs) and
 * delegates the body to the 'inbox.detail.body' occupant; anything else falls
 * back to the empty state.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'details' entry) in so
// PropsRuntime<'details'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls this package's own SlotMap merge (the detail body slot) in
// so PropsRenderSlots resolves.
import type {} from './contract.ts'
import type { TaskDetailView } from './contract.ts'
import type { InboxSelection } from './selection.ts'
import type { TaskDetailState } from './runs-store.ts'
import { runStatusKey } from './task-status.ts'
import css from './TaskDetail.module.css'

/** Registration-side business face for the detail column. */
export interface TaskDetailInjected {
  hooks: {
    /** Shared workbench selection, bound by the renderer as useSelection. */
    selection: SnapshotStore<InboxSelection>
    /** The selected run's detail snapshot, bound by the renderer as useDetail. */
    detail: SnapshotStore<TaskDetailState>
  }
  /** Retry a failed run: reruns it, selects the running group, and kicks the board. */
  retry: (runId: string) => void
}

/** Full component props: runtime share + child render share + injected face + locale seat. */
export type TaskDetailProps =
  PropsRuntime<'details'>
  & PropsRenderSlots<'inbox.detail.body'>
  & InjectFace<TaskDetailInjected>
  & PropsLocale<'inbox'>

/**
 * Parse a run's serialized output for the detail body.
 * @param outputJson - the run's `output_json` (null until the run settles with one).
 * @returns the parsed output; the raw string when the durable content is not JSON.
 */
function parseRunOutput(outputJson: string | null): unknown {
  if (outputJson === null) return undefined
  try {
    return JSON.parse(outputJson)
  } catch {
    // Durable content that is not JSON: hand the occupant the raw string.
    return outputJson
  }
}

/**
 * Render the detail column for the current selection.
 * @param props - composed slot props (runtime share + child render share + injected face + locale seat).
 * @returns the detail element tree.
 */
export function TaskDetail({ useSelection, useDetail, retry, renderSlot, t }: TaskDetailProps) {
  const selection = useSelection(s => s)
  const state = useDetail(s => s)
  const empty = <div className={css.empty}>{t('detail.empty')}</div>

  if (selection.kind === 'task') {
    // A run-less session task: the body occupant draws session-bound detail.
    return (
      <div className={css.root}>
        <header className={css.header}><h2 className={css.title}>{t('detail.title')}</h2></header>
        {renderSlot('inbox.detail.body', {
          detail: { kind: 'session', sessionId: selection.sessionId },
        }, { fallback: empty })}
      </div>
    )
  }

  if (selection.kind === 'run') {
    const run = state.status === 'ready' && state.runId === selection.runId ? state.lineage?.run : undefined
    if (run !== undefined) {
      const view: TaskDetailView = {
        kind: 'run',
        run,
        lineage: state.lineage,
        timeline: state.timeline,
        output: parseRunOutput(run.outputJson),
        retry: run.status === 'failed' ? () => { retry(run.runId) } : undefined,
      }
      return (
        <div className={css.root}>
          <header className={css.header}>
            <h2 className={css.title}>{run.defName}</h2>
            <span className={css.status}>{t(runStatusKey(run.status))}</span>
            {run.status === 'failed' && (
              <button type="button" className={css.retry} onClick={() => { retry(run.runId) }}>
                {t('detail.retry')}
              </button>
            )}
          </header>
          {renderSlot('inbox.detail.body', { detail: view }, { fallback: empty })}
        </div>
      )
    }
    // Loading, failed, or answered without the run: the empty state.
  }

  return (
    <div className={css.root}>
      <header className={css.header}><h2 className={css.title}>{t('detail.title')}</h2></header>
      {empty}
    </div>
  )
}
