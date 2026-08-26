/**
 * daypaw task surfaces plugin, browser half: four registrations over the
 * ui-inbox slot tree — NewTaskDialog into 'inbox.new-task.dialog' (agent
 * picker + task text + the create→open→prompt submit sequence), TaskList
 * into 'inbox.workspace.tasks' (the owner's projected rows),
 * ConversationView into 'inbox.workspace.conversation' (the business-language
 * flow), and DetailBody into 'inbox.detail.body' (the right column's four
 * sections). Session facts come through the sessions service, the session
 * standard kit (useSession/useProjection), and the connection wire face; the
 * host stays the single fact source.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-inbox's SlotMap merge (the four target seats).
import type {} from '@daypaw/ui-inbox/client'
import { NewTaskDialog, type NewTaskDialogInjected } from './new-task-dialog.tsx'
import { TaskList } from './task-list.tsx'
import { ConversationView, type ConversationViewInjected } from './conversation-view.tsx'
import { DetailBody } from './detail-body.tsx'
import { NewTaskStore } from './new-task-store.ts'
import { en, zh, type DaypawTasksKey } from './locales.ts'

export type { NewTaskDialogInjected, NewTaskDialogProps } from './new-task-dialog.tsx'
export type { TaskListProps } from './task-list.tsx'
export type { ConversationViewInjected, ConversationViewProps } from './conversation-view.tsx'
export type { ApprovalCardProps, PendingApprovalWait } from './approval-card.tsx'
export type { DetailBodyProps } from './detail-body.tsx'
export type { NewTaskState } from './new-task-store.ts'
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
 * `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'sessions']

/** Register the dictionaries and the three task-surface occupants.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'daypaw-ui-tasks: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const newTask = new NewTaskStore(connection.api, ctx.sessions)

  // The reject note rides the ordinary prompt path (the NewTaskStore first
  // prompt precedent): queue mode lets a running task consume it as steering.
  const sendNote = async (sessionId: SessionId, text: string): Promise<void> => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`ui-tasks: session "${sessionId}" resolved no binding`)
    const prompted = await binding.session.prompt([{ type: 'text', text }], 'queue')
    if (!prompted.ok) throw new Error(prompted.error.message)
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
    inject: (): ConversationViewInjected => ({ sendNote }),
  }, ConversationView))
  ctx.slots.inject('inbox.detail.body', () => ctx.slots.register({
    name: 'inbox.detail.body',
    locale: NS,
  }, DetailBody))
}
