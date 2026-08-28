/**
 * Task detail body (the 'inbox.detail.body' occupant): four sections under
 * the owner's header — 进度 (a workflow run's step timeline from the journal;
 * otherwise the session's business-language tail with the 进行中 line), 子任务
 * (the run's lineage children), 产出物 (the settled output), and 审批历史 (the
 * session's approvalHistory projection). Owner props key off the workbench
 * selection, never the session seat: the seat is strict session scope and may
 * carry a STALE session while a workflow run is selected, so session-bound
 * sections (progress tail, approvals) read it only when its sessionId matches
 * the selection's session identity (an agent run's identity IS its runId).
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: ui-inbox's SlotMap merge (the detail seat) plus the detail view
// and wire types it re-exports for occupants.
import type { TaskDetailView, WireJournalEntry } from '@daypaw/ui-inbox/client'
// Type-only: the approvalHistory SessionProjectionMap key merge (the domain's
// pure outlet — the value itself arrives through the session seat).
import type { ApprovalHistoryEntry } from '@daypaw/approval-history/types'
import { projectBusinessRows, type BusinessRow } from './chat-projection.ts'
import { runStatusKey } from './run-status.ts'
import type { DaypawTasksKey } from './locales.ts'
import css from './detail-body.module.css'

/** Full component props: owner share (the selection-keyed detail view) + session standard kit + locale seat. */
export type DetailBodyProps =
  PropsRuntime<'inbox.detail.body'>
  & PropsLocale<'daypaw-tasks'>

/** The business tail the progress section draws for a session-backed task. */
const PROGRESS_TAIL = 3

/** Journal step status → locale key (started reads as 进行中, the strict vocabulary). */
const STEP_STATUS_KEY: Record<WireJournalEntry['status'], DaypawTasksKey> = {
  started: 'detail.step.started',
  completed: 'detail.step.completed',
  failed: 'detail.step.failed',
}

/** Approval outcome → locale key; an unanswered ask reads as 等待确认. */
const APPROVAL_OUTCOME_KEY: Record<NonNullable<ApprovalHistoryEntry['outcome']>, DaypawTasksKey> = {
  'allowed-once': 'detail.approval.allowed-once',
  'rejected': 'detail.approval.rejected',
  'cancelled': 'detail.approval.cancelled',
  'unavailable': 'detail.approval.unavailable',
}

/**
 * Whether the session seat backs this selection: a session task by its
 * sessionId, an agent run by its runId (its session identity), a workflow
 * run never (it has no session — the seat is stale under its selection).
 * @param detail - the selection-keyed detail view (never 'none').
 * @param sessionId - the seat's framework-resolved session id.
 * @returns whether session-bound sections may read the seat.
 */
function seatMatches(detail: TaskDetailView, sessionId: SessionId): boolean {
  if (detail.kind === 'session') return detail.sessionId === sessionId
  return detail.kind === 'run' && detail.run.defKind === 'agent' && detail.run.runId === sessionId
}

/** The deliverable cell text: strings direct, other scalars stringified, objects JSON. */
function deliverableText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return String(value)
  return JSON.stringify(value)
}

/** A top-level output object renders one label/value row per entry. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Section content props: the locale seat plus the facts the section reads. */
interface SectionProps {
  t: DetailBodyProps['t']
}

/** 进度: the workflow step timeline, or the session-backed business tail. */
function Progress({ detail, ownSeat, chat, running, t }: SectionProps & {
  detail: TaskDetailView
  ownSeat: boolean
  chat: ChatSnapshot
  running: boolean
}) {
  const empty = <div className={css.empty}>{t('detail.progress.empty')}</div>
  if (detail.kind === 'run' && detail.run.defKind === 'workflow') {
    const timeline = detail.timeline
    if (timeline === undefined || timeline.length === 0) return empty
    return timeline.map(step => (
      <div key={`${step.stepKey}:${step.occurrence}`} className={css.row}>
        <span className={css.rowLabel}>{step.name}</span>
        <span className={css.rowStatus}>{t(STEP_STATUS_KEY[step.status])}</span>
      </div>
    ))
  }
  // Agent runs and session tasks read the conversation — only through the
  // selection's own seat.
  if (!ownSeat) return empty
  const rows = projectBusinessRows(chat).slice(-PROGRESS_TAIL)
  if (rows.length === 0 && !running) return empty
  const rowText = (row: BusinessRow): string => row.kind === 'error' ? t('conversation.error') : row.text
  return (
    <>
      {rows.map(row => (
        <div key={row.key} className={css.row}>
          <span className={row.kind === 'error' ? css.rowError : css.rowLabel}>{rowText(row)}</span>
        </div>
      ))}
      {running && (
        <div className={css.row}>
          <span className={css.rowStatus}>{t('conversation.running')}</span>
        </div>
      )}
    </>
  )
}

/** 子任务: the run's lineage children (defName + strict status text). */
function Subtasks({ detail, t }: SectionProps & { detail: TaskDetailView }) {
  const empty = <div className={css.empty}>{t('detail.subtasks.empty')}</div>
  const children = detail.kind === 'run' ? detail.lineage?.children : undefined
  if (children === undefined || children.length === 0) return empty
  return children.map(child => (
    <div key={child.runId} className={css.row}>
      <span className={css.rowLabel}>{child.defName}</span>
      <span className={css.rowStatus}>{t(runStatusKey(child.status))}</span>
    </div>
  ))
}

/** 产出物: the settled output — one row per top-level entry, or a single scalar row. */
function Deliverables({ detail, t }: SectionProps & { detail: TaskDetailView }) {
  const empty = <div className={css.empty}>{t('detail.deliverables.empty')}</div>
  if (detail.kind !== 'run' || detail.output === undefined) return empty
  const output = detail.output
  if (!isPlainRecord(output)) {
    return (
      <div className={css.row}>
        <span className={css.rowLabel}>{deliverableText(output)}</span>
      </div>
    )
  }
  const entries = Object.entries(output)
  if (entries.length === 0) return empty
  return entries.map(([key, value]) => (
    <div key={key} className={css.row}>
      <span className={css.rowLabel}>{key}</span>
      <span className={css.rowValue}>{deliverableText(value)}</span>
    </div>
  ))
}

/** 审批历史: the session's approval asks, newest facts in log order (reason beats toolName). */
function Approvals({ ownSeat, entries, t }: SectionProps & {
  ownSeat: boolean
  entries: readonly ApprovalHistoryEntry[] | undefined
}) {
  const empty = <div className={css.empty}>{t('detail.approvals.empty')}</div>
  if (!ownSeat || entries === undefined || entries.length === 0) return empty
  return entries.map(entry => (
    <div key={entry.id} className={css.row}>
      <span className={css.rowLabel}>{entry.reason ?? entry.toolName}</span>
      <span className={css.rowStatus}>
        {t(entry.outcome === undefined ? 'detail.approval.pending' : APPROVAL_OUTCOME_KEY[entry.outcome])}
      </span>
    </div>
  ))
}

/**
 * Render the selected task's detail body. Returns null for the none
 * selection (no task selected — the owner's header is absent too).
 * @param props - composed slot props (owner share + session standard kit + locale seat).
 * @returns the four-section body tree, or null.
 */
export function DetailBody({ detail, useSession, useChat, sessionId, useProjection, t }: DetailBodyProps) {
  // The seats are read unconditionally (hook order); seatMatches below decides
  // whether their values apply to this selection.
  const chat = useChat(s => s)
  const running = useSession(s => s.running)
  const approvals = useProjection('approvalHistory')
  if (detail.kind === 'none') return null
  const ownSeat = seatMatches(detail, sessionId)
  return (
    <div className={css.root}>
      <section className={css.section}>
        <h3 className={css.heading}>{t('detail.progress.heading')}</h3>
        <Progress detail={detail} ownSeat={ownSeat} chat={chat} running={running} t={t} />
      </section>
      <section className={css.section}>
        <h3 className={css.heading}>{t('detail.subtasks.heading')}</h3>
        <Subtasks detail={detail} t={t} />
      </section>
      <section className={css.section}>
        <h3 className={css.heading}>{t('detail.deliverables.heading')}</h3>
        <Deliverables detail={detail} t={t} />
      </section>
      <section className={css.section}>
        <h3 className={css.heading}>{t('detail.approvals.heading')}</h3>
        <Approvals ownSeat={ownSeat} entries={approvals} t={t} />
      </section>
    </div>
  )
}
