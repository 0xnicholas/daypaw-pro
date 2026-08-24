/**
 * Group task list (the 'inbox.workspace.tasks' occupant): the owner's
 * projected rows as plain task entries — title, the agent running it, and the
 * 最近动态 last-activity line (a crash-revival pause keeps reading as an
 * active, recently-moving task) — each opening its conversation on click. An
 * empty group renders the list's own empty state (the owner's per-group copy
 * is the no-occupant fallback).
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-inbox's SlotMap merge (the tasks seat) in so
// PropsRuntime<'inbox.workspace.tasks'> resolves.
import type {} from '@daypaw/ui-inbox/client'
import css from './task-list.module.css'

/** Full component props: owner share (projected rows + now + openTask) + locale seat. */
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
 * Render one inbox group's task list.
 * @param props - composed slot props (owner share + locale seat).
 * @returns the list element tree.
 */
export function TaskList({ rows, now, openTask, t }: TaskListProps) {
  if (rows.length === 0) return <div className={css.empty}>{t('list.empty')}</div>
  return (
    <ul className={css.list}>
      {rows.map(row => (
        <li key={row.sessionId}>
          <button
            type="button"
            className={css.row}
            onClick={() => { openTask(row.sessionId) }}
          >
            <span className={css.title}>{row.title}</span>
            {row.agentPreset !== undefined && <span className={css.agent}>{row.agentPreset}</span>}
            <span className={css.activity}>{activityLabel(row.updatedAt, now, t)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
