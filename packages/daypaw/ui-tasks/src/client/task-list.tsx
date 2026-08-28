/**
 * Group task list (the 'inbox.workspace.tasks' occupant): the owner's
 * projected rows as plain task entries — title, the agent running it, the
 * strict status text when the row comes from a durable run (failed reads in
 * the error color), and the 最近动态 last-activity line (a crash-revival pause
 * keeps reading as an active, recently-moving task) — each opening its
 * conversation on click. An empty group renders the list's own empty state
 * (the owner's per-group copy is the no-occupant fallback).
 */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-inbox's SlotMap merge (the tasks seat) in so
// PropsRuntime<'inbox.workspace.tasks'> resolves.
import type {} from '@daypaw/ui-inbox/client'
import { runStatusKey } from './run-status.ts'
import css from './task-list.module.css'

/** Full component props: owner share (projected rows + now + openTask/openRun) + locale seat. */
export type TaskListProps =
  PropsRuntime<'inbox.workspace.tasks'>
  & PropsLocale<'daypaw-tasks'>

/** Last-activity age bucket for a row's 最近动态 label. */
interface ActivityBucket {
  /** The bucket unit ('now' covers anything under a minute, future-inclusive). */
  unit: 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'
  /** The bucket magnitude (0 for 'now'). */
  n: number
}

/**
 * Bucket a row's last-activity age (the ui-workspace relativeTime buckets).
 * @param updatedAt - epoch ms of the task's last activity.
 * @param now - current epoch ms (owner-injected for pure rendering).
 * @returns the age bucket and magnitude.
 */
function activityBucket(updatedAt: number, now: number): ActivityBucket {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - updatedAt)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}

/**
 * Localized 最近动态 label for one row ("最近动态 刚刚" / "Last activity 5 min ago").
 * @param updatedAt - epoch ms of the task's last activity.
 * @param now - current epoch ms.
 * @param t - the locale seat.
 * @returns the row's activity line.
 */
function activityLabel(updatedAt: number, now: number, t: TaskListProps['t']): string {
  const { unit, n } = activityBucket(updatedAt, now)
  const time = unit === 'now' ? t('list.time.now') : t(`list.time.${unit}`, { n })
  return t('list.recent', { time })
}

/**
 * The row's React key: its session identity, else its run identity. The
 * owner's projection builds every row from a session, a run, or both (never
 * neither), so one of the two always resolves.
 * @param row - one projected task row.
 * @returns the row's stable key.
 */
function rowKey(row: TaskListProps['rows'][number]): string {
  if (row.sessionId !== undefined) return row.sessionId
  return (row.run as NonNullable<TaskListProps['rows'][number]['run']>).runId
}

/**
 * Render one inbox group's task list.
 * @param props - composed slot props (owner share + locale seat).
 * @returns the list element tree.
 */
export function TaskList({ rows, now, openTask, openRun, t }: TaskListProps) {
  if (rows.length === 0) return <div className={css.empty}>{t('list.empty')}</div>
  return (
    <ul className={css.list}>
      {rows.map(row => (
        <li key={rowKey(row)}>
          <button
            type="button"
            className={css.row}
            onClick={() => {
              // A workflow-run row has no session: its click selects the run
              // (right-column detail) instead of opening a conversation.
              if (row.sessionId !== undefined) openTask(row.sessionId)
              else if (row.run !== undefined) openRun(row.run.runId)
            }}
          >
            <span className={css.title}>{row.title}</span>
            {row.awaitingApproval === true
              // The pending-group status reads 等待确认 whatever the run says;
              // run-less session rows (no run status to show) carry it too.
              ? <span className={css.status}>{t('list.status.waiting')}</span>
              : row.run !== undefined && (
                <span className={clsx(css.status, row.run.status === 'failed' && css.statusFailed)}>
                  {t(runStatusKey(row.run.status))}
                </span>
              )}
            <span className={css.activity}>{activityLabel(row.updatedAt, now, t)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
