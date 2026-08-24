// @vitest-environment jsdom
/** InboxNav: groups with count slots, selection routing, dialog stub, collapsed rail, expanded skeleton snapshot. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { InboxNav, type InboxNavProps } from '../src/client/InboxNav.tsx'
import { InboxSelectionController } from '../src/client/selection.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// zh-dictionary translate stub: the component renders the same product copy
// the assertions below query by accessible name.
const t: InboxNavProps['t'] = key => (zh as Record<string, string>)[key] ?? key
// The nav never reads the global hooks; they ride the standard props share.
const neverHook = (() => { throw new Error('nav must not read global hooks') }) as never

function mountNav({ collapsed = false }: { collapsed?: boolean } = {}) {
  const controller = new InboxSelectionController()
  const toggleSidebar = vi.fn()
  const view = render(
    <InboxNav
      collapsed={collapsed} width={collapsed ? 56 : 300}
      useSessions={neverHook} useWorkspaces={neverHook}
      useSelection={bindSnapshotSelector(controller.store)}
      select={(next) => { controller.select(next) }}
      toggleSidebar={toggleSidebar} t={t}
    />,
  )
  return { controller, toggleSidebar, view }
}

describe('InboxNav', () => {
  it('renders the expanded skeleton: wordmark, new-task button, groups with count slots, secondary nav', () => {
    const { toggleSidebar } = mountNav()
    expect(screen.getByText('daypaw')).toBeTruthy()
    expect(screen.getByRole('button', { name: '新任务' })).toBeTruthy()
    // Three inbox groups, each carrying its (placeholder-zero) count slot.
    for (const label of ['等待你确认', '进行中', '已完成']) {
      const row = screen.getByRole('button', { name: `${label}0` })
      expect(row).toBeTruthy()
    }
    // Secondary nav is reachable; 进行中 is the boot selection.
    expect(screen.getByRole('button', { name: 'Agents' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '进行中0' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(toggleSidebar).toHaveBeenCalledOnce()
  })

  it('routes group and secondary-nav clicks through select and moves the selected state', () => {
    const { controller } = mountNav()
    fireEvent.click(screen.getByRole('button', { name: '等待你确认0' }))
    expect(controller.store.getSnapshot()).toEqual({ kind: 'group', group: 'pending' })
    expect(screen.getByRole('button', { name: '等待你确认0' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '进行中0' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }))
    expect(controller.store.getSnapshot()).toEqual({ kind: 'agents' })
    expect(screen.getByRole('button', { name: 'Agents' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(controller.store.getSnapshot()).toEqual({ kind: 'settings' })
  })

  it('opens the new-task dialog stub and closes it by button and by Escape', () => {
    mountNav()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '新任务' }))
    expect(screen.getByRole('dialog', { name: '新任务' })).toBeTruthy()
    expect(screen.getByText('这里将让你选择执行任务的 Agent，敬请期待。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '新任务' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the collapsed rail: toggle and new-task icon buttons only', () => {
    const { toggleSidebar } = mountNav({ collapsed: true })
    expect(screen.queryByText('daypaw')).toBeNull()
    expect(screen.queryByRole('button', { name: '等待你确认0' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '打开侧边栏' }))
    expect(toggleSidebar).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    expect(screen.getByRole('dialog', { name: '新任务' })).toBeTruthy()
  })

  it('matches the expanded skeleton snapshot', () => {
    const { view } = mountNav()
    expect(view.container).toMatchSnapshot()
  })
})
