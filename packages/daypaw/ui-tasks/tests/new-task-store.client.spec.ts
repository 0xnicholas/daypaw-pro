/** NewTaskStore: roster load (healthy filter, default selection, latest-wins), submit guards, and the create→open→prompt sequence. */
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type SessionListState, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { NewTaskStore, type NewTaskBinding, type NewTaskSessions } from '../src/client/new-task-store.ts'
import { FakeTaskApi, fail, ok, preset } from './fake-task-api.client.ts'

function emptyList(): SnapshotStore<SessionListState> {
  return createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
}

/** A sessions-service fake: records open, stubs binding+prompt, and lists the created id on demand. */
function sessionsBench(opts: { binding?: boolean; promptOk?: boolean } = {}) {
  const list = emptyList()
  const opened: SessionId[] = []
  const prompt = vi.fn<NewTaskBinding['session']['prompt']>(() => Promise.resolve(
    opts.promptOk === false
      ? { ok: false as const, error: { code: 'internal' as const, message: 'busy', details: {} } }
      : { ok: true as const, value: { accepted: true as const } },
  ))
  const sessions: NewTaskSessions = {
    list,
    open: (id) => { opened.push(id) },
    binding: id => opts.binding === false
      ? undefined
      : { sessionId: id, session: { prompt } },
  }
  /** Put the created session into the list projection (the host frame's arrival). */
  const listSession = (id: SessionId): void => {
    list.update((draft) => {
      draft.ids.push(id)
      draft.byId[id] = { id, displayTitle: id, running: false, blank: true, updatedAt: 1 }
    })
  }
  return { list, opened, prompt, sessions, listSession }
}

async function readyStore(api: FakeTaskApi, sessions: NewTaskSessions): Promise<NewTaskStore> {
  const store = new NewTaskStore(api, sessions)
  await store.load()
  return store
}

describe('NewTaskStore roster', () => {
  it('loads healthy presets in roster order, preselecting the deployment default', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(ok({ presets: [
      preset('alpha'),
      preset('broken-one', { broken: 'mount failed' }),
      preset('beta', { name: 'Beta Agent', isDefault: true }),
    ], authorable: false, hasDocument: false }))
    const store = await readyStore(api, sessionsBench().sessions)
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    // The broken preset is filtered, not shown; the label falls back to the id.
    expect(state.agents).toEqual([
      { id: 'alpha', label: 'alpha', isDefault: false },
      { id: 'beta', label: 'Beta Agent', isDefault: true },
    ])
    expect(state.selected).toBe('beta')
  })

  it('preselects the first row when no preset is the default', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(ok({ presets: [preset('a'), preset('b')], authorable: false, hasDocument: false }))
    const store = await readyStore(api, sessionsBench().sessions)
    expect(store.store.getSnapshot().selected).toBe('a')
  })

  it('lands in error when the roster fetch fails', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(fail('host down'))
    const store = await readyStore(api, sessionsBench().sessions)
    expect(store.store.getSnapshot().status).toBe('error')
  })

  it('keeps the latest load when an older response lands late', async () => {
    const api = new FakeTaskApi()
    let release!: (value: unknown) => void
    const parked = new Promise<unknown>((resolve) => { release = resolve })
    api.onPresetList = () => parked as never
    const store = new NewTaskStore(api, sessionsBench().sessions)
    const stale = store.load()
    api.onPresetList = () => Promise.resolve(ok({ presets: [preset('fresh')], authorable: false, hasDocument: false }))
    await store.load()
    release(ok({ presets: [preset('stale')], authorable: false, hasDocument: false }))
    await stale
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.agents.map(agent => agent.id)).toEqual(['fresh'])
  })

  it('ignores a stale load failure landing after a newer load succeeded', async () => {
    const api = new FakeTaskApi()
    let reject!: (error: unknown) => void
    const parked = new Promise<unknown>((_resolve, rej) => { reject = rej })
    api.onPresetList = () => parked as never
    const store = new NewTaskStore(api, sessionsBench().sessions)
    const stale = store.load()
    api.onPresetList = () => Promise.resolve(ok({ presets: [preset('fresh')], authorable: false, hasDocument: false }))
    await store.load()
    reject(new Error('late failure'))
    await stale
    expect(store.store.getSnapshot().status).toBe('ready')
  })
})

describe('NewTaskStore submit', () => {
  async function submittingBench() {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(ok({ presets: [preset('alpha', { isDefault: true })], authorable: false, hasDocument: false }))
    const bench = sessionsBench()
    const store = await readyStore(api, bench.sessions)
    store.setText('  写一首诗  ')
    return { api, bench, store }
  }

  it('runs create → open → prompt and resets the draft on success', async () => {
    const { api, bench, store } = await submittingBench()
    bench.listSession('fx-new' as SessionId)
    const id = await store.submit()
    expect(id).toBe('fx-new')
    // The create payload carries the picked preset; the prompt carries the trimmed text.
    expect(api.callsOf('session.create')).toEqual([{ agentPreset: 'alpha' }])
    expect(bench.opened).toEqual(['fx-new'])
    expect(bench.prompt).toHaveBeenCalledWith([{ type: 'text', text: '写一首诗' }], 'queue')
    const state = store.store.getSnapshot()
    expect(state.submitting).toBe(false)
    expect(state.text).toBe('')
    expect(state.submitFailed).toBe(false)
  })

  it('waits for the list projection before opening when the frame lands late', async () => {
    const { bench, store } = await submittingBench()
    const pending = store.submit()
    // The create resolved but the row is not listed yet: nothing opened.
    await Promise.resolve()
    expect(bench.opened).toEqual([])
    // An unrelated list update does not release the wait.
    bench.listSession('fx-other' as SessionId)
    await Promise.resolve()
    expect(bench.opened).toEqual([])
    bench.listSession('fx-new' as SessionId)
    expect(await pending).toBe('fx-new')
    expect(bench.opened).toEqual(['fx-new'])
  })

  it('creates without a preset when the roster is empty', async () => {
    const api = new FakeTaskApi() // default roster: empty
    const bench = sessionsBench()
    const store = await readyStore(api, bench.sessions)
    store.setText('做点什么')
    bench.listSession('fx-new' as SessionId)
    expect(await store.submit()).toBe('fx-new')
    expect(api.callsOf('session.create')).toEqual([{}])
  })

  it('surfaces a create business failure inline and keeps the draft', async () => {
    const { api, bench, store } = await submittingBench()
    api.onCreate = () => Promise.resolve(fail('preset unknown'))
    expect(await store.submit()).toBeUndefined()
    const state = store.store.getSnapshot()
    expect(state.submitting).toBe(false)
    expect(state.submitFailed).toBe(true)
    expect(state.text).toBe('  写一首诗  ')
    expect(bench.opened).toEqual([])
  })

  it('flags a non-Error wire rejection as an inline failure', async () => {
    const { api, store } = await submittingBench()
    // Transport-layer rejections can carry arbitrary values.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    api.onCreate = () => Promise.reject('wire exploded')
    expect(await store.submit()).toBeUndefined()
    expect(store.store.getSnapshot().submitFailed).toBe(true)
  })

  it('surfaces a prompt failure inline after the session opened', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(ok({ presets: [preset('alpha')], authorable: false, hasDocument: false }))
    const bench = sessionsBench({ promptOk: false })
    const store = await readyStore(api, bench.sessions)
    store.setText('x')
    bench.listSession('fx-new' as SessionId)
    expect(await store.submit()).toBeUndefined()
    expect(bench.opened).toEqual(['fx-new'])
    expect(store.store.getSnapshot().submitFailed).toBe(true)
  })

  it('flags an inline failure when the created session resolves no binding', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(ok({ presets: [preset('alpha')], authorable: false, hasDocument: false }))
    const bench = sessionsBench({ binding: false })
    const store = await readyStore(api, bench.sessions)
    store.setText('x')
    bench.listSession('fx-new' as SessionId)
    expect(await store.submit()).toBeUndefined()
    expect(store.store.getSnapshot().submitFailed).toBe(true)
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
    expect(api.callsOf('session.create')).toEqual([])
  })

  it('rejects a second submit while one is in flight', async () => {
    const { api, bench, store } = await submittingBench()
    let release!: (value: unknown) => void
    api.onCreate = () => new Promise((resolve) => { release = resolve }) as never
    const first = store.submit()
    expect(await store.submit()).toBeUndefined()
    release(ok({ sessionId: 'fx-new' as SessionId }))
    bench.listSession('fx-new' as SessionId)
    expect(await first).toBe('fx-new')
    expect(api.callsOf('session.create')).toHaveLength(1)
  })
})
