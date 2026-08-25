/**
 * Inbox navigation column (the 'sidebar' occupant): wordmark, the big
 * 「+ 新任务」 button opening the new-task dialog (body delegated to the
 * 'inbox.new-task.dialog' occupant, stub copy while absent), the three inbox
 * groups with live counts projected from the sessions list plus the run
 * ledger, and the Agents / 设置 secondary nav. Collapsed renders the compact control rail
 * (sidebar toggle + new-task icon button) required by the 'sidebar' occupant
 * contract.
 */
import { useState } from 'react'
import clsx from 'clsx'
import type { SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'sidebar' entry) in so
// PropsRuntime<'sidebar'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls this package's own SlotMap merge (the dialog child slot)
// in so PropsRenderSlots resolves.
import type {} from './contract.ts'
import {
  Button, IconPanelLeftOutline16, IconPlusOutline16, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InboxGroup, InboxSelection } from './selection.ts'
import { projectInboxBoard } from './task-projection.ts'
import type { RunsBoardState } from './runs-store.ts'
import type { InboxKey } from './locales.ts'
import css from './InboxNav.module.css'

/** Registration-side business face for the navigation column. */
export interface InboxNavInjected {
  hooks: {
    /** Shared workbench selection, bound by the renderer as useSelection. */
    selection: SnapshotStore<InboxSelection>
    /** The run-board poll snapshot, bound by the renderer as useBoard. */
    board: SnapshotStore<RunsBoardState>
  }
  /** Select an inbox group, a task, or a secondary page. */
  select: (next: InboxSelection) => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
}

/** Full component props: layout owner share + child render share + injected face + locale seat. */
export type InboxNavProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<'inbox.new-task.dialog'>
  & InjectFace<InboxNavInjected>
  & PropsLocale<'inbox'>

/** Inbox groups in display order. */
const GROUPS: readonly InboxGroup[] = ['pending', 'running', 'done']

/** Group label keys, in GROUPS order's key space. */
const GROUP_LABEL: Record<InboxGroup, InboxKey> = {
  pending: 'nav.group.pending',
  running: 'nav.group.running',
  done: 'nav.group.done',
}

/**
 * Render the inbox navigation column.
 * @param props - composed slot props (runtime share + child render share + injected face + locale seat).
 * @returns the column element tree.
 */
export function InboxNav({ collapsed, useSelection, useBoard, useSessions, select, toggleSidebar, renderSlot, t }: InboxNavProps) {
  const selection = useSelection(s => s)
  const list = useSessions(s => s)
  const runs = useBoard(s => s.runs)
  const counts = projectInboxBoard(list, runs).counts
  // Dialog open state is component-local: only this component knows it.
  const [dialogOpen, setDialogOpen] = useState(false)

  const openTask = (sessionId: SessionId): void => {
    setDialogOpen(false)
    select({ kind: 'task', sessionId })
  }

  const newTaskDialog = (
    <Modal
      open={dialogOpen}
      onClose={() => { setDialogOpen(false) }}
      title={t('dialog.new-task.title')}
      closeLabel={t('dialog.close')}
    >
      {renderSlot('inbox.new-task.dialog', {
        close: () => { setDialogOpen(false) },
        openTask,
      }, {
        fallback: <p className={css.dialogStub}>{t('dialog.new-task.stub')}</p>,
      })}
    </Modal>
  )

  if (collapsed) {
    return (
      <div className={clsx(css.root, css.collapsed)}>
        <Tooltip label={t('nav.toggle.open')} delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('nav.toggle.open')}
            onClick={() => { toggleSidebar() }}
          >
            <IconPanelLeftOutline16 size={18} />
          </button>
        </Tooltip>
        <Tooltip label={t('nav.new-task.label')} delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('nav.new-task.label')}
            onClick={() => { setDialogOpen(true) }}
          >
            <IconPlusOutline16 size={18} />
          </button>
        </Tooltip>
        {newTaskDialog}
      </div>
    )
  }

  return (
    <div className={css.root}>
      <div className={css.logoRow}>
        <span className={css.brand}>daypaw</span>
        <Tooltip label={t('nav.toggle.collapse')} delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('nav.toggle.collapse')}
            onClick={() => { toggleSidebar() }}
          >
            <IconPanelLeftOutline16 size={16} />
          </button>
        </Tooltip>
      </div>

      <Button
        variant="primary"
        className={css.newTask}
        icon={<IconPlusOutline16 size={14} />}
        onClick={() => { setDialogOpen(true) }}
      >
        {t('nav.new-task')}
      </Button>

      <nav className={css.groups}>
        {GROUPS.map((group) => {
          const selected = selection.kind === 'group' && selection.group === group
          return (
            <button
              key={group}
              type="button"
              className={clsx(css.row, selected && css.selected)}
              aria-pressed={selected}
              onClick={() => { select({ kind: 'group', group }) }}
            >
              <span className={css.rowLabel}>{t(GROUP_LABEL[group])}</span>
              <span className={css.count}>{counts[group]}</span>
            </button>
          )
        })}
      </nav>

      <div className={css.footer}>
        <button
          type="button"
          className={clsx(css.row, selection.kind === 'agents' && css.selected)}
          aria-pressed={selection.kind === 'agents'}
          onClick={() => { select({ kind: 'agents' }) }}
        >
          <span className={css.rowLabel}>{t('nav.agents')}</span>
        </button>
        <button
          type="button"
          className={clsx(css.row, selection.kind === 'settings' && css.selected)}
          aria-pressed={selection.kind === 'settings'}
          onClick={() => { select({ kind: 'settings' }) }}
        >
          <span className={css.rowLabel}>{t('nav.settings')}</span>
        </button>
      </div>

      {newTaskDialog}
    </div>
  )
}
