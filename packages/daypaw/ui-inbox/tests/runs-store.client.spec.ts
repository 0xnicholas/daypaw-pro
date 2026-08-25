/** RunsBoardStore (poll lifecycle, latest-wins, error-keeps-polling, refresh) and TaskDetailStore (select/latest-wins/refresh). */
import { describe, expect, it, vi } from 'vitest'
import type { RunsApi, WireJournalEntry, WireRun, WireRunLineage } from '../src/client/runs-api.ts'
import { RUNS_BOARD_POLL_MS, RunsBoardStore, TaskDetailStore } from '../src/client/runs-store.ts'

const RUN: WireRun = {
  runId: 'r1',
  defKind: 'workflow',
  defName: 'close-the-books',
  status: 'running',
  parentRunId: null,
  outputJson: null,
  updatedAt: 100,
}
const OTHER: WireRun = { ...RUN, runId: 'r2', status: 'done', updatedAt: 200 }

const LINEAGE: WireRunLineage = { run: RUN, parent: undefined, children: [] }
const TIMELINE: readonly WireJournalEntry[] = [{
  stepKey: 's1', name: 'collect', occurrence: 1, kind: 'step', status: 'completed',
  sessionId: null, startedAt: 10, finishedAt: 20,
}]

function apiOf(runs: readonly WireRun[] = []): RunsApi {
  return {
    listRuns: () => Promise.resolve([...runs]),
    runLineage: () => Promise.resolve(LINEAGE),
    journalTimeline: () => Promise.resolve([...TIMELINE]),
    rerun: () => Promise.resolve('r9'),
  }
}

/** Controllable interval driver: callbacks queue until ticked. */
function fakeTimers() {
  const callbacks: (() => void)[] = []
  const cleared: unknown[] = []
  const setIntervalFn = (fn: () => void): unknown => {
    callbacks.push(fn)
    return fn
  }
  const clearIntervalFn = (timer: unknown): void => {
    cleared.push(timer)
    const index = callbacks.indexOf(timer as () => void)
    if (index >= 0) callbacks.splice(index, 1)
  }
  const tick = (): void => { callbacks.forEach((fn) => { fn() }) }
  return { callbacks, cleared, setIntervalFn, clearIntervalFn, tick }
}

async function flush(): Promise<void> {
  // Let the fetch microtask chains settle (each fetch awaits its api call).
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('RunsBoardStore', () => {
  it('starts idle, fetches immediately on start, then polls on the interval', async () => {
    const timers = fakeTimers()
    const api = { ...apiOf([RUN]), listRuns: vi.fn((): Promise<WireRun[]> => Promise.resolve([RUN])) }
    const board = new RunsBoardStore({ api, ...timers })
    expect(board.store.getSnapshot()).toEqual({ status: 'idle', runs: [] })
    board.start()
    await flush()
    expect(board.store.getSnapshot()).toEqual({ status: 'ready', runs: [RUN] })
    expect(api.listRuns).toHaveBeenCalledTimes(1)
    timers.tick()
    await flush()
    expect(api.listRuns).toHaveBeenCalledTimes(2)
  })

  it('defaults to the product poll cadence when no intervalMs is given', async () => {
    const timers = fakeTimers()
    const calls: number[] = []
    const api = apiOf()
    const board = new RunsBoardStore({
      api,
      setIntervalFn: (fn: () => void, ms: number) => { calls.push(ms); return timers.setIntervalFn(fn) },
      clearIntervalFn: timers.clearIntervalFn,
    })
    board.start()
    expect(calls).toEqual([RUNS_BOARD_POLL_MS])
    board.stop()
  })

  it('defaults to the platform timers when none are injected', async () => {
    const board = new RunsBoardStore({ api: apiOf(), intervalMs: 5 })
    board.start()
    await flush()
    expect(board.store.getSnapshot().status).toBe('ready')
    board.stop()
  })

  it('stop clears the poll and no further fetch happens', async () => {
    const timers = fakeTimers()
    const api = { ...apiOf(), listRuns: vi.fn((): Promise<WireRun[]> => Promise.resolve([])) }
    const board = new RunsBoardStore({ api, ...timers })
    board.start()
    await flush()
    board.stop()
    timers.tick()
    await flush()
    expect(api.listRuns).toHaveBeenCalledTimes(1)
  })

  it('a failed fetch lands in error and the poll keeps running and recovers', async () => {
    const timers = fakeTimers()
    const listRuns = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([RUN])
    const board = new RunsBoardStore({ api: { ...apiOf(), listRuns }, ...timers })
    board.start()
    await flush()
    expect(board.store.getSnapshot()).toEqual({ status: 'error', runs: [] })
    timers.tick()
    await flush()
    expect(listRuns).toHaveBeenCalledTimes(2)
    expect(board.store.getSnapshot()).toEqual({ status: 'ready', runs: [RUN] })
  })

  it('keeps the newest fetch: a stale response never overwrites a newer one', async () => {
    let resolveFirst!: (value: WireRun[]) => void
    const first = new Promise<WireRun[]>((resolve) => { resolveFirst = resolve })
    const listRuns = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve([OTHER]))
    const board = new RunsBoardStore({ api: { ...apiOf(), listRuns } })
    const stale = board.refresh()
    const fresh = board.refresh()
    resolveFirst([RUN])
    await Promise.all([stale, fresh])
    expect(board.store.getSnapshot().runs).toEqual([OTHER])
  })

  it('keeps the newest fetch: a stale rejection never overwrites a ready board', async () => {
    let rejectFirst!: (error: Error) => void
    const first = new Promise<WireRun[]>((_resolve, reject) => { rejectFirst = reject })
    const listRuns = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve([OTHER]))
    const board = new RunsBoardStore({ api: { ...apiOf(), listRuns } })
    const stale = board.refresh()
    const fresh = board.refresh()
    rejectFirst(new Error('boom'))
    await Promise.all([stale, fresh])
    expect(board.store.getSnapshot()).toEqual({ status: 'ready', runs: [OTHER] })
  })

  it('refresh forces an out-of-band refetch without the interval', async () => {
    const timers = fakeTimers()
    const listRuns = vi.fn().mockResolvedValue([RUN])
    const board = new RunsBoardStore({ api: { ...apiOf(), listRuns }, ...timers })
    await board.refresh()
    expect(listRuns).toHaveBeenCalledTimes(1)
    expect(board.store.getSnapshot().status).toBe('ready')
    expect(timers.callbacks).toHaveLength(0)
  })
})

describe('TaskDetailStore', () => {
  it('starts idle with no selection', () => {
    const detail = new TaskDetailStore({ api: apiOf() })
    expect(detail.store.getSnapshot()).toEqual({ runId: undefined, status: 'idle', lineage: undefined, timeline: undefined })
  })

  it('select fetches lineage and timeline together and lands ready', async () => {
    const detail = new TaskDetailStore({ api: apiOf() })
    await detail.select('r1')
    expect(detail.store.getSnapshot()).toEqual({ runId: 'r1', status: 'ready', lineage: LINEAGE, timeline: TIMELINE })
  })

  it('select(undefined) clears back to idle without fetching', async () => {
    const api = { ...apiOf(), runLineage: vi.fn((): Promise<WireRunLineage> => Promise.resolve(LINEAGE)) }
    const detail = new TaskDetailStore({ api })
    await detail.select('r1')
    await detail.select(undefined)
    expect(detail.store.getSnapshot()).toEqual({ runId: undefined, status: 'idle', lineage: undefined, timeline: undefined })
    expect(api.runLineage).toHaveBeenCalledTimes(1)
  })

  it('a failed select lands in error', async () => {
    const detail = new TaskDetailStore({
      api: { ...apiOf(), runLineage: () => Promise.reject(new Error('boom')) },
    })
    await detail.select('r1')
    expect(detail.store.getSnapshot()).toEqual({ runId: 'r1', status: 'error', lineage: undefined, timeline: undefined })
  })

  it('keeps the newest selection: a stale response never overwrites it', async () => {
    let resolveFirst!: (value: WireRunLineage) => void
    const first = new Promise<WireRunLineage>((resolve) => { resolveFirst = resolve })
    const runLineage = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve({ ...LINEAGE, run: OTHER }))
    const detail = new TaskDetailStore({ api: { ...apiOf(), runLineage } })
    const stale = detail.select('r1')
    const fresh = detail.select('r2')
    resolveFirst(LINEAGE)
    await Promise.all([stale, fresh])
    expect(detail.store.getSnapshot()).toEqual({
      runId: 'r2', status: 'ready', lineage: { ...LINEAGE, run: OTHER }, timeline: TIMELINE,
    })
  })

  it('keeps the newest selection: a stale rejection never lands an error', async () => {
    let rejectFirst!: (error: Error) => void
    const first = new Promise<WireRunLineage>((_resolve, reject) => { rejectFirst = reject })
    const runLineage = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve(LINEAGE))
    const detail = new TaskDetailStore({ api: { ...apiOf(), runLineage } })
    const stale = detail.select('r1')
    const fresh = detail.select('r2')
    rejectFirst(new Error('boom'))
    await Promise.all([stale, fresh])
    expect(detail.store.getSnapshot().status).toBe('ready')
    expect(detail.store.getSnapshot().runId).toBe('r2')
  })

  it('re-selecting the same run while loading fetches again without leaving loading', async () => {
    const api = { ...apiOf(), runLineage: vi.fn((): Promise<WireRunLineage> => Promise.resolve(LINEAGE)) }
    const detail = new TaskDetailStore({ api })
    const first = detail.select('r1')
    const second = detail.select('r1')
    expect(detail.store.getSnapshot().status).toBe('loading')
    await Promise.all([first, second])
    expect(api.runLineage).toHaveBeenCalledTimes(2)
    expect(detail.store.getSnapshot().status).toBe('ready')
  })

  it('refresh re-fetches the current selection and no-ops without one', async () => {
    const api = { ...apiOf(), runLineage: vi.fn((): Promise<WireRunLineage> => Promise.resolve(LINEAGE)) }
    const detail = new TaskDetailStore({ api })
    await detail.refresh()
    expect(api.runLineage).not.toHaveBeenCalled()
    await detail.select('r1')
    await detail.refresh()
    expect(api.runLineage).toHaveBeenCalledTimes(2)
    expect(detail.store.getSnapshot().status).toBe('ready')
  })

  it('a superseded refresh never overwrites a newer selection', async () => {
    let resolveRefresh!: (value: WireRunLineage) => void
    const second = new Promise<WireRunLineage>((resolve) => { resolveRefresh = resolve })
    const runLineage = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(LINEAGE))
      .mockImplementationOnce(() => second)
      .mockImplementationOnce(() => Promise.resolve({ ...LINEAGE, run: OTHER }))
    const detail = new TaskDetailStore({ api: { ...apiOf(), runLineage } })
    await detail.select('r1')
    const stale = detail.refresh()
    const fresh = detail.select('r2')
    resolveRefresh(LINEAGE)
    await Promise.all([stale, fresh])
    expect(detail.store.getSnapshot().runId).toBe('r2')
    expect(detail.store.getSnapshot().lineage?.run).toEqual(OTHER)
  })
})
