/**
 * Task conversation view (the 'inbox.workspace.conversation' occupant): the
 * selected task's business-language flow — user messages, steering, assistant
 * text, and the terminal failure marker — with a 「进行中」 status row while
 * the task runs (a crash-revival pause reads as ordinary progress; the
 * revival itself stays invisible) and a disabled follow-up input seat (追问
 * lands with its own ticket). Everything else the chat assembles (tool
 * calls, commands, retries, metrics) is filtered by the whitelist projection.
 * While an approval pends, the approval card pins atop the flow (审批卡置顶,
 * spec 05 §3): the session's pending list feeds it, the runtime manager's
 * replay restores it after a cold start, and the resolved broadcast removes
 * it — the card itself never polls.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-inbox's SlotMap merge (the conversation seat) in so
// PropsRuntime<'inbox.workspace.conversation'> resolves.
import type {} from '@daypaw/ui-inbox/client'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { ApprovalCard, type PendingApprovalWait } from './approval-card.tsx'
import { projectBusinessRows } from './chat-projection.ts'
import css from './conversation-view.module.css'

/** Registration-side business face for the conversation occupant. */
export interface ConversationViewInjected {
  /**
   * Send the reject note back into the task's conversation (拒绝可附言回对话,
   * spec 05 §2) — a queued session prompt, so a running task consumes it as
   * steering and an idle one starts a new turn. Throws on wire failure.
   */
  sendNote: (sessionId: SessionId, text: string) => Promise<void>
}

/** Full component props: session-maybe runtime share + injected face + locale seat. */
export type ConversationViewProps =
  PropsRuntime<'inbox.workspace.conversation'>
  & InjectFace<ConversationViewInjected>
  & PropsLocale<'daypaw-tasks'>

/**
 * Render the selected task's conversation.
 * @param props - composed slot props (session-maybe standard kit + injected face + locale seat).
 * @returns the conversation element tree.
 */
export function ConversationView({ useSession, useSessions, sessionId, sendNote, t }: ConversationViewProps) {
  const chat = useSession(s => s.chat)
  const running = useSession(s => s.running) ?? false
  const pending = useSession(s => s.pending)
  const runningCalls = useSession(s => s.runningCalls)
  const taskTitle = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.displayTitle)
  const rows = chat === undefined ? [] : projectBusinessRows(chat)

  const approval: PendingApprovalWait | undefined = pending?.find(
    (wait): wait is PendingApprovalWait => wait.kind === 'approval',
  )
  // The paired call stays in runningCalls while the approval blocks its
  // execution; its raw args feed the card's details expander.
  const callArgs = approval?.payload.callId === undefined
    ? undefined
    : runningCalls?.find(call => call.callId === approval.payload.callId)?.argsRaw

  return (
    <div className={css.root}>
      {approval !== undefined && sessionId !== undefined && (
        <ApprovalCard
          key={approval.key}
          wait={approval}
          taskTitle={taskTitle ?? ''}
          callArgs={callArgs}
          sendNote={text => sendNote(sessionId, text)}
          t={t}
        />
      )}
      {running && <div className={css.statusRow}>{t('conversation.running')}</div>}
      <div className={css.flow}>
        {rows.length === 0
          ? <div className={css.empty}>{t('conversation.empty')}</div>
          : rows.map(row => row.kind === 'error'
            ? <div key={row.key} className={css.errorRow}>{t('conversation.error')}</div>
            : (
              <div key={row.key} className={row.kind === 'assistant' ? css.assistantRow : css.userRow}>
                <p className={css.rowText}>{row.text}</p>
              </div>
            ))}
      </div>
      <div className={css.followup}>
        <Input
          disabled
          aria-label={t('conversation.followup.placeholder')}
          placeholder={t('conversation.followup.placeholder')}
          value=""
          onChange={() => {}}
        />
      </div>
    </div>
  )
}
