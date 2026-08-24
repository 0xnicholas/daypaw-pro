// @vitest-environment jsdom
/** TaskDetail: the right column's empty-state placeholder. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TaskDetail, type TaskDetailProps } from '../src/client/TaskDetail.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: TaskDetailProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('detail must not read framework hooks') }) as never

describe('TaskDetail', () => {
  it('renders the empty-state placeholder', () => {
    render(
      <TaskDetail
        sessionId={'session-1' as never}
        useSession={neverHook} useProjection={neverHook}
        useInput={neverHook} inputActions={undefined as never}
        useSessions={neverHook} useWorkspaces={neverHook}
        t={t}
      />,
    )
    expect(screen.getByRole('heading', { name: '任务详情' })).toBeTruthy()
    expect(screen.getByText('选择任务查看详情')).toBeTruthy()
  })
})
