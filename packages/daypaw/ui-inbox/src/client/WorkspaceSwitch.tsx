/**
 * Workspace switch (the 'conversation' occupant, priority -1 shadowing
 * ui-conversation's placeholder): the middle column container for the current
 * selection — an inbox group's task list topped by the
 * 'inbox.workspace.banner' strip (rows projected from the sessions list,
 * rendered by the 'inbox.workspace.tasks' occupant with the owner's empty
 * state as fallback), one task's conversation rendered by the
 * 'inbox.workspace.conversation' occupant, the Agents catalog rendered by the
 * 'inbox.agents.page' occupant, or the 设置 page rendered from the
 * 'inbox.settings.page' occupant (placeholder fallbacks while no occupant is
 * registered). A session-less workflow-run selection renders the run
 * placeholder (its progress lives in the detail column).
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'conversation' entry) in so
// PropsRuntime<'conversation'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls this package's own SlotMap merge (the four child slots) in
// so PropsRenderSlots resolves.
import type {} from './contract.ts'
import type { InboxGroup, InboxSelection } from './selection.ts'
import { projectInboxBoard } from './task-projection.ts'
import type { RunsBoardState } from './runs-store.ts'
import type { InboxKey } from './locales.ts'
import css from './WorkspaceSwitch.module.css'

/** Registration-side business face for the workspace column. */
export interface WorkspaceSwitchInjected {
  hooks: {
    /** Shared workbench selection, bound by the renderer as useSelection. */
    selection: SnapshotStore<InboxSelection>
    /** The run-board poll snapshot, bound by the renderer as useBoard. */
    board: SnapshotStore<RunsBoardState>
  }
  /** Select an inbox group, a task, or a secondary page. */
  select: (next: InboxSelection) => void
}

/** The child slots this occupant declares and renders. */
type WorkspaceChildren = 'inbox.workspace.banner' | 'inbox.settings.page' | 'inbox.agents.page' | 'inbox.workspace.tasks' | 'inbox.workspace.conversation'

/** Full component props: runtime share + child-slot render share + injected face + locale seat. */
export type WorkspaceSwitchProps =
  PropsRuntime<'conversation'>
  & PropsRenderSlots<WorkspaceChildren>
  & InjectFace<WorkspaceSwitchInjected>
  & PropsLocale<'inbox'>

/** Per-group container title keys. */
const GROUP_TITLE: Record<InboxGroup, InboxKey> = {
  pending: 'nav.group.pending',
  running: 'nav.group.running',
  done: 'nav.group.done',
}

/** Per-group empty-state copy keys. */
const GROUP_EMPTY: Record<InboxGroup, InboxKey> = {
  pending: 'workspace.empty.pending',
  running: 'workspace.empty.running',
  done: 'workspace.empty.done',
}

/**
 * Render the middle column for the current selection.
 * @param props - composed slot props (runtime share + child render share + injected face + locale seat).
 * @returns the workspace element tree.
 */
export function WorkspaceSwitch({
  useSelection, useBoard, useSessions, useSessionPendingInteraction,
  select, renderSlot, t,
}: WorkspaceSwitchProps) {
  const selection = useSelection(s => s)
  const list = useSessions(s => s)
  const pending = useSessionPendingInteraction(s => s)
  const runs = useBoard(s => s.runs)
  const openTask = (sessionId: SessionId): void => { select({ kind: 'task', sessionId }) }

  if (selection.kind === 'agents') {
    return (
      <div className={css.root}>
        {renderSlot('inbox.agents.page', {}, {
          fallback: (
            <>
              <header className={css.header}><h1 className={css.title}>{t('nav.agents')}</h1></header>
              <div className={css.empty}>{t('workspace.agents.placeholder')}</div>
            </>
          ),
        })}
      </div>
    )
  }
  if (selection.kind === 'settings') {
    return (
      <div className={css.root}>
        {renderSlot('inbox.settings.page', {
          close: () => { select({ kind: 'group', group: 'running' }) },
        }, {
          fallback: (
            <>
              <header className={css.header}><h1 className={css.title}>{t('nav.settings')}</h1></header>
              <div className={css.empty}>{t('workspace.settings.placeholder')}</div>
            </>
          ),
        })}
      </div>
    )
  }
  if (selection.kind === 'task') {
    return (
      <div className={css.root}>
        {renderSlot('inbox.workspace.conversation', {}, {
          fallback: <div className={css.empty}>{t('workspace.conversation.placeholder')}</div>,
        })}
      </div>
    )
  }
  if (selection.kind === 'run') {
    // A session-less workflow run: no conversation occupant, ever — the
    // detail column carries its progress and outputs.
    return (
      <div className={css.root}>
        <div className={css.empty}>{t('workspace.run.placeholder')}</div>
      </div>
    )
  }
  return (
    <div className={css.root}>
      <header className={css.header}><h1 className={css.title}>{t(GROUP_TITLE[selection.group])}</h1></header>
      {renderSlot('inbox.workspace.banner', { openSettings: () => { select({ kind: 'settings' }) } })}
      {renderSlot('inbox.workspace.tasks', {
        rows: projectInboxBoard(list, runs, pending).rows[selection.group],
        now: Date.now(),
        openTask,
        openRun: (runId: string): void => { select({ kind: 'run', runId }) },
      }, {
        fallback: <div className={css.empty}>{t(GROUP_EMPTY[selection.group])}</div>,
      })}
    </div>
  )
}
