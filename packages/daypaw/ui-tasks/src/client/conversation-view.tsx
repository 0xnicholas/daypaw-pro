/**
 * Task conversation view (the 'inbox.workspace.conversation' occupant): the
 * selected task's business-language flow — user messages, steering, assistant
 * text, and the terminal failure marker — with a 「进行中」 status row while
 * the task runs (a crash-revival pause reads as ordinary progress; the
 * revival itself stays invisible) and a live follow-up seat (追问, issue
 * #94): while the task's durable run is unfinished, a free-text follow-up
 * steers the run (`durable/steerText`, sessionId ≡ runId); a run-less session
 * keeps the seat live as the plain-chat input (直接和助手聊, issue #102 —
 * ordinary queued prompts); a settled task's run keeps the seat disabled.
 * Everything else the chat assembles (tool calls, commands, retries,
 * metrics) is filtered by the whitelist projection.
 * While an approval pends, the approval card pins atop the flow (审批卡置顶,
 * spec 05 §3): the session's pending list feeds it, the runtime manager's
 * replay restores it after a cold start, and the resolved broadcast removes
 * it — the card itself never polls.
 */
import { useState, type FormEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-inbox's SlotMap merge (the conversation seat) in so
// PropsRuntime<'inbox.workspace.conversation'> resolves.
import type {} from '@daypaw/ui-inbox/client'
// Type-only: pulls ui-chat's session-standard merge (useChat).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { isUnfinishedWireRun } from '@daypaw/ui-inbox/client'
import { ApprovalCard, type PendingApprovalWait } from './approval-card.tsx'
import { projectBusinessRows } from './chat-projection.ts'
import css from './conversation-view.module.css'

/** Registration-side business face for the conversation occupant. */
export interface ConversationViewInjected {
  /**
   * Send one queued session prompt back into the conversation — both riders
   * share it: the approval reject note (拒绝可附言回对话, spec 05 §2) and the
   * run-less chat seat's input (issue #102). Queue mode lets a running task
   * consume the text as steering and an idle one start a new turn. Throws on
   * wire failure.
   */
  sendNote: (sessionId: SessionId, text: string) => Promise<void>
  /**
   * Steer the task's durable run with one free-text follow-up (issue #94):
   * `durable/steerText` over the wire face, sessionId ≡ runId. Throws on wire
   * or contract failure (the seat shows the inline failure).
   */
  steer: (sessionId: SessionId, text: string) => Promise<void>
  /**
   * Send one user message into a run-less session's conversation (the
   * light-chat seat, issue #102): the queued prompt shared with the reject
   * note. Throws on wire failure (the seat shows the inline failure).
   */
  sendChat: (sessionId: SessionId, text: string) => Promise<void>
}

/** Full component props: session-maybe runtime share + injected face + locale seat. */
export type ConversationViewProps =
  PropsRuntime<'inbox.workspace.conversation'>
  & InjectFace<ConversationViewInjected>
  & PropsLocale<'daypaw-tasks'>

/**
 * Render the selected task's conversation (session scope: the seat renders
 * only while a task's session is selected).
 * @param props - composed slot props (session standard kit + injected face + locale seat).
 * @returns the conversation element tree.
 */
export function ConversationView({
  useSession, useSessions, useChat, useSessionPendingInteraction, sessionId, runStatus, sendNote, steer, sendChat, t,
}: ConversationViewProps) {
  const chat = useChat(s => s)
  const running = useSession(s => s.running)
  const pending = useSessionPendingInteraction(s => s.get(sessionId))
  const runningCalls = useChat(s => s.legacy.runningCalls)
  const taskTitle = useSessions(s => s.byId[sessionId]?.displayTitle)
  const rows = projectBusinessRows(chat)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  // The run's ledger row rules the seat, never the session's agent running
  // bit: a steerable run parked at a segment boundary reads `running` on the
  // ledger while its agent sits idle between turns.
  const unfinished = runStatus !== undefined && isUnfinishedWireRun(runStatus)
  // A run-less session is the light-chat seat (issue #102): the input stays
  // live and sends ordinary queued prompts, never steer.
  const chatting = runStatus === undefined
  const live = unfinished || chatting

  const submitFollowup = (event: FormEvent): void => {
    event.preventDefault()
    const text = draft.trim()
    if (!live || sending || text === '') return
    setSending(true)
    setFailed(false)
    const send = chatting ? sendChat : steer
    void send(sessionId, text).then(() => {
      setSending(false)
      setDraft('')
    }, () => {
      setSending(false)
      setFailed(true)
    })
  }

  const approval: PendingApprovalWait | undefined = pending
  // The paired call stays in the running calls while the approval blocks its
  // execution; its raw args feed the card's details expander.
  const callArgs = approval === undefined
    ? undefined
    : runningCalls.find(call => call.callId === approval.callId)?.argsRaw

  return (
    <div className={css.root}>
      {approval && sessionId && (
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
      <form className={css.followup} onSubmit={submitFollowup}>
        <Input
          disabled={!live || sending}
          aria-label={t(chatting ? 'conversation.chat.placeholder' : 'conversation.followup.placeholder')}
          placeholder={t(live
            ? (chatting ? 'conversation.chat.placeholder' : 'conversation.followup.placeholder')
            : 'conversation.followup.closed')}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setFailed(false) }}
        />
        {failed && <p className={css.followupError}>{t(chatting ? 'conversation.chat.failed' : 'conversation.followup.failed')}</p>}
      </form>
    </div>
  )
}
