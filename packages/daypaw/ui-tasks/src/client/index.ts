/**
 * daypaw task surfaces plugin, browser half: four registrations over the
 * ui-inbox slot tree — NewTaskDialog into 'inbox.new-task.dialog' (agent
 * picker over the engine registry + the inputKind-ruled input surface + the
 * startRun→twin-wait submit sequence), TaskList into
 * 'inbox.workspace.tasks' (the owner's projected rows),
 * ConversationView into 'inbox.workspace.conversation' (the business-language
 * flow), and DetailBody into 'inbox.detail.body' (the right column's four
 * sections). Session facts come through the sessions service, the session
 * standard kit (useChat/useSession/useProjection), and the connection's
 * generic RPC channel for the `durable/*` endpoints; the host stays the
 * single fact source.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the session-controller Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls ui-inbox's SlotMap merge (the four target seats).
import type {} from '@daypaw/ui-inbox/client'
import { NewTaskDialog, type NewTaskDialogInjected } from './new-task-dialog.tsx'
import { TaskList } from './task-list.tsx'
import { ConversationView, type ConversationViewInjected } from './conversation-view.tsx'
import { DetailBody } from './detail-body.tsx'
import { NewTaskStore } from './new-task-store.ts'
import { createNewTaskApi } from './new-task-api.ts'
import { en, zh, type DaypawTasksKey } from './locales.ts'

export type { NewTaskDialogInjected, NewTaskDialogProps } from './new-task-dialog.tsx'
export type { TaskListProps } from './task-list.tsx'
export type { ConversationViewInjected, ConversationViewProps } from './conversation-view.tsx'
export type { ApprovalCardProps, PendingApprovalWait } from './approval-card.tsx'
export type { DetailBodyProps } from './detail-body.tsx'
export type { NewTaskState, NewTaskSessions, AgentOption } from './new-task-store.ts'
export type { NewTaskApi, WireAgentDefinition, WireStartRunRequest } from './new-task-api.ts'
export type { BusinessRow } from './chat-projection.ts'
export type { DaypawTasksKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** daypaw task surfaces copy (dialog, list, conversation). */
    'daypaw-tasks': DaypawTasksKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'daypaw-tasks'

/**
 * Required services (cordis fiber inject). The target seats are declared by
 * ui-inbox's registrations, whose activation order relative to this one is
 * NOT constrained; registrations depend on each seat through
 * `slots.inject()`. The dialog's wire face rides the connection's generic
 * RPC channel (`durable/*` endpoints, the ui-agents catalog precedent).
 */
export const inject = ['slots', 'locale', 'sessions', 'connection']

/** Register the dictionaries and the three task-surface occupants.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'daypaw-ui-tasks: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const newTask = new NewTaskStore(createNewTaskApi(connection.rpc), { list: ctx.sessions.list })

  // The reject note rides the ordinary prompt path (queue mode lets a
  // running task consume it as steering and an idle one start a new turn).
  const sendNote = async (sessionId: SessionId, note: string): Promise<void> => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`ui-tasks: session "${sessionId}" resolved no binding`)
    const prompted = await binding.session.prompt([{ type: 'text', text: note }], 'queue')
    if (!prompted.ok) throw new Error(prompted.error.message)
  }

  // The follow-up seat's steer: the engine's free-text Remote endpoint over
  // the connection's generic RPC channel (the dialog's startRun precedent);
  // sessionId ≡ runId for agent tasks, and the boundary applies the
  // definition's wire face to the bare text (issue #94).
  const steer = async (sessionId: SessionId, text: string): Promise<void> => {
    const result = await connection.rpc.call('/api', 'durable/steerText', { args: { runId: sessionId, text } })
    if (!result.ok) throw new Error(result.error.message)
  }

  ctx.slots.inject('inbox.new-task.dialog', () => ctx.slots.register({
    name: 'inbox.new-task.dialog',
    locale: NS,
    inject: (): NewTaskDialogInjected => ({
      hooks: { newTask: newTask.store },
      store: newTask,
    }),
  }, NewTaskDialog))
  ctx.slots.inject('inbox.workspace.tasks', () => ctx.slots.register({
    name: 'inbox.workspace.tasks',
    locale: NS,
  }, TaskList))
  ctx.slots.inject('inbox.workspace.conversation', () => ctx.slots.register({
    name: 'inbox.workspace.conversation',
    locale: NS,
    inject: (): ConversationViewInjected => ({ sendNote, steer }),
  }, ConversationView))
  ctx.slots.inject('inbox.detail.body', () => ctx.slots.register({
    name: 'inbox.detail.body',
    locale: NS,
  }, DetailBody))
}
