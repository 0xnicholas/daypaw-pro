/** AboutStore: the observable host facts, the diagnostics text assembly, latest-wins generations, and lazy refresh. */
import { describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { AboutStore, diagnosticsText, type HostFacts } from '../src/client/about-store.ts'
import { refreshIfLoaded } from '../src/client/lazy-refresh.ts'
import { FakeHostApi, deferred, fail, ok, type FakeModelCatalog, type Result } from './fake-host-api.client.ts'

const base: HostFacts = { provider: 'deepseek', model: 'deepseek-chat', attachedSessions: 2 }

/** Sessions-list fake: the attached count's only source (a real store over the full list state). */
function fakeSessions(ids: readonly string[]): { list: ObservableSnapshot<SessionListState> } {
  const store = createSnapshotStore<SessionListState>({
    ids: ids.map(id => id as SessionId), byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  return { list: store }
}

describe('diagnosticsText', () => {
  it('lists the provider, model, and attached-session lines', () => {
    expect(diagnosticsText(base)).toBe('provider: deepseek\nmodel: deepseek-chat\nattachedSessions: 2')
  })
})

describe('AboutStore.load', () => {
  it('carries the host facts into the snapshot', async () => {
    const api = new FakeHostApi()
    api.onModelCatalog = () => Promise.resolve(ok({
      default: { provider: 'deepseek', model: 'deepseek-chat' },
      routableProviders: [], groups: [], failures: [],
    }))
    const store = new AboutStore(api.session, fakeSessions(['a', 'b']))
    await store.load()
    expect(store.store.getSnapshot()).toEqual({
      status: 'ready',
      error: null,
      description: base,
    })
  })

  it('moves to the error row on a business failure', async () => {
    const api = new FakeHostApi()
    api.onModelCatalog = () => Promise.resolve(fail('catalog down'))
    const store = new AboutStore(api.session, fakeSessions([]))
    await store.load()
    expect(store.store.getSnapshot()).toEqual({ status: 'error', error: 'catalog down', description: null })
  })

  it('moves to the error row when the transport rejects', async () => {
    const api = new FakeHostApi()
    api.onModelCatalog = () => Promise.reject(new Error('offline'))
    const store = new AboutStore(api.session, fakeSessions([]))
    await store.load()
    expect(store.store.getSnapshot().status).toBe('error')
    expect(store.store.getSnapshot().error).toBe('offline')
  })

  it('keeps the newer load when an older one lands late (success and failure alike)', async () => {
    const api = new FakeHostApi()
    const sessions = fakeSessions([])
    const parked = deferred<Result<FakeModelCatalog>>()
    api.onModelCatalog = () => parked.promise
    const store = new AboutStore(api.session, sessions)
    const stale = store.load()
    api.onModelCatalog = () => Promise.resolve(ok({
      default: { provider: 'other', model: 'm2' }, routableProviders: [], groups: [], failures: [],
    }))
    await store.load()
    expect(store.store.getSnapshot().description?.provider).toBe('other')
    // The stale success lands after: ignored.
    parked.resolve(ok({
      default: { provider: 'deepseek', model: 'deepseek-chat' }, routableProviders: [], groups: [], failures: [],
    }))
    await stale
    expect(store.store.getSnapshot().description?.provider).toBe('other')
    // A stale failure lands after: also ignored.
    const parkedAgain = deferred<Result<FakeModelCatalog>>()
    api.onModelCatalog = () => parkedAgain.promise
    const staleAgain = store.load()
    api.onModelCatalog = () => Promise.resolve(ok({
      default: { provider: 'third', model: 'm3' }, routableProviders: [], groups: [], failures: [],
    }))
    await store.load()
    parkedAgain.reject(new Error('late failure'))
    await staleAgain
    expect(store.store.getSnapshot().status).toBe('ready')
    expect(store.store.getSnapshot().description?.provider).toBe('third')
  })
})

describe('refreshIfLoaded', () => {
  it('skips an idle tab and reloads a loaded one', () => {
    const api = new FakeHostApi()
    const store = new AboutStore(api.session, fakeSessions([]))
    refreshIfLoaded(store)
    expect(api.callsOf('session.modelCatalog')).toEqual([])
    store.store.update((s) => { s.status = 'ready' })
    refreshIfLoaded(store)
    expect(api.callsOf('session.modelCatalog')).toHaveLength(1)
  })
})
