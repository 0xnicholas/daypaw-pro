// @vitest-environment jsdom
/** TaskList: projected rows with the agent label and 最近动态 line, click-through to openTask, and the empty state. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { TaskList, type TaskListProps } from '../src/client/task-list.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** Locale double interpolating the {name} templates the activity label uses. */
const t: TaskListProps['t'] = (key, params) => {
  let text = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value))
  return text
}
const neverHook = (() => { throw new Error('the list must not read framework hooks') }) as never
const NOW = 400 * 86_400_000

function mountList(rows: TaskListProps['rows']) {
  const openTask = vi.fn()
  const openRun = vi.fn()
  render(
    <TaskList
      rows={rows} now={NOW} openTask={openTask} openRun={openRun}
      useSessions={neverHook} useWorkspaces={neverHook} t={t}
    />,
  )
  return { openTask, openRun }
}

const row = (title: string, updatedAt: number, agentPreset?: string): TaskListProps['rows'][number] => ({
  sessionId: title as SessionId,
  title,
  updatedAt,
  ...(agentPreset === undefined ? {} : { agentPreset }),
})

/** A durable-run row fixture; `sessionless` drops the session identity (a workflow run). */
const runRow = (
  title: string,
  status: 'running' | 'waiting' | 'done' | 'failed' | 'cancelled',
  sessionless = false,
): TaskListProps['rows'][number] => ({
  ...(sessionless ? {} : { sessionId: `run-${title}` as SessionId }),
  title,
  updatedAt: NOW,
  run: { runId: `run-${title}`, status, defKind: sessionless ? 'workflow' : 'agent' },
})

describe('TaskList', () => {
  it('renders each row with its title, agent, and 最近动态 line, opening the conversation on click', () => {
    const { openTask } = mountList([
      row('写一首诗', NOW - 5 * 60_000, 'standard'),
      row('整理周报', NOW - 3 * 3_600_000, 'my-agent'),
    ])
    fireEvent.click(screen.getByRole('button', { name: /写一首诗/ }))
    expect(openTask).toHaveBeenCalledWith('写一首诗')
    expect(screen.getByText('my-agent')).toBeTruthy()
    expect(screen.getByText('最近动态 5 分钟前')).toBeTruthy()
    expect(screen.getByText('最近动态 3 小时前')).toBeTruthy()
  })

  it('omits the agent label when the row carries no preset', () => {
    mountList([row('写一首诗', NOW)])
    const listRow = screen.getByRole('button', { name: /写一首诗/ })
    expect(listRow.querySelectorAll('span')).toHaveLength(2)
  })

  it('buckets the activity age from 刚刚 through 年前', () => {
    mountList([
      row('now', NOW),
      row('minutes', NOW - 5 * 60_000),
      row('hours', NOW - 3 * 3_600_000),
      row('days', NOW - 2 * 86_400_000),
      row('months', NOW - 65 * 86_400_000),
      row('years', NOW - 400 * 86_400_000),
    ])
    expect(screen.getByText('最近动态 刚刚')).toBeTruthy()
    expect(screen.getByText('最近动态 5 分钟前')).toBeTruthy()
    expect(screen.getByText('最近动态 3 小时前')).toBeTruthy()
    expect(screen.getByText('最近动态 2 天前')).toBeTruthy()
    expect(screen.getByText('最近动态 2 个月前')).toBeTruthy()
    expect(screen.getByText('最近动态 1 年前')).toBeTruthy()
  })

  it('renders the list empty state for an empty group', () => {
    mountList([])
    expect(screen.getByText('暂无任务')).toBeTruthy()
  })

  it('renders the strict status text on run rows', () => {
    mountList([
      runRow('running-task', 'running'),
      runRow('waiting-task', 'waiting'),
      runRow('done-task', 'done'),
      runRow('failed-task', 'failed'),
      runRow('cancelled-task', 'cancelled'),
    ])
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('等待确认')).toBeTruthy()
    expect(screen.getByText('已完成')).toBeTruthy()
    expect(screen.getByText('出错了')).toBeTruthy()
    expect(screen.getByText('已取消')).toBeTruthy()
  })

  it('renders 等待确认 on awaiting-approval rows, run-backed or run-less, over the run status', () => {
    mountList([
      { ...runRow('agent-task', 'running'), awaitingApproval: true },
      { ...row('session-task', NOW), awaitingApproval: true },
    ])
    const waiting = screen.getAllByText('等待确认')
    expect(waiting).toHaveLength(2)
    // The run row's own status (进行中) does not compete with the waiting copy.
    expect(screen.queryByText('进行中')).toBeNull()
  })

  it('opens a session-backed run row through openTask', () => {
    const { openTask } = mountList([runRow('agent-task', 'running')])
    fireEvent.click(screen.getByRole('button', { name: /agent-task/ }))
    expect(openTask).toHaveBeenCalledWith('run-agent-task')
  })

  it('opens a session-less workflow row through openRun (keyed by runId)', () => {
    const { openTask, openRun } = mountList([
      runRow('workflow-task', 'running', true),
      runRow('other-task', 'done', true),
    ])
    expect(screen.getByText('workflow-task')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /workflow-task/ }))
    expect(openTask).not.toHaveBeenCalled()
    expect(openRun).toHaveBeenCalledWith('run-workflow-task')
  })
})
