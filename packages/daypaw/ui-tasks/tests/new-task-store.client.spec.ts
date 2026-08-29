/**
 * NewTaskStore: roster load (agent filter, business labels, latest-wins), submit guards, the
 * startRun→twin-wait sequence, and the minted-runId retry identity.
 */
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { NewTaskStore, type NewTaskSessions } from '../src/client/new-task-store.ts'
import type { WireStartRunRequest } from '../src/client/new-task-api.ts'
import { FakeTaskApi, fail, ok, definition } from './fake-task-api.client.ts'

function emptyList(): SnapshotStore<SessionListState> {
  return createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
}

/** A sessions-service fake: the list projection the twin wait polls. */
function sessionsBench() {
  const list = emptyList()
  const sessions: NewTaskSessions = { list }
  /** Put one session into the list projection (the host frame's arrival). */
  const listSession = (id: SessionId): void => {
    list.update((draft) => {
      draft.ids.push(id)
      draft.byId[id] = { id, displayTitle: id, running: false, blank: true, updatedAt: 1 }
    })
  }
  return { sessions, listSession }
}

async function readyStore(api: FakeTaskApi, sessions: NewTaskSessions): Promise<NewTaskStore> {
  const store = new NewTaskStore(api, sessions)
  await store.load()
  return store
}

/** The single startRun payload recorded so far (tests always drive exactly one or assert counts). */
function startedPayload(api: FakeTaskApi, index = 0): WireStartRunRequest {
  return api.callsOf('durable/startRun')[index] as WireStartRunRequest
}

describe('NewTaskStore roster', () => {
  it('loads agent definitions in registration order, labeling from the display title', async () => {
    const api = new FakeTaskApi()
    api.onListDefinitions = () => Promise.resolve(ok([
      definition('alpha', { version: '2.1.0' }),
      definition('workflow-row', { kind: 'workflow' }),
      definition('beta', { version: '0.3.1', display: { title: '周报助手' }, inputKind: 'json' }),
    ]))
    const store = await readyStore(api, sessionsBench().sessions)
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    // The workflow row never rosters; the label falls back to the technical name.
    expect(state.agents).toEqual([
      { id: 'alpha@2.1.0', label: 'alpha', inputKind: 'text' },
      { id: 'beta@0.3.1', label: '周报助手', inputKind: 'json' },
    ])
    expect(state.selected).toBe('alpha@2.1.0')
  })

  it('lands in error when the roster fetch fails', async () => {
    const api = new FakeTaskApi()
    api.onListDefinitions = () => Promise.resolve(fail('host down'))
    const store = await readyStore(api, sessionsBench().sessions)
    expect(store.store.getSnapshot().status).toBe('error')
  })

  it('keeps the latest load when an older response lands late', async () => {
    const api = new FakeTaskApi()
    let release!: (value: unknown) => void
    const parked = new Promise<unknown>((resolve) => { release = resolve })
    api.onListDefinitions = () => parked as never
    const store = new NewTaskStore(api, sessionsBench().sessions)
    const stale = store.load()
    api.onListDefinitions = () => Promise.resolve(ok([definition('fresh')]))
    await store.load()
    release(ok([definition('stale')]))
    await stale
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.agents.map(agent => agent.id)).toEqual(['fresh@1'])
  })

  it('ignores a stale load failure landing after a newer load succeeded', async () => {
    const api = new FakeTaskApi()
    let reject!: (error: unknown) => void
    const parked = new Promise<unknown>((_resolve, rej) => { reject = rej })
    api.onListDefinitions = () => parked as never
    const store = new NewTaskStore(api, sessionsBench().sessions)
    const stale = store.load()
    api.onListDefinitions = () => Promise.resolve(ok([definition('fresh')]))
    await store.load()
    reject(new Error('late failure'))
    await stale
    expect(store.store.getSnapshot().status).toBe('ready')
  })
})

describe('NewTaskStore submit', () => {
  async function submittingBench(inputKind: 'text' | 'json' = 'text') {
    const api = new FakeTaskApi()
    api.onListDefinitions = () => Promise.resolve(ok([
      definition('starter-assistant', { version: '1.0.0', display: { title: 'Starter assistant' }, inputKind }),
    ]))
    const bench = sessionsBench()
    const store = await readyStore(api, bench.sessions)
    if (inputKind === 'text') store.setText('  写一首诗  ')
    else store.setJson('{"task":"写一首诗"}')
    return { api, bench, store }
  }

  it('starts the run, waits for the session twin, and resets the draft on success', async () => {
    const { api, bench, store } = await submittingBench()
    const pending = store.submit()
    // The start resolved but the twin is not listed yet: the submit parks on
    // the list subscription (microtasks settle before the macrotask).
    await vi.waitFor(() => { expect(api.callsOf('durable/startRun')).toHaveLength(1) })
    const payload = startedPayload(api)
    expect(payload.defName).toBe('starter-assistant')
    expect(payload.defVersion).toBe('1.0.0')
    expect(payload.input).toBe('写一首诗')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(store.store.getSnapshot().submitting).toBe(true)
    // An unrelated list update wakes the subscription but does not release it.
    bench.listSession('fx-other' as SessionId)
    expect(store.store.getSnapshot().submitting).toBe(true)
    const runId = payload.runId
    bench.listSession(runId as SessionId)
    expect(await pending).toBe(runId)
    const state = store.store.getSnapshot()
    expect(state.submitting).toBe(false)
    expect(state.text).toBe('')
    expect(state.submitFailed).toBe(false)
  })

  it('rejects the submit when no agent is selected (empty roster)', async () => {
    const api = new FakeTaskApi() // default roster: empty, load still succeeds
    const bench = sessionsBench()
    const store = await readyStore(api, bench.sessions)
    store.setText('写点什么')
    expect(await store.submit()).toBeUndefined()
    expect(api.callsOf('durable/startRun')).toEqual([])
  })

  it('keeps the minted run id across a failed submit so the retry attaches', async () => {
    const { api, bench, store } = await submittingBench()
    api.onStartRun = () => Promise.resolve(fail('engine down'))
    expect(await store.submit()).toBeUndefined()
    expect(store.store.getSnapshot().submitFailed).toBe(true)
    expect(store.store.getSnapshot().text).toBe('  写一首诗  ')
    // The retry carries the same run id: start-or-attach lands on the same run.
    api.onStartRun = request => Promise.resolve(ok({ runId: request.runId }))
    const pending = store.submit()
    const second = startedPayload(api, 1)
    expect(second.runId).toBe(startedPayload(api).runId)
    bench.listSession(second.runId as SessionId)
    expect(await pending).toBe(second.runId)
    // A fresh task after success mints a fresh id.
    store.setText('下一件事')
    const third = store.submit()
    bench.listSession(startedPayload(api, 2).runId as SessionId)
    await third
    expect(startedPayload(api, 2).runId).not.toBe(second.runId)
  })

  it('flags a non-Error wire rejection as an inline failure', async () => {
    const api = new FakeTaskApi()
    api.onListDefinitions = () => Promise.resolve(ok([definition('alpha')]))
    // Transport-layer rejections can carry arbitrary values.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    api.startRun = () => Promise.reject('wire exploded')
    const store = await readyStore(api, sessionsBench().sessions)
    store.setText('x')
    expect(await store.submit()).toBeUndefined()
    expect(store.store.getSnapshot().submitFailed).toBe(true)
  })

  it('retires the submit at the twin-wait bound, keeping the run id for an attaching retry', async () => {
    const api = new FakeTaskApi()
    api.onListDefinitions = () => Promise.resolve(ok([definition('starter-assistant', { version: '1.0.0' })]))
    const bench = sessionsBench()
    let fireTimer: (() => void) | undefined
    const store = new NewTaskStore(api, bench.sessions, {
      setTimeoutFn: (fn) => {
        fireTimer = fn
        return 1
      },
      clearTimeoutFn: () => {},
    })
    await store.load()
    store.setText('写一首诗')
    const pending = store.submit()
    await vi.waitFor(() => { expect(fireTimer).toBeDefined() })
    // The bound fires with no twin in sight: the inline failure lands and the
    // minted id survives for the retry.
    fireTimer!()
    expect(await pending).toBeUndefined()
    expect(store.store.getSnapshot().submitFailed).toBe(true)
    const second = store.submit()
    const retryPayload = startedPayload(api, 1)
    expect(retryPayload.runId).toBe(startedPayload(api).runId)
    bench.listSession(retryPayload.runId as SessionId)
    await second
  })

  it('rejects guarded submits without touching the wire', async () => {
    const { api, store } = await submittingBench()
    // Blank text.
    store.setText('   ')
    expect(await store.submit()).toBeUndefined()
    // Roster not ready.
    const idle = new NewTaskStore(api, sessionsBench().sessions)
    idle.setText('x')
    expect(await idle.submit()).toBeUndefined()
    expect(api.callsOf('durable/startRun')).toEqual([])
  })

  it('rejects a second submit while one is in flight', async () => {
    const { api, bench, store } = await submittingBench()
    let release!: (value: unknown) => void
    api.onStartRun = () => new Promise((resolve) => { release = resolve }) as never
    const first = store.submit()
    expect(await store.submit()).toBeUndefined()
    release(ok({ runId: startedPayload(api).runId }))
    bench.listSession(startedPayload(api).runId as SessionId)
    await first
    expect(api.callsOf('durable/startRun')).toHaveLength(1)
  })

  it('sends the parsed JSON draft for a json-kind agent and guards malformed JSON', async () => {
    const { api, bench, store } = await submittingBench('json')
    // Malformed JSON never reaches the wire.
    store.setJson('{oops')
    expect(await store.submit()).toBeUndefined()
    expect(api.callsOf('durable/startRun')).toEqual([])
    store.setJson('{"objective":"本周周报"}')
    const pending = store.submit()
    bench.listSession(startedPayload(api).runId as SessionId)
    await pending
    expect(startedPayload(api).input).toEqual({ objective: '本周周报' })
    expect(store.store.getSnapshot().json).toBe('')
  })
})
