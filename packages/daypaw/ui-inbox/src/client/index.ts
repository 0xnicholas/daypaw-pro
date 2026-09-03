/**
 * daypaw shell IA (inbox workbench), browser half: three registrations over
 * ui-layout's frame — InboxNav into 'sidebar' (replacing the upstream
 * ui-sidebar roster row), WorkspaceSwitch into 'conversation' and TaskDetail
 * into 'details', both at priority -1 so they shadow ui-conversation's
 * priority-0 placeholder occupants while its declared seats stay live for the
 * dormant ecosystem. The cordis fiber inject waits on the `layout` service,
 * which ui-layout provides in the same effect that declares the four slots,
 * so direct `ctx.slots.register` is safe here (the ui-sidebar precedent).
 * Shared selection crosses the three scopes through the inject hooks
 * compartments of one apply-closure controller; task selection also drives
 * the runtime current session one-way through `ctx.sessions.open`, so the
 * session-maybe conversation seat resolves the selected task's session.
 *
 * The board is engine-fed: RunsBoardStore polls `durable/listRuns` through
 * the connection's generic RPC channel, board ticks refresh the selected
 * run's TaskDetailStore, and selection changes rebind it — the engine ledger
 * stays the single fact source (the ui-agents catalog precedent).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ui-layout's SlotMap merge ('sidebar'/'conversation'/'details').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls this package's own SlotMap merge (the child slots the nav
// and workspace occupants declare) into the program. The type re-export also
// keeps the merge reachable from the built d.ts entry — downstream fork
// plugins import '@daypaw/ui-inbox/client' for exactly these slot types.
import type {} from './contract.ts'
export type {
  InboxBannerOwnerProps,
  InboxDetailBodyOwnerProps,
  InboxNewTaskDialogOwnerProps,
  InboxSettingsPageOwnerProps,
  InboxTasksOwnerProps,
  TaskDetailView,
  TaskRow,
} from './contract.ts'
export type { RunsApi, WireJournalEntry, WireRun, WireRunDefKind, WireRunLineage, WireRunStatus } from './runs-api.ts'
export { isUnfinishedWireRun } from './runs-api.ts'
export type { RunsBoardState, TaskDetailState } from './runs-store.ts'
import type { InboxNavInjected } from './InboxNav.tsx'
import { InboxNav } from './InboxNav.tsx'
import type { WorkspaceSwitchInjected } from './WorkspaceSwitch.tsx'
import { WorkspaceSwitch } from './WorkspaceSwitch.tsx'
import { TaskDetail, type TaskDetailInjected } from './TaskDetail.tsx'
import { InboxSelectionController } from './selection.ts'
import { createRunsApi } from './runs-api.ts'
import { RunsBoardStore, TaskDetailStore } from './runs-store.ts'
import { en, zh, type InboxKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** daypaw inbox workbench copy. */
    inbox: InboxKey
  }
}

/** Dictionary namespace owned by this plugin (workbench copy). */
const NS = 'inbox'

/** Services required by the inbox workbench plugin. */
export const inject = ['slots', 'layout', 'locale', 'sessions', 'connection']

/** Priority below ui-conversation's default-0 occupants: lowest live priority renders. */
const SHADOW_PRIORITY = -1

/** Registers the three column occupants sharing one selection controller and the two run stores.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-inbox: dictionaries')

  // One apply-closure controller; a shared store handle cannot cross the
  // three slot scopes, so the bare source travels through each register
  // call's inject hooks compartment (renderer binds it as useSelection).
  const selection = new InboxSelectionController((id) => { ctx.sessions.open(id) })

  const connection = ctx.get('connection') as ConnectionHandle
  const api = createRunsApi(connection.rpc)
  const board = new RunsBoardStore({ api })
  const detail = new TaskDetailStore({ api })

  ctx.effect(() => {
    // The board poll starts with the plugin and lives until teardown; each
    // published run list refreshes the selected run's detail (only when the
    // runs actually moved — loading flaps must not refetch), and selection
    // changes rebind the detail column. Only a session-less run selection
    // binds it; task selections resolve through the session seat instead.
    board.start()
    let lastRuns = board.store.getSnapshot().runs
    const offBoard = board.store.subscribe(() => {
      const runs = board.store.getSnapshot().runs
      if (runs === lastRuns) return
      lastRuns = runs
      void detail.refresh()
    })
    let lastSelection = selection.store.getSnapshot()
    const offSelection = selection.store.subscribe(() => {
      const next = selection.store.getSnapshot()
      // A re-published equal selection (clicking the selected row again) never rebinds.
      if (shallowEqual(next, lastSelection)) return
      lastSelection = next
      void detail.select(next.kind === 'run' ? next.runId : undefined)
    })
    return () => {
      board.stop()
      offBoard()
      offSelection()
    }
  }, 'ui-inbox: run stores')

  /**
   * The detail header's 重试 dispatcher: reruns the failed run, then selects
   * the running group (the new run lands there) and kicks an out-of-band
   * board refresh so it shows without waiting one poll. A failed rerun
   * surfaces through the detail store's error status — the simplest channel,
   * and the selection stays on the failed run.
   */
  const retry = (runId: string): void => {
    void api.rerun(runId).then(() => {
      selection.select({ kind: 'group', group: 'running' })
      void board.refresh()
    }, () => {
      detail.store.update((s) => { s.status = 'error' })
    })
  }

  ctx.effect(() => {
    const nav = ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      children: {
        // Root scope: the dialog body does not depend on the current session.
        'inbox.new-task.dialog': { kind: 'single', scope: 'root' },
      },
      inject: (): InboxNavInjected => ({
        hooks: { selection: selection.store, board: board.store },
        select: (next) => { selection.select(next) },
        toggleSidebar: () => { ctx.layout.toggleSidebar() },
        refreshBoard: () => { void board.refresh() },
      }),
    }, InboxNav)
    const workspace = ctx.slots.register({
      name: 'conversation',
      priority: SHADOW_PRIORITY,
      locale: NS,
      children: {
        // Banner, settings, agents, and conversation holes live one scope
        // inside the session-maybe parent: their occupants get the
        // current-session-or-undefined inject parameter. The task list is
        // root scope — its facts arrive through owner props, not the seat.
        'inbox.workspace.banner': { kind: 'list', scope: 'session-maybe' },
        'inbox.settings.page': { kind: 'single', scope: 'session-maybe' },
        'inbox.agents.page': { kind: 'single', scope: 'session-maybe' },
        'inbox.workspace.tasks': { kind: 'single', scope: 'root' },
        'inbox.workspace.conversation': { kind: 'single', scope: 'session' },
      },
      inject: (): WorkspaceSwitchInjected => ({
        hooks: { selection: selection.store, board: board.store },
        select: (next) => { selection.select(next) },
      }),
    }, WorkspaceSwitch)
    const detailEntry = ctx.slots.register({
      name: 'details',
      priority: SHADOW_PRIORITY,
      locale: NS,
      children: {
        // Session scope, mirroring the parent seat; the owner props key off
        // the selection, never the session (a workflow run has none).
        'inbox.detail.body': { kind: 'single', scope: 'session' },
      },
      inject: (): TaskDetailInjected => ({
        hooks: { selection: selection.store, detail: detail.store },
        retry,
      }),
    }, TaskDetail)
    return () => {
      nav()
      workspace()
      detailEntry()
    }
  }, 'ui-inbox: slot registrations')
}
