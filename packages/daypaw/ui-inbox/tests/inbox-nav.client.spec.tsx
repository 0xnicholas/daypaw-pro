// @vitest-environment jsdom
/** InboxNav: groups with live sessions-list counts, selection routing, the delegated new-task dialog, collapsed rail, skeleton snapshot. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore, type SessionListState, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { InboxNav, type InboxNavProps } from '../src/client/InboxNav.tsx'
import { InboxSelectionController } from '../src/client/selection.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// zh-dictionary translate stub: the component renders the same product copy
// the assertions below query by accessible name.
const t: InboxNavProps['t'] = key => (zh as Record<string, string>)[key] ?? key
// The nav never reads the workspaces hook; it rides the standard props share.
const neverHook = (() => { throw new Error('nav must not read the workspaces hook') }) as never

interface SummarySpec {
  id: string
  blank?: boolean
  running?: boolean
}

/** A sessions-list store carrying the given rows (displayTitle = id). */
function sessionsStore(rows: readonly SummarySpec[]): SnapshotStore<SessionListState> {
  const byId: SessionListState['byId'] = {}
  for (const row of rows) {
    byId[row.id as SessionId] = {
      id: row.id as SessionId,
      displayTitle: row.id,
      running: row.running ?? false,
      blank: row.blank ?? false,
      updatedAt: 1,
    }
  }
  return createSnapshotStore<SessionListState>({
    ids: rows.map(row => row.id as SessionId),
    byId,
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  })
}

function mountNav({ collapsed = false, rows = [] }: { collapsed?: boolean; rows?: readonly SummarySpec[] } = {}) {
  const openSession = vi.fn()
  const controller = new InboxSelectionController(openSession)
  const toggleSidebar = vi.fn()
  const renderSlot: InboxNavProps['renderSlot'] = ((_key: string, _owner: object, opts?: { fallback?: unknown }) =>
    (opts?.fallback ?? null)) as never
  const view = render(
    <InboxNav
      collapsed={collapsed} width={collapsed ? 56 : 300}
      useSessions={bindSnapshotSelector(sessionsStore(rows))} useWorkspaces={neverHook}
      useSelection={bindSnapshotSelector(controller.store)}
      select={(next) => { controller.select(next) }}
      toggleSidebar={toggleSidebar} renderSlot={renderSlot} t={t}
    />,
  )
  return { controller, openSession, toggleSidebar, view }
}

describe('InboxNav', () => {
  it('renders the expanded skeleton: wordmark, new-task button, groups with live counts, secondary nav', () => {
    const { toggleSidebar } = mountNav({
      rows: [
        { id: 'a', running: true },
        { id: 'b' },
        { id: 'c' },
        { id: 'draft', blank: true },
      ],
    })
    expect(screen.getByText('daypaw')).toBeTruthy()
    expect(screen.getByRole('button', { name: '新任务' })).toBeTruthy()
    // Live projection: one running, two settled; blank drafts never count;
    // 等待你确认 stays the placeholder zero until the approval board ticket.
    expect(screen.getByRole('button', { name: '等待你确认0' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '进行中1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '已完成2' })).toBeTruthy()
    // Secondary nav is reachable; 进行中 is the boot selection.
    expect(screen.getByRole('button', { name: 'Agents' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '进行中1' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(toggleSidebar).toHaveBeenCalledOnce()
  })

  it('routes group and secondary-nav clicks through select and moves the selected state', () => {
    const { controller, openSession } = mountNav()
    fireEvent.click(screen.getByRole('button', { name: '等待你确认0' }))
    expect(controller.store.getSnapshot()).toEqual({ kind: 'group', group: 'pending' })
    expect(screen.getByRole('button', { name: '等待你确认0' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '进行中0' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }))
    expect(controller.store.getSnapshot()).toEqual({ kind: 'agents' })
    expect(screen.getByRole('button', { name: 'Agents' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(controller.store.getSnapshot()).toEqual({ kind: 'settings' })
    // No task selection happened: the runtime current session stays untouched.
    expect(openSession).not.toHaveBeenCalled()
  })

  it('renders the dialog slot inside the Modal, falling back to the stub while empty, and closes by button and Escape', () => {
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

  it('hands the dialog occupant close and openTask owners; openTask selects the task and dismisses the dialog', () => {
    const controller = new InboxSelectionController(vi.fn())
    const owners: Record<string, unknown>[] = []
    const renderSlot: InboxNavProps['renderSlot'] = ((_key: string, owner: object) => {
      owners.push(owner as Record<string, unknown>)
      return <div>dialog-body</div>
    }) as never
    render(
      <InboxNav
        collapsed={false} width={300}
        useSessions={bindSnapshotSelector(sessionsStore([]))} useWorkspaces={neverHook}
        useSelection={bindSnapshotSelector(controller.store)}
        select={(next) => { controller.select(next) }}
        toggleSidebar={() => {}} renderSlot={renderSlot} t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '新任务' }))
    expect(screen.getByText('dialog-body')).toBeTruthy()
    const owner = owners[0] as { close: () => void; openTask: (sessionId: SessionId) => void }
    act(() => { owner.openTask('s1' as SessionId) })
    expect(controller.store.getSnapshot()).toEqual({ kind: 'task', sessionId: 's1' })
    // The dialog dismissed with the navigation.
    expect(screen.queryByRole('dialog')).toBeNull()
    // Reopen, then the plain close owner dismisses without selecting.
    fireEvent.click(screen.getByRole('button', { name: '新任务' }))
    act(() => { (owners.at(-1) as { close: () => void }).close() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(controller.store.getSnapshot()).toEqual({ kind: 'task', sessionId: 's1' })
  })

  it('renders the collapsed rail: toggle and new-task icon buttons only', () => {
    const { toggleSidebar } = mountNav({ collapsed: true, rows: [{ id: 'a', running: true }] })
    expect(screen.queryByText('daypaw')).toBeNull()
    expect(screen.queryByRole('button', { name: '进行中1' })).toBeNull()
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
