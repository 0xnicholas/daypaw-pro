/** Apply wiring: three columns, shared selection, engine-fed board/detail stores, retry dispatch, shadowing, teardown. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNodeHalf } from '../src/index.ts'
import type { InboxNavInjected } from '../src/client/InboxNav.tsx'
import type { WorkspaceSwitchInjected } from '../src/client/WorkspaceSwitch.tsx'
import type { TaskDetailInjected } from '../src/client/TaskDetail.tsx'

const WIRE_RUN = {
  run_id: 'r1',
  def_kind: 'agent',
  def_name: 'fix-tests',
  status: 'running',
  parent_run_id: null,
  output_json: null,
  updated_at: 100,
}

/** An RPC caller answering the engine's durable/* endpoints. */
function fakeRpc() {
  const calls: string[] = []
  // Widened signature: per-test mockImplementation overrides answer different
  // payload unions, so the mock's declared type must cover them all.
  const call = vi.fn<(channel: string, endpoint: string, payload: unknown) => Promise<unknown>>(
    (channel: string, endpoint: string, payload: unknown) => {
      calls.push(endpoint)
      expect(channel).toBe('/api')
      switch (endpoint) {
        case 'durable/listRuns': return Promise.resolve({ ok: true, value: [WIRE_RUN] })
        case 'durable/runLineage': return Promise.resolve({ ok: true, value: { run: WIRE_RUN, parent: null, children: [] } })
        case 'durable/journalTimeline': return Promise.resolve({ ok: true, value: [] })
        case 'durable/rerun': return Promise.resolve({ ok: true, value: 'r9' })
        default: return Promise.resolve({ ok: false, error: { code: 'internal', message: `unexpected ${endpoint} ${JSON.stringify(payload)}`, details: {} } })
      }
    },
  )
  return { call, calls }
}

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleSidebar: vi.fn() }
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const sessions = { open: vi.fn() }
  ctx.provide('sessions', sessions as never)
  const rpc = fakeRpc()
  ctx.provide('connection', { rpc } as never)
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    // The frame's declarations, as ui-layout's root registration makes them.
    slots.register(
      {
        name: 'root',
        children: {
          'sidebar': { kind: 'single', scope: 'root' },
          'conversation': { kind: 'single', scope: 'session-maybe' },
          'details': { kind: 'single', scope: 'session' },
        },
      } as never,
      () => null,
    )
  }
  return { ctx, slots, layout, sessions, rpc }
}

/** Let the stores' fetch microtask chains settle. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** The inject faces of the three shadow occupants. */
function faces(b: Awaited<ReturnType<typeof bench>>) {
  const navFace = (b.slots.entries('sidebar')[0]!.inject as unknown as () => InboxNavInjected)()
  const workspaceEntry = b.slots.entries('conversation').find(e => e.options.priority === -1)!
  const workspaceFace = (workspaceEntry.inject as unknown as () => WorkspaceSwitchInjected)()
  const detailEntry = b.slots.entries('details').find(e => e.options.priority === -1)!
  const detailFace = (detailEntry.inject as unknown as () => TaskDetailInjected)()
  return { navFace, workspaceFace, detailFace }
}

describe('ui-inbox apply', () => {
  afterEach(() => { vi.useRealTimers() })

  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale', 'sessions', 'connection'])
  })

  it('the node half provides no host-side behavior', () => {
    applyNodeHalf()
  })

  it('occupies the three columns, shadowing the priority-0 placeholder occupants', async () => {
    const b = await bench()
    // Placeholder occupants at the default priority, as ui-conversation registers them.
    b.slots.register({ name: 'conversation' } as never, () => null)
    b.slots.register({ name: 'details' } as never, () => null)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar')).toHaveLength(1)
    expect(b.slots.entries('conversation')).toHaveLength(2)
    expect(b.slots.entries('details')).toHaveLength(2)
    // Lowest live priority renders: the -1 occupants win both cells.
    expect(b.slots.entriesOfSlot('conversation')[0]?.options.priority).toBe(-1)
    expect(b.slots.entriesOfSlot('details')[0]?.options.priority).toBe(-1)
    // The nav occupant declares the new-task dialog hole it renders.
    const navEntry = b.slots.entriesOfSlot('sidebar')[0]!
    expect(Object.keys(navEntry.children ?? {})).toEqual(['inbox.new-task.dialog'])
    expect(b.slots.snapshot('inbox.new-task.dialog')).toMatchObject([{ kind: 'single', scope: 'root' }])
    // The workspace occupant declares the five child holes it renders.
    const workspaceEntry = b.slots.entriesOfSlot('conversation')[0]!
    expect(Object.keys(workspaceEntry.children ?? {})).toEqual([
      'inbox.workspace.banner', 'inbox.settings.page', 'inbox.agents.page', 'inbox.workspace.tasks', 'inbox.workspace.conversation',
    ])
    expect(b.slots.snapshot('inbox.workspace.banner')).toMatchObject([{ kind: 'list', scope: 'session-maybe' }])
    expect(b.slots.snapshot('inbox.settings.page')).toMatchObject([{ kind: 'single', scope: 'session-maybe' }])
    expect(b.slots.snapshot('inbox.agents.page')).toMatchObject([{ kind: 'single', scope: 'session-maybe' }])
    expect(b.slots.snapshot('inbox.workspace.tasks')).toMatchObject([{ kind: 'single', scope: 'root' }])
    expect(b.slots.snapshot('inbox.workspace.conversation')).toMatchObject([{ kind: 'single', scope: 'session-maybe' }])
    // The detail occupant declares the detail body hole it renders.
    const detailEntry = b.slots.entriesOfSlot('details')[0]!
    expect(Object.keys(detailEntry.children ?? {})).toEqual(['inbox.detail.body'])
    expect(b.slots.snapshot('inbox.detail.body')).toMatchObject([{ kind: 'single', scope: 'session' }])
    // Copy rides the standard locale seat on our three occupants (the
    // placeholder dummies above carry none).
    expect(b.slots.entries('sidebar')[0]?.locale).toBe('inbox')
    expect(b.slots.entriesOfSlot('conversation')[0]?.locale).toBe('inbox')
    expect(b.slots.entriesOfSlot('details')[0]?.locale).toBe('inbox')
  })

  it('shares one selection source and one board source across the three inject faces', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { navFace, workspaceFace, detailFace } = faces(b)
    expect(navFace.hooks.selection).toBe(workspaceFace.hooks.selection)
    expect(workspaceFace.hooks.selection).toBe(detailFace.hooks.selection)
    expect(navFace.hooks.board).toBe(workspaceFace.hooks.board)
    expect(navFace.hooks.selection.getSnapshot()).toEqual({ kind: 'group', group: 'running' })
    navFace.select({ kind: 'agents' })
    expect(workspaceFace.hooks.selection.getSnapshot()).toEqual({ kind: 'agents' })
    // The workspace inject face carries the same selector for its slot owners.
    workspaceFace.select({ kind: 'settings' })
    expect(navFace.hooks.selection.getSnapshot()).toEqual({ kind: 'settings' })
    navFace.toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('drives the runtime current session one-way when a task is selected', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { navFace } = faces(b)
    navFace.select({ kind: 'task', sessionId: 's1' as SessionId })
    expect(navFace.hooks.selection.getSnapshot()).toEqual({ kind: 'task', sessionId: 's1' })
    expect(b.sessions.open).toHaveBeenCalledWith('s1')
    // Group, run, and page selections never touch the runtime current session.
    navFace.select({ kind: 'run', runId: 'r1' })
    navFace.select({ kind: 'group', group: 'done' })
    navFace.select({ kind: 'settings' })
    expect(b.sessions.open).toHaveBeenCalledTimes(1)
  })

  it('starts the board poll on apply and binds the detail store to run selections', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await flush()
    const { navFace, detailFace } = faces(b)
    // The immediate board fetch landed.
    expect(navFace.hooks.board.getSnapshot()).toMatchObject({
      status: 'ready',
      runs: [{ runId: 'r1', defKind: 'agent', defName: 'fix-tests', status: 'running', parentRunId: null, outputJson: null, updatedAt: 100 }],
    })
    expect(detailFace.hooks.detail.getSnapshot()).toMatchObject({ runId: undefined, status: 'idle' })
    // Selecting a session-less run binds the detail column to it.
    navFace.select({ kind: 'run', runId: 'r1' })
    await flush()
    expect(detailFace.hooks.detail.getSnapshot()).toMatchObject({
      runId: 'r1',
      status: 'ready',
      lineage: { run: { runId: 'r1' }, parent: undefined, children: [] },
      timeline: [],
    })
    // A task selection clears the detail column (its detail rides the session seat).
    navFace.select({ kind: 'task', sessionId: 's1' as SessionId })
    await flush()
    expect(detailFace.hooks.detail.getSnapshot()).toMatchObject({ runId: undefined, status: 'idle' })
  })

  it('refreshes the selected run detail on board ticks that move the run list', async () => {
    vi.useFakeTimers()
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { navFace, detailFace } = faces(b)
    navFace.select({ kind: 'run', runId: 'r1' })
    await vi.advanceTimersByTimeAsync(0)
    const lineageCalls = (): number => b.rpc.calls.filter(endpoint => endpoint === 'durable/runLineage').length
    expect(lineageCalls()).toBe(1)
    // One poll tick: the list moved (fresh array each answer), so the detail refetches.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(b.rpc.calls.filter(endpoint => endpoint === 'durable/listRuns').length).toBe(2)
    expect(lineageCalls()).toBe(2)
    expect(detailFace.hooks.detail.getSnapshot().status).toBe('ready')
  })

  it('retries a failed run through the injected dispatcher: selects the running group and kicks the board', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await flush()
    const { navFace, detailFace } = faces(b)
    const listCalls = (): number => b.rpc.calls.filter(endpoint => endpoint === 'durable/listRuns').length
    const before = listCalls()
    detailFace.retry('r1')
    await flush()
    expect(b.rpc.calls).toContain('durable/rerun')
    expect(navFace.hooks.selection.getSnapshot()).toEqual({ kind: 'group', group: 'running' })
    expect(listCalls()).toBe(before + 1)
  })

  it('surfaces a failed retry through the detail store error status, keeping the selection', async () => {
    const b = await bench()
    b.rpc.call.mockImplementation((_channel: string, endpoint: string) => {
      if (endpoint === 'durable/rerun') {
        return Promise.resolve({ ok: false, error: { code: 'internal', message: 'cannot rerun', details: {} } })
      }
      if (endpoint === 'durable/listRuns') return Promise.resolve({ ok: true, value: [] })
      return Promise.resolve({ ok: true, value: endpoint === 'durable/runLineage' ? { run: null, parent: null, children: [] } : [] })
    })
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { navFace, detailFace } = faces(b)
    navFace.select({ kind: 'run', runId: 'r1' })
    await flush()
    detailFace.retry('r1')
    await flush()
    expect(detailFace.hooks.detail.getSnapshot()).toMatchObject({ runId: 'r1', status: 'error' })
    expect(navFace.hooks.selection.getSnapshot()).toEqual({ kind: 'run', runId: 'r1' })
  })

  it('never rebinds the detail store when an equal selection is re-published', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { navFace } = faces(b)
    navFace.select({ kind: 'run', runId: 'r1' })
    await flush()
    const lineageCalls = (): number => b.rpc.calls.filter(endpoint => endpoint === 'durable/runLineage').length
    expect(lineageCalls()).toBe(1)
    // Clicking the selected row again re-publishes an equal selection: no refetch.
    navFace.select({ kind: 'run', runId: 'r1' })
    await flush()
    expect(lineageCalls()).toBe(1)
  })

  it('lands the board in error when the ledger fetch fails and keeps the detail column untouched', async () => {
    const b = await bench()
    b.rpc.call.mockImplementation((_channel: string, endpoint: string) => {
      if (endpoint === 'durable/listRuns') return Promise.resolve({ ok: false, error: { code: 'internal', message: 'ledger down', details: {} } })
      return Promise.resolve({ ok: true, value: endpoint === 'durable/runLineage' ? { run: null, parent: null, children: [] } : [] })
    })
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await flush()
    const { navFace, detailFace } = faces(b)
    expect(navFace.hooks.board.getSnapshot()).toEqual({ status: 'error', runs: [] })
    expect(detailFace.hooks.detail.getSnapshot().status).toBe('idle')
  })

  it('fails when no live owner declared the frame slots', async () => {
    const b = await bench(false)
    await expect(b.ctx.plugin({ inject: [...inject], apply })).rejects.toThrow(/not declared/)
  })

  it('removes every entry, stops the poll, and collapses the declared child slots on teardown', async () => {
    vi.useFakeTimers()
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.advanceTimersByTimeAsync(0)
    await fiber.dispose()
    expect(b.slots.entries('sidebar')).toHaveLength(0)
    expect(b.slots.entries('conversation')).toHaveLength(0)
    expect(b.slots.entries('details')).toHaveLength(0)
    expect(b.slots.snapshot('inbox.new-task.dialog')).toEqual([])
    expect(b.slots.snapshot('inbox.workspace.banner')).toEqual([])
    expect(b.slots.snapshot('inbox.settings.page')).toEqual([])
    expect(b.slots.snapshot('inbox.workspace.tasks')).toEqual([])
    expect(b.slots.snapshot('inbox.workspace.conversation')).toEqual([])
    expect(b.slots.snapshot('inbox.detail.body')).toEqual([])
    // The poll stopped with the fiber: no further listRuns calls.
    const listCalls = b.rpc.calls.filter(endpoint => endpoint === 'durable/listRuns').length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(b.rpc.calls.filter(endpoint => endpoint === 'durable/listRuns').length).toBe(listCalls)
  })
})
