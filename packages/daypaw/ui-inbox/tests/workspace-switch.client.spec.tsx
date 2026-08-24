// @vitest-environment jsdom
/** WorkspaceSwitch: the middle column switches its container with the shared selection. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { WorkspaceSwitch, type WorkspaceSwitchProps } from '../src/client/WorkspaceSwitch.tsx'
import { InboxSelectionController } from '../src/client/selection.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WorkspaceSwitchProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('workspace must not read framework hooks') }) as never

function mountWorkspace() {
  const controller = new InboxSelectionController()
  render(
    <WorkspaceSwitch
      sessionId={undefined}
      useSession={neverHook} useProjection={neverHook}
      useInput={neverHook} inputActions={undefined as never}
      useSessions={neverHook} useWorkspaces={neverHook}
      useSelection={bindSnapshotSelector(controller.store)}
      t={t}
    />,
  )
  return { controller }
}

describe('WorkspaceSwitch', () => {
  it('shows the running group container by default and follows group selection', () => {
    const { controller } = mountWorkspace()
    expect(screen.getByRole('heading', { name: '进行中' })).toBeTruthy()
    expect(screen.getByText('暂无进行中的任务')).toBeTruthy()
    act(() => { controller.select({ kind: 'group', group: 'pending' }) })
    expect(screen.getByRole('heading', { name: '等待你确认' })).toBeTruthy()
    expect(screen.getByText('暂无等待确认的任务')).toBeTruthy()
    act(() => { controller.select({ kind: 'group', group: 'done' }) })
    expect(screen.getByRole('heading', { name: '已完成' })).toBeTruthy()
    expect(screen.getByText('暂无已完成的任务')).toBeTruthy()
  })

  it('switches to the Agents and 设置 placeholder pages', () => {
    const { controller } = mountWorkspace()
    act(() => { controller.select({ kind: 'agents' }) })
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(screen.getByText('Agent 目录即将上线')).toBeTruthy()
    act(() => { controller.select({ kind: 'settings' }) })
    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
    expect(screen.getByText('设置页即将上线')).toBeTruthy()
  })
})
