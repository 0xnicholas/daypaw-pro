/**
 * Slot contracts owned by the inbox workbench: the holes InboxNav and
 * WorkspaceSwitch declare and render for the fork composition. The workspace
 * holes live one scope inside the parent 'conversation' slot (session-maybe),
 * so their occupants receive the current-session-or-undefined inject
 * parameter; the dialog and task-list holes carry their facts through owner
 * props instead.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Owner share of a workspace banner entry. */
export interface InboxBannerOwnerProps {
  /** Switch the middle column to the settings page (the banner's one navigation affordance). */
  openSettings: () => void
}

/** Owner share of the settings page occupant. */
export interface InboxSettingsPageOwnerProps {
  /** Leave the settings page: switch the middle column back to the running group. */
  close: () => void
}

/** Owner share of the new-task dialog body occupant (the Modal chrome stays with the nav). */
export interface InboxNewTaskDialogOwnerProps {
  /** Dismiss the dialog without creating anything. */
  close: () => void
  /** Open a created task's conversation in the middle column (also dismisses the dialog). */
  openTask: (sessionId: SessionId) => void
}

/**
 * One projected task-list row. ui-inbox owns the single projection from the
 * sessions list (nav counts and this list share it); occupants receive rows
 * through owner props and never touch the store.
 */
export interface TaskRow {
  /** The task's session identity (opening a task opens its session). */
  sessionId: SessionId
  /** Human-facing label (the sessions list's displayTitle projection). */
  title: string
  /** Agent preset the task runs, when the session header carries one. */
  agentPreset?: string
  /** Last activity timestamp (epoch ms). */
  updatedAt: number
}

/** Owner share of the task-list occupant. */
export interface InboxTasksOwnerProps {
  /** The group's projected rows. */
  rows: readonly TaskRow[]
  /** Current epoch ms for the rows' 最近动态 relative-time labels. */
  now: number
  /** Open one row's conversation in the middle column. */
  openTask: (sessionId: SessionId) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The banner strip atop a group container: first-run and workspace-level
     * notices, one row per entry. Following the onboarding-ledger mechanics,
     * each registrant owns its readiness and completion state and renders
     * null until its facts load — a mounted-but-deciding entry shows nothing.
     */
    'inbox.workspace.banner': { kind: 'list'; scope: 'session-maybe'; owner: InboxBannerOwnerProps }
    /**
     * The 设置 page content: the single occupant draws the whole settings
     * surface inside the middle column. An absent occupant falls back to the
     * owner's placeholder.
     */
    'inbox.settings.page': { kind: 'single'; scope: 'session-maybe'; owner: InboxSettingsPageOwnerProps }
    /**
     * The new-task dialog body inside InboxNav's Modal: the single occupant
     * owns the agent picker, the task text, and the submit sequence. An
     * absent occupant falls back to the owner's stub copy.
     */
    'inbox.new-task.dialog': { kind: 'single'; scope: 'root'; owner: InboxNewTaskDialogOwnerProps }
    /**
     * One inbox group's task list: the single occupant renders the owner's
     * projected rows. An absent occupant falls back to the owner's empty
     * state.
     */
    'inbox.workspace.tasks': { kind: 'single'; scope: 'root'; owner: InboxTasksOwnerProps }
    /**
     * The selected task's conversation: the single occupant draws the
     * business-language flow for the current session (the session-maybe
     * inject parameter). An absent occupant falls back to the owner's
     * placeholder.
     */
    'inbox.workspace.conversation': { kind: 'single'; scope: 'session-maybe' }
    /**
     * The Agents catalog page: the single occupant draws the whole catalog
     * surface (cards + detail) inside the middle column. An absent occupant
     * falls back to the owner's placeholder.
     */
    'inbox.agents.page': { kind: 'single'; scope: 'session-maybe' }
  }
}
