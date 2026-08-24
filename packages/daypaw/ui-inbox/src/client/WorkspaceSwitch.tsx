/**
 * Workspace switch (the 'conversation' occupant, priority -1 shadowing
 * ui-conversation's placeholder): the middle column container for the current
 * selection — an inbox group's task container topped by the
 * 'inbox.workspace.banner' strip (empty state until the board tickets wire
 * data), the Agents placeholder page, or the 设置 page rendered from the
 * 'inbox.settings.page' occupant (placeholder fallback while no occupant is
 * registered).
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'conversation' entry) in so
// PropsRuntime<'conversation'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls this package's own SlotMap merge (the two child slots) in
// so PropsRenderSlots resolves.
import type {} from './contract.ts'
import type { InboxGroup, InboxSelection } from './selection.ts'
import type { InboxKey } from './locales.ts'
import css from './WorkspaceSwitch.module.css'

/** Registration-side business face for the workspace column. */
export interface WorkspaceSwitchInjected {
  hooks: {
    /** Shared workbench selection, bound by the renderer as useSelection. */
    selection: SnapshotStore<InboxSelection>
  }
  /** Select an inbox group or a secondary page. */
  select: (next: InboxSelection) => void
}

/** Full component props: runtime share + child-slot render share + injected face + locale seat. */
export type WorkspaceSwitchProps =
  PropsRuntime<'conversation'>
  & PropsRenderSlots<'inbox.workspace.banner' | 'inbox.settings.page'>
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
export function WorkspaceSwitch({ useSelection, select, renderSlot, t }: WorkspaceSwitchProps) {
  const selection = useSelection(s => s)
  if (selection.kind === 'agents') {
    return (
      <div className={css.root}>
        <header className={css.header}><h1 className={css.title}>{t('nav.agents')}</h1></header>
        <div className={css.empty}>{t('workspace.agents.placeholder')}</div>
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
  return (
    <div className={css.root}>
      <header className={css.header}><h1 className={css.title}>{t(GROUP_TITLE[selection.group])}</h1></header>
      {renderSlot('inbox.workspace.banner', { openSettings: () => { select({ kind: 'settings' }) } })}
      <div className={css.empty}>{t(GROUP_EMPTY[selection.group])}</div>
    </div>
  )
}
