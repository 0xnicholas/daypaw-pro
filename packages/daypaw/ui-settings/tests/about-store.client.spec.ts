/** AboutStore: the host.describe snapshot, the diagnostics text assembly, latest-wins generations, and lazy refresh. */
import { describe, expect, it } from 'vitest'
import { AboutStore, diagnosticsText } from '../src/client/about-store.ts'
import { refreshIfLoaded } from '../src/client/lazy-refresh.ts'
import type { HostDescription } from '@deepseek-ai/dsh-client-connection/client'
import { FakeHostApi, deferred, fail, ok } from './fake-host-api.client.ts'

const base: HostDescription = { version: '1.2.3', cwd: '/work', attachedSessions: 2, canOpenPath: true }

describe('diagnosticsText', () => {
  it('lists provider and model lines when the host names both', () => {
    expect(diagnosticsText({ ...base, provider: 'deepseek', model: 'deepseek-chat' })).toBe(
      'version: 1.2.3\ncwd: /work\nprovider: deepseek\nmodel: deepseek-chat\nattachedSessions: 2',
    )
  })

  it('omits the provider and model lines when the host names neither', () => {
    expect(diagnosticsText(base)).toBe('version: 1.2.3\ncwd: /work\nattachedSessions: 2')
  })
})

describe('AboutStore.load', () => {
  it('carries the host description into the snapshot', async () => {
    const api = new FakeHostApi()
    api.onHostDescribe = () => Promise.resolve(ok({ ...base, provider: 'deepseek', model: 'deepseek-chat' }))
    const store = new AboutStore(api)
    await store.load()
    expect(store.store.getSnapshot()).toEqual({
      status: 'ready',
      error: null,
      description: { ...base, provider: 'deepseek', model: 'deepseek-chat' },
    })
  })

  it('moves to the error row on a business failure', async () => {
    const api = new FakeHostApi()
    api.onHostDescribe = () => Promise.resolve(fail('describe down'))
    const store = new AboutStore(api)
    await store.load()
    expect(store.store.getSnapshot()).toEqual({ status: 'error', error: 'describe down', description: null })
  })

  it('moves to the error row when the transport rejects', async () => {
    const api = new FakeHostApi()
    api.onHostDescribe = () => Promise.reject(new Error('offline'))
    const store = new AboutStore(api)
    await store.load()
    expect(store.store.getSnapshot().status).toBe('error')
    expect(store.store.getSnapshot().error).toBe('offline')
  })

  it('keeps the newer load when an older one lands late (success and failure alike)', async () => {
    const api = new FakeHostApi()
    const parked = deferred<Awaited<ReturnType<typeof api.host.describe>>>()
    api.onHostDescribe = () => parked.promise
    const store = new AboutStore(api)
    const stale = store.load()
    api.onHostDescribe = () => Promise.resolve(ok({ ...base, version: '2.0.0' }))
    await store.load()
    expect(store.store.getSnapshot().description?.version).toBe('2.0.0')
    // The stale success lands after: ignored.
    parked.resolve(ok(base))
    await stale
    expect(store.store.getSnapshot().description?.version).toBe('2.0.0')
    // A stale failure lands after: also ignored.
    const parkedAgain = deferred<Awaited<ReturnType<typeof api.host.describe>>>()
    api.onHostDescribe = () => parkedAgain.promise
    const staleAgain = store.load()
    api.onHostDescribe = () => Promise.resolve(ok({ ...base, version: '3.0.0' }))
    await store.load()
    parkedAgain.reject(new Error('late failure'))
    await staleAgain
    expect(store.store.getSnapshot().status).toBe('ready')
    expect(store.store.getSnapshot().description?.version).toBe('3.0.0')
  })
})

describe('refreshIfLoaded', () => {
  it('skips an idle tab and reloads a loaded one', () => {
    const api = new FakeHostApi()
    const store = new AboutStore(api)
    refreshIfLoaded(store)
    expect(api.callsOf('host.describe')).toEqual([])
    store.store.update((s) => { s.status = 'ready' })
    refreshIfLoaded(store)
    expect(api.callsOf('host.describe')).toHaveLength(1)
  })
})
