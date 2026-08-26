/**
 * The in-conversation approval card (spec 05 §2/§3): pinned atop the selected
 * task's conversation while an approval pends — 「<任务名> 请你确认：<业务动作
 * 摘要>」 with 同意 / 拒绝, an optional reject note sent back into the
 * conversation, and the raw command/arguments folded into a details expander
 * (the operator's verification channel; tool names never render — product
 * vocabulary rule). The answer rides the wait's respond carrier with the
 * domain encoding owned here; the card's removal is frame-driven — the
 * broadcast resolved frame drops the wait from the session's pending list and
 * the parent stops rendering it. One-shot: the buttons latch on click and
 * re-arm only when the answer or the note fails.
 */
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './approval-card.module.css'

/** One pending approval carrier, narrowed from the session's pending list. */
export type PendingApprovalWait = Extract<PendingInteraction, { kind: 'approval' }>

/** The client-answerable outcomes (cancelled/unavailable are host-side settlements). */
type ApprovalAnswer = 'allowed-once' | 'rejected'

/**
 * Send the domain answer over the carrier: ok-shell with the audit
 * correlation echoed. A non-accepted receipt (late/duplicate answer) throws
 * so the card can re-arm.
 * @param wait - the pending approval carrier.
 * @param outcome - the operator's decision.
 * @returns nothing; settlement arrives as the resolved frame.
 */
async function answerApproval(wait: PendingApprovalWait, outcome: ApprovalAnswer): Promise<void> {
  const receipt = await wait.respond({
    ok: true,
    value: { sessionId: wait.sessionId, approvalId: wait.payload.approvalId, outcome },
  })
  if (!receipt.accepted) throw new Error(`approval answer not accepted: ${receipt.reason}`)
}

/**
 * The details-expander text: the paired call's raw command when its args
 * carry one, otherwise the args verbatim (pretty-printed when parseable) —
 * paths and payloads stay inspectable without naming the tool.
 * @param callArgs - the paired in-flight call's raw args JSON.
 * @returns the detail text, or undefined when no paired call is known.
 */
function detailOf(callArgs: string | undefined): string | undefined {
  if (callArgs === undefined) return undefined
  try {
    const args = JSON.parse(callArgs) as Record<string, unknown>
    if (typeof args.command === 'string') return args.command
    return JSON.stringify(args, null, 2)
  } catch {
    // Unparseable model args: show the raw text rather than nothing.
    return callArgs
  }
}

/** Plain-data props (the card is ConversationView-internal, not a slot occupant). */
export interface ApprovalCardProps {
  /** The pending approval carrier (its key doubles as the React key at the call site). */
  wait: PendingApprovalWait
  /** The task's display title for the headline. */
  taskTitle: string
  /** The paired in-flight call's raw args JSON; absent when the ask carries no callId or the call left the window. */
  callArgs?: string | undefined
  /** Send the reject note into the task's conversation (session prompt); throws on wire failure. */
  sendNote: (text: string) => Promise<void>
  /** The daypaw-tasks locale seat. */
  t: PropsLocale<'daypaw-tasks'>['t']
}

/**
 * Render one pending approval as the conversation's top card.
 * @param props - plain data and callbacks from ConversationView.
 * @returns the card element tree.
 */
export function ApprovalCard({ wait, taskTitle, callArgs, sendNote, t }: ApprovalCardProps) {
  const [answered, setAnswered] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [failed, setFailed] = useState(false)
  const detail = detailOf(callArgs)
  const run = (action: () => Promise<void>): void => {
    setAnswered(true)
    setFailed(false)
    void action().catch(() => {
      setAnswered(false)
      setFailed(true)
    })
  }
  const approve = (): void => { run(() => answerApproval(wait, 'allowed-once')) }
  const reject = (): void => {
    // First click opens the optional note row; the confirm click rejects.
    if (!rejecting) {
      setRejecting(true)
      return
    }
    run(async () => {
      await answerApproval(wait, 'rejected')
      const text = note.trim()
      if (text !== '') await sendNote(text)
    })
  }
  return (
    <div className={css.card} data-approval-card="">
      <p className={css.headline}>
        {t('approval.headline', { task: taskTitle, summary: wait.payload.reason ?? t('approval.generic') })}
      </p>
      {detail !== undefined && (
        <details className={css.details}>
          <summary>{t('approval.details')}</summary>
          <pre className={css.detailBody}>{detail}</pre>
        </details>
      )}
      {rejecting && (
        <div className={css.noteRow}>
          <Input
            aria-label={t('approval.note.placeholder')}
            placeholder={t('approval.note.placeholder')}
            value={note}
            disabled={answered}
            onChange={(event) => { setNote(event.target.value) }}
          />
        </div>
      )}
      {failed && <div className={css.error}>{t('approval.failed')}</div>}
      <div className={css.actions}>
        <Button variant="outline" disabled={answered} onClick={reject}>
          {rejecting ? t('approval.note.confirm') : t('approval.reject')}
        </Button>
        <Button variant="primary" disabled={answered} onClick={approve}>
          {t('approval.allow')}
        </Button>
      </div>
    </div>
  )
}
