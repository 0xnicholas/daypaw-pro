/**
 * Slot contracts owned by the inbox workbench: the holes InboxNav and
 * WorkspaceSwitch declare and render for the fork composition. The workspace
 * holes live one scope inside the parent 'conversation' slot (session-maybe),
 * so their occupants receive the current-session-or-undefined inject
 * parameter; the dialog and task-list holes carry their facts through owner
 * props instead.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WireJournalEntry, WireRun, WireRunDefKind, WireRunLineage, WireRunStatus } from './runs-api.ts'

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
 * One projected task-list row. ui-inbox owns the single projection (nav
 * counts and this list share it); occupants receive rows through owner props
 * and never touch the store.
 */
export interface TaskRow {
  /**
   * The task's session identity (opening a session-backed task opens its
   * session). OPTIONAL: a workflow-run row has no session — the engine gives
   * workflow runs none, while an agent run's session identity IS its runId,
   * so run rows of `defKind: 'agent'` always carry it. Run-less session rows
   * carry it by construction.
   */
  sessionId?: SessionId
  /** Human-facing label (the session's displayTitle, else the run's defName). */
  title: string
  /** Agent preset the task runs, when the session header carries one. */
  /** Last activity timestamp (epoch ms). */
  updatedAt: number
  /**
   * The task waits on a pending approval — the row sits in the 等待你确认
   * group and its status text reads 等待确认 regardless of the underlying
   * run/session status. OPTIONAL: absent when no approval pends.
   */
  awaitingApproval?: true
  /** Engine run identity, when the row comes from a durable run. */
  run?: {
    readonly runId: string
    readonly status: WireRunStatus
    readonly defKind: WireRunDefKind
  }
}

/** Owner share of the conversation occupant. */
export interface InboxConversationOwnerProps {
  /**
   * The task's durable run status (sessionId ≡ runId, the board store's
   * ledger row), or undefined when the selected session has no run (a
   * run-less session). The follow-up seat's liveness keys off this, never
   * the session's agent running bit: an agent run parked at a steer segment
   * boundary keeps its ledger row `running` while its agent sits idle.
   */
  readonly runStatus: WireRunStatus | undefined
}

/** Owner share of the task-list occupant. */
export interface InboxTasksOwnerProps {
  /** The group's projected rows. */
  rows: readonly TaskRow[]
  /** Current epoch ms for the rows' 最近动态 relative-time labels. */
  now: number
  /** Open one row's conversation in the middle column. */
  openTask: (sessionId: SessionId) => void
  /** Select one session-less workflow-run row (its detail lives in the right column). */
  openRun: (runId: string) => void
}


/**
 * What the detail body occupant draws, keyed off the workbench selection
 * (never the session seat — the 'details' slot is strict-session scope and
 * may carry a stale session while a workflow run is selected).
 */
export type TaskDetailView =
  /** Nothing to show: a group/secondary-page selection, or detail data still absent. */
  | { readonly kind: 'none' }
  /** A run-less session task: the occupant draws session-bound detail. */
  | { readonly kind: 'session'; readonly sessionId: SessionId }
  /** A durable run (workflow or agent): the occupant draws ledger-bound detail. */
  | {
    readonly kind: 'run'
    /** The run's own row. */
    readonly run: WireRun
    /** Parent/child lineage; undefined while the detail fetch is incomplete. */
    readonly lineage: WireRunLineage | undefined
    /** Journal timeline; undefined while the detail fetch is incomplete. */
    readonly timeline: readonly WireJournalEntry[] | undefined
    /** The parsed `output_json`; undefined when the run carries none. */
    readonly output: unknown
    /** Retry affordance, present only when the run failed. */
    readonly retry: (() => void) | undefined
  }

/** Owner share of the detail body occupant. */
export interface InboxDetailBodyOwnerProps {
  /** The selection-keyed detail view. */
  detail: TaskDetailView
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
     * inject parameter) with the owner-passed run status ruling the
     * follow-up seat. An absent occupant falls back to the owner's
     * placeholder.
     */
    'inbox.workspace.conversation': { kind: 'single'; scope: 'session'; owner: InboxConversationOwnerProps }
    /**
     * The Agents catalog page: the single occupant draws the whole catalog
     * surface (cards + detail) inside the middle column. An absent occupant
     * falls back to the owner's placeholder.
     */
    'inbox.agents.page': { kind: 'single'; scope: 'session-maybe' }
    /**
     * The selected task's detail body: the single occupant draws the right
     * column's content below the owner's header. The seat is session scope
     * (the parent 'details' slot is), but the owner props key off the
     * workbench selection, never the session seat — a workflow-run selection
     * has no session and the seat may carry a stale one. An absent occupant
     * falls back to the owner's empty copy.
     */
    'inbox.detail.body': { kind: 'single'; scope: 'session'; owner: InboxDetailBodyOwnerProps }
  }
}
