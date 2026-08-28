/** CredentialsStore: the providers×describe join, write-through reloads, latest-wins generations, and lazy refresh. */
import { describe, expect, it } from 'vitest'
import { CredentialsStore, deriveKeyRef, messageOf } from '../src/client/provider-keys.ts'
import { refreshIfLoaded } from '../src/client/lazy-refresh.ts'
import { FakeHostApi, deferred, fail, ok, type FakeProviderInfo, type Result } from './fake-host-api.client.ts'

describe('deriveKeyRef', () => {
  it('uppercases the provider route and underscores every non-alphanumeric run', () => {
    expect(deriveKeyRef('deepseek')).toBe('DEEPSEEK_API_KEY')
    expect(deriveKeyRef('deepseek-official')).toBe('DEEPSEEK_OFFICIAL_API_KEY')
  })
})

describe('messageOf', () => {
  it('reads Error.message and stringifies anything else', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('plain')).toBe('plain')
  })
})

describe('CredentialsStore.load', () => {
  it('joins the provider directory with credential states, absent answers reading unconfigured', async () => {
    const api = new FakeHostApi()
    api.onListProviders = () => Promise.resolve(ok([
      { id: 'deepseek', name: 'DeepSeek' }, { id: 'openai', name: 'OpenAI' },
    ]))
    api.onDescribeCredentials = () => Promise.resolve(ok({
      DEEPSEEK_API_KEY: { configured: true, writable: true },
    }))
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    await store.load()
    expect(api.callsOf('credentials.describe')).toEqual([['DEEPSEEK_API_KEY', 'OPENAI_API_KEY']])
    expect(store.store.getSnapshot()).toEqual({
      status: 'ready',
      error: null,
      rows: [
        { provider: 'deepseek', displayName: 'DeepSeek', ref: 'DEEPSEEK_API_KEY', credential: { configured: true, writable: true } },
        { provider: 'openai', displayName: 'OpenAI', ref: 'OPENAI_API_KEY', credential: { configured: false, writable: false } },
      ],
    })
  })

  it('skips the describe call when the directory is empty', async () => {
    const api = new FakeHostApi()
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    await store.load()
    expect(store.store.getSnapshot()).toEqual({ status: 'ready', error: null, rows: [] })
    expect(api.callsOf('credentials.describe')).toEqual([])
  })

  it('moves to the error row when the directory answers a business failure', async () => {
    const api = new FakeHostApi()
    api.onListProviders = () => Promise.resolve(fail('directory down'))
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    await store.load()
    expect(store.store.getSnapshot()).toEqual({ status: 'error', error: 'directory down', rows: [] })
  })

  it('moves to the error row when the describe answers a business failure', async () => {
    const api = new FakeHostApi()
    api.onListProviders = () => Promise.resolve(ok([{ id: 'deepseek', name: 'deepseek' }]))
    api.onDescribeCredentials = () => Promise.resolve(fail('describe down'))
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    await store.load()
    expect(store.store.getSnapshot().status).toBe('error')
    expect(store.store.getSnapshot().error).toBe('describe down')
  })

  it('moves to the error row when the transport rejects', async () => {
    const api = new FakeHostApi()
    api.onListProviders = () => Promise.reject(new Error('socket gone'))
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    await store.load()
    expect(store.store.getSnapshot().status).toBe('error')
    expect(store.store.getSnapshot().error).toBe('socket gone')
  })

  it('keeps the newer load when an older one lands late (success and failure alike)', async () => {
    const api = new FakeHostApi()
    const parked = deferred<Result<readonly FakeProviderInfo[]>>()
    api.onListProviders = () => parked.promise
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    const stale = store.load()
    api.onListProviders = () => Promise.resolve(ok([{ id: 'openai', name: 'OpenAI' }]))
    await store.load()
    expect(store.store.getSnapshot().rows.map(row => row.provider)).toEqual(['openai'])
    // The stale success lands after: ignored.
    parked.resolve(ok([{ id: 'deepseek', name: 'DeepSeek' }]))
    await stale
    expect(store.store.getSnapshot().rows.map(row => row.provider)).toEqual(['openai'])
    // A stale failure lands after: also ignored.
    const parkedAgain = deferred<Result<readonly FakeProviderInfo[]>>()
    api.onListProviders = () => parkedAgain.promise
    const staleAgain = store.load()
    api.onListProviders = () => Promise.resolve(ok([]))
    await store.load()
    parkedAgain.reject(new Error('late failure'))
    await staleAgain
    expect(store.store.getSnapshot().status).toBe('ready')
    expect(store.store.getSnapshot().rows).toEqual([])
  })
})

describe('CredentialsStore writes', () => {
  it('sets a key through the wire and reloads the rows from the host answer', async () => {
    const api = new FakeHostApi()
    api.onListProviders = () => Promise.resolve(ok([{ id: 'deepseek', name: 'deepseek' }]))
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    const result = await store.set('DEEPSEEK_API_KEY', 'sk-test')
    expect(result).toBeUndefined()
    expect(api.callsOf('credentials.set')).toEqual([{ ref: 'DEEPSEEK_API_KEY', value: 'sk-test' }])
    expect(store.store.getSnapshot().status).toBe('ready')
  })

  it('returns the business failure text without a reload', async () => {
    const api = new FakeHostApi()
    api.onSet = () => Promise.resolve(fail('read-only layer'))
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    await expect(store.set('DEEPSEEK_API_KEY', 'sk-test')).resolves.toBe('read-only layer')
    expect(api.callsOf('llm.listProviders')).toEqual([])
  })

  it('returns the transport failure text when the write rejects', async () => {
    const api = new FakeHostApi()
    api.onSet = () => Promise.reject(new Error('offline'))
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    await expect(store.set('DEEPSEEK_API_KEY', 'sk-test')).resolves.toBe('offline')
  })

  it('removes a key through the wire and reloads', async () => {
    const api = new FakeHostApi()
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    const result = await store.unset('DEEPSEEK_API_KEY')
    expect(result).toBeUndefined()
    expect(api.callsOf('credentials.unset')).toEqual([{ ref: 'DEEPSEEK_API_KEY' }])
    expect(api.callsOf('llm.listProviders')).toHaveLength(1)
  })

  it('returns the remove failure text', async () => {
    const api = new FakeHostApi()
    api.onUnset = () => Promise.resolve(fail('cannot remove'))
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    await expect(store.unset('DEEPSEEK_API_KEY')).resolves.toBe('cannot remove')
  })
})

describe('refreshIfLoaded', () => {
  it('skips an idle tab and reloads a loaded one', () => {
    const api = new FakeHostApi()
    const store = new CredentialsStore({ credentials: api.credentials, llm: api.llm })
    refreshIfLoaded(store)
    expect(api.callsOf('llm.listProviders')).toEqual([])
    store.store.update((s) => { s.status = 'ready' })
    refreshIfLoaded(store)
    expect(api.callsOf('llm.listProviders')).toHaveLength(1)
  })
})
