/**
 * Gate answer card (issue #128): a durable run suspended on `ctx.waitFor`
 * shows the gate it waits on and the two answers the browser plane can send —
 * an approval carrying a JSON value the gate's contract validates, or a
 * rejection carrying a reason. It renders in the detail column because a
 * session-less workflow run has no conversation seat to pin a card to; the
 * drafts and the outcome live in {@link GateAnswerStore}.
 */
import { useEffect } from 'react'
import clsx from 'clsx'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GateAnswerState, GateAnswerStore } from './gate-answer-store.ts'
import type { DaypawTasksKey } from './locales.ts'
import css from './gate-card.module.css'

/** Answer outcome → locale key. */
const OUTCOME_KEY: Record<NonNullable<GateAnswerState['outcome']>, DaypawTasksKey> = {
  answered: 'detail.gate.answered',
  superseded: 'detail.gate.superseded',
  failed: 'detail.gate.failed',
}

/** Card props: the run and gate on screen, the controller, and the locale seat. */
export interface GateCardProps {
  /** The run whose gate pends (`runs.waiting_gate` is set on its row). */
  readonly runId: string
  /** The gate name, shown as the definition declared it. */
  readonly gate: string
  /** The answer controller (one per apply). */
  readonly answer: GateAnswerStore
  /** The controller's snapshot selector, bound by the renderer. */
  readonly useAnswer: SnapshotSelectorHook<GateAnswerState>
  /** The task surface's translate seat. */
  readonly t: TranslateNS<'daypaw-tasks'>
}

/**
 * Render the pending gate's answer card.
 * @param props - the run/gate, the answer controller, and its hook.
 * @returns the card element tree.
 */
export function GateCard({ runId, gate, answer, useAnswer, t }: GateCardProps) {
  // Drafts belong to one run: pointing the controller at a different
  // selection resets them (an unchanged target is a no-op).
  useEffect(() => { answer.bind(runId) }, [answer, runId])
  const state = useAnswer(s => s)
  // Until the effect binds this run, the snapshot's drafts belong to another
  // one: render blanks rather than someone else's text.
  const bound = state.runId === runId
  const value = bound ? state.value : ''
  const reason = bound ? state.reason : ''
  const parsed = bound ? answer.parseValue() : undefined
  const invalid = value.trim() !== '' && parsed instanceof SyntaxError
  const outcome = bound ? state.outcome : undefined
  const busy = state.submitting

  return (
    <section className={css.card} aria-label={t('detail.gate.heading')}>
      <h3 className={css.headline}>{t('detail.gate.heading')}</h3>
      {/* The gate name is the definition author's own label (spec 05 §2). */}
      <p className={css.gate}>{gate}</p>
      <label className={css.field}>
        <span className={css.label}>{t('detail.gate.value.label')}</span>
        <textarea
          className={css.input}
          aria-label={t('detail.gate.value.label')}
          placeholder={t('detail.gate.value.placeholder')}
          disabled={busy}
          value={value}
          onChange={(event) => { answer.setValue(event.target.value) }}
        />
        {invalid && <p className={css.error}>{t('detail.gate.value.invalid')}</p>}
      </label>
      <label className={css.field}>
        <span className={css.label}>{t('detail.gate.reason.label')}</span>
        <textarea
          className={css.input}
          aria-label={t('detail.gate.reason.label')}
          disabled={busy}
          value={reason}
          onChange={(event) => { answer.setReason(event.target.value) }}
        />
      </label>
      {outcome !== undefined && <p className={clsx(css.outcome)}>{t(OUTCOME_KEY[outcome])}</p>}
      <div className={css.actions}>
        <Button
          variant="primary"
          disabled={!bound || busy || value.trim() === '' || invalid}
          onClick={() => { void answer.approve(gate) }}
        >
          {busy ? t('detail.gate.submitting') : t('detail.gate.approve')}
        </Button>
        <Button disabled={!bound || busy} onClick={() => { void answer.reject(gate) }}>
          {t('detail.gate.reject')}
        </Button>
      </div>
    </section>
  )
}
