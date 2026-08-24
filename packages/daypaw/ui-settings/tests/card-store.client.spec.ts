/** ApiKeyCardStore: the readiness check (default preset name × host provider × credential state) and its failure silence. */
import { describe, expect, it } from 'vitest'
import { ApiKeyCardStore, FALLBACK_AGENT_NAME, FALLBACK_PROVIDER } from '../src/client/card-store.ts'
import { FakeHostApi, deferred, fail, ok } from './fake-host-api.client.ts'

/** Program the happy-path answers: one default preset and one host provider. */
function program(api: FakeHostApi, preset?: { id: string; name?: string }, provider?: string, configured = false): void {
  api.onPresetList = () => Promise.resolve(ok({
    presets: preset === undefined
      ? []
      : [{ id: preset.id, trust: 'system' as const, isDefault: true, ...(preset.name === undefined ? {} : { name: preset.name }) }],
    authorable: false,
    hasDocument: false,
  }))
  api.onHostDescribe = () => Promise.resolve(ok({
    version: '0-fake', cwd: '/f', attachedSessions: 0, canOpenPath: true,
    ...(provider === undefined ? {} : { provider }),
  }))
  api.onDescribeCredentials = ({ refs }) => Promise.resolve(ok({
    credentials: Object.fromEntries(refs.map(ref => [ref, { configured, writable: true }])),
  }))
}

describe('ApiKeyCardStore.load', () => {
  it('names the card after the default preset display name', async () => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw', name: '小爪' }, 'deepseek')
    const card = new ApiKeyCardStore(api)
    await card.load()
    expect(card.store.getSnapshot()).toEqual({ status: 'ready', name: '小爪', configured: false })
  })

  it('falls back to the preset id when it published no name', async () => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw' }, 'deepseek')
    const card = new ApiKeyCardStore(api)
    await card.load()
    expect(card.store.getSnapshot().name).toBe('daypaw')
  })

  it('falls back to the generic agent name when no preset is default', async () => {
    const api = new FakeHostApi()
    program(api, undefined, 'deepseek')
    const card = new ApiKeyCardStore(api)
    await card.load()
    expect(card.store.getSnapshot().name).toBe(FALLBACK_AGENT_NAME)
  })

  it('checks the conventional reference of the host provider', async () => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw' }, 'openai')
    const card = new ApiKeyCardStore(api)
    await card.load()
    expect(api.callsOf('credentials.describe')).toEqual([{ refs: ['OPENAI_API_KEY'] }])
  })

  it('assumes the fallback provider while the host description names none', async () => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw' }, undefined)
    const card = new ApiKeyCardStore(api)
    await card.load()
    expect(api.callsOf('credentials.describe')).toEqual([{ refs: [`${FALLBACK_PROVIDER.toUpperCase()}_API_KEY`] }])
  })

  it('reports configured only when the describe answer says so', async () => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw' }, 'deepseek', true)
    const card = new ApiKeyCardStore(api)
    await card.load()
    expect(card.store.getSnapshot().configured).toBe(true)
  })

  it.each([
    ['preset list', (api: FakeHostApi) => { api.onPresetList = () => Promise.resolve(fail('presets down')) }],
    ['host describe', (api: FakeHostApi) => { api.onHostDescribe = () => Promise.resolve(fail('host down')) }],
    ['credential describe', (api: FakeHostApi) => { api.onDescribeCredentials = () => Promise.resolve(fail('credentials down')) }],
  ])('goes silently to error when the %s call fails business-side', async (_label, sabotage) => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw' }, 'deepseek')
    sabotage(api)
    const card = new ApiKeyCardStore(api)
    await card.load()
    expect(card.store.getSnapshot().status).toBe('error')
  })

  it('goes silently to error when the transport rejects', async () => {
    const api = new FakeHostApi()
    api.onHostDescribe = () => Promise.reject(new Error('offline'))
    const card = new ApiKeyCardStore(api)
    await card.load()
    expect(card.store.getSnapshot().status).toBe('error')
  })

  it('keeps the newer check when an older one lands late (success and failure alike)', async () => {
    const api = new FakeHostApi()
    const parked = deferred<Awaited<ReturnType<typeof api.host.describe>>>()
    api.onPresetList = () => Promise.resolve(ok({ presets: [], authorable: false, hasDocument: false }))
    api.onHostDescribe = () => parked.promise
    const card = new ApiKeyCardStore(api)
    const stale = card.load()
    program(api, { id: 'daypaw' }, 'deepseek')
    await card.load()
    expect(card.store.getSnapshot()).toEqual({ status: 'ready', name: 'daypaw', configured: false })
    // The stale success lands after: its describe still rides the wire, but the snapshot never moves.
    parked.resolve(ok({ version: '0-fake', cwd: '/f', attachedSessions: 0, canOpenPath: true, provider: 'openai' }))
    await stale
    expect(api.callsOf('credentials.describe')).toEqual([{ refs: ['DEEPSEEK_API_KEY'] }, { refs: ['OPENAI_API_KEY'] }])
    expect(card.store.getSnapshot()).toEqual({ status: 'ready', name: 'daypaw', configured: false })
    // A stale failure lands after: also ignored.
    const parkedAgain = deferred<Awaited<ReturnType<typeof api.host.describe>>>()
    api.onHostDescribe = () => parkedAgain.promise
    const staleAgain = card.load()
    program(api, { id: 'daypaw' }, 'deepseek', true)
    await card.load()
    parkedAgain.reject(new Error('late failure'))
    await staleAgain
    expect(card.store.getSnapshot().configured).toBe(true)
  })
})
