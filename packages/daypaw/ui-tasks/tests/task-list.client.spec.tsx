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
  render(
    <TaskList
      rows={rows} now={NOW} openTask={openTask}
      useSessions={neverHook} useWorkspaces={neverHook} t={t}
    />,
  )
  return { openTask }
}

const row = (title: string, updatedAt: number, agentPreset?: string): TaskListProps['rows'][number] => ({
  sessionId: title as SessionId,
  title,
  updatedAt,
  ...(agentPreset === undefined ? {} : { agentPreset }),
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
})
