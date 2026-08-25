// @vitest-environment jsdom
/** TaskDetail: selection-keyed detail column — empty state, session-task body, run header (status copy + 重试), body slot view. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { TaskDetail, type TaskDetailProps } from '../src/client/TaskDetail.tsx'
import type { InboxDetailBodyOwnerProps } from '../src/client/contract.ts'
import { DEFAULT_SELECTION, type InboxSelection } from '../src/client/selection.ts'
import type { TaskDetailState } from '../src/client/runs-store.ts'
import type { WireRun } from '../src/client/runs-api.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: TaskDetailProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('detail must not read framework hooks') }) as never

function run(overrides: Partial<WireRun> = {}): WireRun {
  return {
    runId: 'r1',
    defKind: 'workflow',
    defName: 'close-the-books',
    status: 'running',
    parentRunId: null,
    outputJson: null,
    updatedAt: 100,
    ...overrides,
  }
}

function detailState(overrides: Partial<TaskDetailState> = {}): TaskDetailState {
  return { runId: undefined, status: 'idle', lineage: undefined, timeline: undefined, ...overrides }
}

interface RenderedBody {
  owner: InboxDetailBodyOwnerProps
  opts: { fallback?: unknown } | undefined
}

function mountDetail({ selection = DEFAULT_SELECTION, state = detailState() }: {
  selection?: InboxSelection
  state?: TaskDetailState
} = {}) {
  const retry = vi.fn()
  const bodies: RenderedBody[] = []
  const renderSlot: TaskDetailProps['renderSlot'] = ((_key: string, owner: object, opts?: { fallback?: unknown }) => {
    bodies.push({ owner: owner as InboxDetailBodyOwnerProps, opts })
    return (opts?.fallback ?? null) as React.ReactNode
  }) as never
  render(
    <TaskDetail
      sessionId={'session-1' as never}
      SessionProvider={(() => null) as never}
      useSession={neverHook} useProjection={neverHook}
      useInput={neverHook} inputActions={undefined as never}
      useSessions={neverHook} useWorkspaces={neverHook}
      useSelection={bindSnapshotSelector(createSnapshotStore<InboxSelection>(selection))}
      useDetail={bindSnapshotSelector(createSnapshotStore<TaskDetailState>(state))}
      retry={retry}
      renderSlot={renderSlot}
      t={t}
    />,
  )
  return { retry, bodies }
}

describe('TaskDetail', () => {
  it('renders the empty state for group and secondary-page selections', () => {
    for (const selection of [
      DEFAULT_SELECTION,
      { kind: 'agents' },
      { kind: 'settings' },
    ] as const) {
      cleanup()
      const { bodies } = mountDetail({ selection })
      expect(screen.getByRole('heading', { name: '任务详情' })).toBeTruthy()
      expect(screen.getByText('选择任务查看详情')).toBeTruthy()
      // No body slot render for non-task selections.
      expect(bodies).toEqual([])
    }
  })

  it('renders the body slot with a session view for a task selection', () => {
    const { bodies } = mountDetail({ selection: { kind: 'task', sessionId: 's1' as SessionId } })
    expect(screen.getByRole('heading', { name: '任务详情' })).toBeTruthy()
    // Empty slot: the owner's empty copy falls back.
    expect(screen.getByText('选择任务查看详情')).toBeTruthy()
    expect(bodies.map(body => body.owner.detail)).toEqual([{ kind: 'session', sessionId: 's1' }])
  })

  it('renders the empty state while the selected run has no ready data', () => {
    const { bodies } = mountDetail({ selection: { kind: 'run', runId: 'r1' }, state: detailState({ runId: 'r1', status: 'loading' }) })
    expect(screen.getByText('选择任务查看详情')).toBeTruthy()
    expect(bodies).toEqual([])
  })

  it('renders the empty state when the detail store answers a different run', () => {
    mountDetail({
      selection: { kind: 'run', runId: 'r1' },
      state: detailState({ runId: 'r2', status: 'ready', lineage: { run: run({ runId: 'r2' }), parent: undefined, children: [] }, timeline: [] }),
    })
    expect(screen.getByText('选择任务查看详情')).toBeTruthy()
    expect(screen.queryByText('close-the-books')).toBeNull()
  })

  it('renders the empty state when the lineage carries no run row (unknown runId)', () => {
    mountDetail({
      selection: { kind: 'run', runId: 'r1' },
      state: detailState({ runId: 'r1', status: 'ready', lineage: { run: undefined, parent: undefined, children: [] }, timeline: [] }),
    })
    expect(screen.getByText('选择任务查看详情')).toBeTruthy()
  })

  it('renders the empty state when a ready answer carries no lineage at all', () => {
    mountDetail({
      selection: { kind: 'run', runId: 'r1' },
      state: detailState({ runId: 'r1', status: 'ready' }),
    })
    expect(screen.getByText('选择任务查看详情')).toBeTruthy()
  })

  it('renders the run header with strict status copy and hands the body a run view', () => {
    const { bodies } = mountDetail({
      selection: { kind: 'run', runId: 'r1' },
      state: detailState({
        runId: 'r1',
        status: 'ready',
        lineage: { run: run({ outputJson: '{"total":3}' }), parent: undefined, children: [] },
        timeline: [],
      }),
    })
    expect(screen.getByRole('heading', { name: 'close-the-books' })).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    // Not failed: no retry affordance anywhere.
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    const detail = bodies[0]!.owner.detail
    expect(detail).toMatchObject({ kind: 'run', output: { total: 3 }, retry: undefined })
    expect(detail.kind === 'run' && detail.run.runId).toBe('r1')
  })

  it('renders each run status with its strict spec-05 copy', () => {
    const copy: Record<WireRun['status'], string> = {
      running: '进行中', waiting: '等待确认', done: '已完成', failed: '出错了', cancelled: '已取消',
    }
    for (const [status, text] of Object.entries(copy) as [WireRun['status'], string][]) {
      cleanup()
      mountDetail({
        selection: { kind: 'run', runId: 'r1' },
        state: detailState({ runId: 'r1', status: 'ready', lineage: { run: run({ status }), parent: undefined, children: [] }, timeline: [] }),
      })
      expect(screen.getByText(text)).toBeTruthy()
    }
  })

  it('shows 重试 only for a failed run, wired to the injected retry (header and owner view)', () => {
    const { retry, bodies } = mountDetail({
      selection: { kind: 'run', runId: 'r1' },
      state: detailState({ runId: 'r1', status: 'ready', lineage: { run: run({ status: 'failed' }), parent: undefined, children: [] }, timeline: [] }),
    })
    expect(screen.getByText('出错了')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledWith('r1')
    const detail = bodies[0]!.owner.detail
    expect(detail.kind).toBe('run')
    if (detail.kind === 'run') {
      expect(typeof detail.retry).toBe('function')
      detail.retry?.()
      expect(retry).toHaveBeenCalledTimes(2)
    }
  })

  it('projects output_json: null to undefined and non-JSON content to the raw string', () => {
    const stateFor = (outputJson: string | null): TaskDetailState => detailState({
      runId: 'r1', status: 'ready',
      lineage: { run: run({ outputJson }), parent: undefined, children: [] }, timeline: [],
    })
    const first = mountDetail({ selection: { kind: 'run', runId: 'r1' }, state: stateFor(null) })
    expect(first.bodies[0]!.owner.detail).toMatchObject({ output: undefined })
    cleanup()
    const second = mountDetail({ selection: { kind: 'run', runId: 'r1' }, state: stateFor('not json') })
    expect(second.bodies[0]!.owner.detail).toMatchObject({ output: 'not json' })
  })
})
