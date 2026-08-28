// @vitest-environment jsdom
/** WorkspaceSwitch: the middle column follows the shared selection and delegates the banner/settings/tasks/conversation holes. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { WorkspaceSwitch, type WorkspaceSwitchProps } from '../src/client/WorkspaceSwitch.tsx'
import type {
  InboxBannerOwnerProps, InboxSettingsPageOwnerProps, InboxTasksOwnerProps,
} from '../src/client/contract.ts'
import { InboxSelectionController } from '../src/client/selection.ts'
import type { RunsBoardState } from '../src/client/runs-store.ts'
import type { WireRun } from '../src/client/runs-api.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WorkspaceSwitchProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('workspace must not read framework hooks') }) as never

interface RenderedCall {
  key: string
  owner: Record<string, unknown>
  opts: { fallback?: unknown } | undefined
}

function listState(): SessionListState {
  const row = (id: string, running: boolean, blank = false): SessionListState['byId'][SessionId] => ({
    id: id as SessionId,
    displayTitle: `title-${id}`,
    running,
    blank,
    updatedAt: 1,
  })
  return {
    // 'ghost' proves the masked-gap arm: an id the list names but byId lacks
    // (reconnect re-pull window) projects no row.
    ids: ['a', 'b', 'c', 'draft', 'ghost'] as SessionId[],
    byId: {
      a: row('a', true),
      b: row('b', false),
      c: row('c', false),
      draft: row('draft', false, true),
    } as SessionListState['byId'],
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function mountWorkspace(renderChild?: (call: RenderedCall) => React.ReactNode, runs: readonly WireRun[] = []) {
  const controller = new InboxSelectionController(vi.fn())
  const calls: RenderedCall[] = []
  const renderSlot: WorkspaceSwitchProps['renderSlot'] = ((key: string, owner: object, opts?: { fallback?: unknown }) => {
    const call: RenderedCall = { key, owner: owner as Record<string, unknown>, opts }
    calls.push(call)
    return renderChild === undefined ? (opts?.fallback ?? null) : renderChild(call)
  }) as never
  render(
    <WorkspaceSwitch
      sessionId={undefined}
      useSession={neverHook} useProjection={neverHook}
      useInput={neverHook} inputActions={undefined as never}
      useSessionPendingInteraction={bindSnapshotSelector(createSnapshotStore<Map<string, unknown>>(new Map())) as never}
      useSessions={bindSnapshotSelector(createSnapshotStore(listState()))} useWorkspaces={neverHook}
      useConversation={neverHook}
      SessionProvider={neverHook}
      useSelection={bindSnapshotSelector(controller.store)}
      useBoard={bindSnapshotSelector(createSnapshotStore<RunsBoardState>({ status: 'ready', runs }))}
      select={(next) => { controller.select(next) }}
      renderSlot={renderSlot}
      t={t}
    />,
  )
  return { controller, calls }
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

  it('delegates the group task list with rows projected from the sessions list', () => {
    const { controller, calls } = mountWorkspace(call =>
      call.key === 'inbox.workspace.tasks' ? <div>task-list</div> : (call.opts?.fallback ?? null) as React.ReactNode)
    expect(screen.getByText('task-list')).toBeTruthy()
    const tasks = calls.find(call => call.key === 'inbox.workspace.tasks')!
    const owner = tasks.owner as unknown as InboxTasksOwnerProps
    // The owner injects the clock for the rows' 最近动态 labels.
    expect(typeof owner.now).toBe('number')
    // Only non-blank running rows land in the running group.
    expect(owner.rows.map(row => row.title)).toEqual(['title-a'])
    // The done group carries the two settled rows, the draft never lists.
    act(() => { controller.select({ kind: 'group', group: 'done' }) })
    const done = calls.findLast(call => call.key === 'inbox.workspace.tasks')!
    const doneOwner = done.owner as unknown as InboxTasksOwnerProps
    expect(doneOwner.rows.map(row => row.title)).toEqual(['title-b', 'title-c'])
    // openTask selects the task kind, which the controller drives to sessions.open.
    doneOwner.openTask('b' as SessionId)
    expect(controller.store.getSnapshot()).toEqual({ kind: 'task', sessionId: 'b' })
    // openRun selects a session-less workflow run (no sessions.open drive).
    doneOwner.openRun('run-wf')
    expect(controller.store.getSnapshot()).toEqual({ kind: 'run', runId: 'run-wf' })
    // No row carries an approval badge, so the pending group lists empty.
    act(() => { controller.select({ kind: 'group', group: 'pending' }) })
    const pending = calls.findLast(call => call.key === 'inbox.workspace.tasks')!
    expect((pending.owner as unknown as InboxTasksOwnerProps).rows).toEqual([])
  })

  it('renders the agents page slot for the agents selection, falling back to the placeholder when empty', () => {
    const { controller, calls } = mountWorkspace()
    act(() => { controller.select({ kind: 'agents' }) })
    // Empty slot: the owner's placeholder copy stays.
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(screen.getByText('Agent 目录即将上线')).toBeTruthy()
    const page = calls.find(call => call.key === 'inbox.agents.page')!
    expect(page.owner).toEqual({})
  })

  it('hands the agents page seat to its occupant when one is registered', () => {
    const { controller } = mountWorkspace(call =>
      call.key === 'inbox.agents.page' ? <div>agents-page</div> : (call.opts?.fallback ?? null) as React.ReactNode)
    act(() => { controller.select({ kind: 'agents' }) })
    expect(screen.getByText('agents-page')).toBeTruthy()
    expect(screen.queryByText('Agent 目录即将上线')).toBeNull()
  })

  it('renders the banner strip atop every group container with an openSettings that selects settings', () => {
    const { controller, calls } = mountWorkspace(call =>
      call.key === 'inbox.workspace.banner' ? <div>banner-seat</div> : null)
    expect(screen.getByText('banner-seat')).toBeTruthy()
    const banner = calls.find(call => call.key === 'inbox.workspace.banner')!
    ;(banner.owner as unknown as InboxBannerOwnerProps).openSettings()
    expect(controller.store.getSnapshot()).toEqual({ kind: 'settings' })
    // Group containers for other selections carry the strip too.
    act(() => { controller.select({ kind: 'group', group: 'pending' }) })
    expect(screen.getByText('banner-seat')).toBeTruthy()
  })

  it('renders the settings page slot for the settings selection, falling back to the placeholder when empty', () => {
    const { controller } = mountWorkspace()
    act(() => { controller.select({ kind: 'settings' }) })
    // Empty slot: the owner's placeholder copy stays.
    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
    expect(screen.getByText('设置页即将上线')).toBeTruthy()
  })

  it('hands the settings page a close owner that returns to the running group', () => {
    const { controller, calls } = mountWorkspace(call =>
      call.key === 'inbox.settings.page' ? <div>settings-page</div> : (call.opts?.fallback ?? null) as React.ReactNode)
    act(() => { controller.select({ kind: 'settings' }) })
    expect(screen.getByText('settings-page')).toBeTruthy()
    expect(screen.queryByText('设置页即将上线')).toBeNull()
    const page = calls.find(call => call.key === 'inbox.settings.page')!
    ;(page.owner as unknown as InboxSettingsPageOwnerProps).close()
    expect(controller.store.getSnapshot()).toEqual({ kind: 'group', group: 'running' })
  })

  it('renders the conversation slot for a task selection, falling back to the placeholder when empty', () => {
    const { controller, calls } = mountWorkspace()
    act(() => { controller.select({ kind: 'task', sessionId: 'a' as SessionId }) })
    expect(screen.getByText('对话即将上线')).toBeTruthy()
    expect(calls.some(call => call.key === 'inbox.workspace.conversation')).toBe(true)
    // The group container (header + banner + list) is gone.
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('hands the conversation occupant an empty owner share', () => {
    const { controller, calls } = mountWorkspace(call =>
      call.key === 'inbox.workspace.conversation' ? <div>conversation-seat</div> : null)
    act(() => { controller.select({ kind: 'task', sessionId: 'a' as SessionId }) })
    expect(screen.getByText('conversation-seat')).toBeTruthy()
    const conversation = calls.find(call => call.key === 'inbox.workspace.conversation')!
    expect(conversation.owner).toEqual({})
  })

  it('lists run rows in the group containers: a workflow run rows without a session, an agent run dedupes its twin', () => {
    const runs: WireRun[] = [
      { runId: 'w1', defKind: 'workflow', defName: 'close-the-books', status: 'running', parentRunId: null, outputJson: null, updatedAt: 500 },
      { runId: 'a', defKind: 'agent', defName: 'fix-tests', status: 'waiting', parentRunId: null, outputJson: null, updatedAt: 400 },
    ]
    const { calls } = mountWorkspace(undefined, runs)
    const tasks = calls.find(call => call.key === 'inbox.workspace.tasks')!
    const owner = tasks.owner as unknown as InboxTasksOwnerProps
    // updatedAt desc: the workflow run leads; the agent run takes its twin's
    // displayTitle and the twin session row is skipped.
    expect(owner.rows.map(row => [row.title, row.sessionId, row.run?.defKind])).toEqual([
      ['close-the-books', undefined, 'workflow'],
      ['title-a', 'a', 'agent'],
    ])
  })

  it('renders the run placeholder for a session-less workflow-run selection', () => {
    const { controller, calls } = mountWorkspace()
    act(() => { controller.select({ kind: 'run', runId: 'w1' }) })
    expect(screen.getByText('该任务没有对话，进度与产出见右栏详情')).toBeTruthy()
    // No conversation seat, no group container.
    expect(calls.every(call => call.key !== 'inbox.workspace.conversation')).toBe(true)
    expect(screen.queryByRole('heading')).toBeNull()
  })
})
