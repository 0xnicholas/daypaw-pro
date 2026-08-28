/** ApiKeyCardStore: the readiness check (default preset name × default provider × credential state) and its failure silence. */
import { describe, expect, it } from 'vitest'
import { ApiKeyCardStore, FALLBACK_AGENT_NAME, FALLBACK_PROVIDER } from '../src/client/card-store.ts'
import { FakeHostApi, deferred, fail, ok, type FakeModelCatalog, type Result } from './fake-host-api.client.ts'

/** Program the happy-path answers: one default preset and one host provider. */
function program(api: FakeHostApi, preset?: { id: string; name?: string }, provider?: string, configured = false): void {
  api.onPresetList = () => Promise.resolve(ok({
    presets: preset === undefined
      ? []
      : [{ id: preset.id, trust: 'system' as const, isDefault: true, ...(preset.name === undefined ? {} : { name: preset.name }) }],
    authorable: false,
  }))
  api.onModelCatalog = () => Promise.resolve(ok({
    default: { provider: provider ?? FALLBACK_PROVIDER, model: 'm' },
    routableProviders: [], groups: [], failures: [],
  }))
  api.onDescribeCredentials = refs => Promise.resolve(ok(
    Object.fromEntries(refs.map(ref => [ref, { configured, writable: true }])),
  ))
}

describe('ApiKeyCardStore.load', () => {
  it('names the card after the default preset display name', async () => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw', name: '小爪' }, 'deepseek')
    const card = new ApiKeyCardStore({ agentPresets: api.agentPresets, credentials: api.credentials, session: api.session })
    await card.load()
    expect(card.store.getSnapshot()).toEqual({ status: 'ready', name: '小爪', configured: false })
  })

  it('falls back to the preset id when it published no name', async () => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw' }, 'deepseek')
    const card = new ApiKeyCardStore({ agentPresets: api.agentPresets, credentials: api.credentials, session: api.session })
    await card.load()
    expect(card.store.getSnapshot().name).toBe('daypaw')
  })

  it('falls back to the generic agent name when no preset is default', async () => {
    const api = new FakeHostApi()
    program(api, undefined, 'deepseek')
    const card = new ApiKeyCardStore({ agentPresets: api.agentPresets, credentials: api.credentials, session: api.session })
    await card.load()
    expect(card.store.getSnapshot().name).toBe(FALLBACK_AGENT_NAME)
  })

  it('checks the conventional reference of the host provider', async () => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw' }, 'openai')
    const card = new ApiKeyCardStore({ agentPresets: api.agentPresets, credentials: api.credentials, session: api.session })
    await card.load()
    expect(api.callsOf('credentials.describe')).toEqual([['OPENAI_API_KEY']])
  })

  it('assumes the fallback provider while the catalog names none', async () => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw' }, undefined)
    const card = new ApiKeyCardStore({ agentPresets: api.agentPresets, credentials: api.credentials, session: api.session })
    await card.load()
    expect(api.callsOf('credentials.describe')).toEqual([[`${FALLBACK_PROVIDER.toUpperCase()}_API_KEY`]])
  })

  it('reports configured only when the describe answer says so', async () => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw' }, 'deepseek', true)
    const card = new ApiKeyCardStore({ agentPresets: api.agentPresets, credentials: api.credentials, session: api.session })
    await card.load()
    expect(card.store.getSnapshot().configured).toBe(true)
  })

  it.each([
    ['preset list', (api: FakeHostApi) => { api.onPresetList = () => Promise.resolve(fail('presets down')) }],
    ['model catalog', (api: FakeHostApi) => { api.onModelCatalog = () => Promise.resolve(fail('catalog down')) }],
    ['credential describe', (api: FakeHostApi) => { api.onDescribeCredentials = () => Promise.resolve(fail('credentials down')) }],
  ])('goes silently to error when the %s call fails business-side', async (_label, sabotage) => {
    const api = new FakeHostApi()
    program(api, { id: 'daypaw' }, 'deepseek')
    sabotage(api)
    const card = new ApiKeyCardStore({ agentPresets: api.agentPresets, credentials: api.credentials, session: api.session })
    await card.load()
    expect(card.store.getSnapshot().status).toBe('error')
  })

  it('goes silently to error when the transport rejects', async () => {
    const api = new FakeHostApi()
    api.onModelCatalog = () => Promise.reject(new Error('offline'))
    const card = new ApiKeyCardStore({ agentPresets: api.agentPresets, credentials: api.credentials, session: api.session })
    await card.load()
    expect(card.store.getSnapshot().status).toBe('error')
  })

  it('keeps the newer check when an older one lands late (success and failure alike)', async () => {
    const api = new FakeHostApi()
    const parked = deferred<Result<FakeModelCatalog>>()
    api.onPresetList = () => Promise.resolve(ok({ presets: [], authorable: false }))
    api.onModelCatalog = () => parked.promise
    const card = new ApiKeyCardStore({ agentPresets: api.agentPresets, credentials: api.credentials, session: api.session })
    const stale = card.load()
    program(api, { id: 'daypaw' }, 'deepseek')
    await card.load()
    expect(card.store.getSnapshot()).toEqual({ status: 'ready', name: 'daypaw', configured: false })
    // The stale success lands after: its describe still rides the wire, but the snapshot never moves.
    parked.resolve(ok({ default: { provider: 'openai', model: 'm' }, routableProviders: [], groups: [], failures: [] }))
    await stale
    expect(api.callsOf('credentials.describe')).toEqual([['DEEPSEEK_API_KEY'], ['OPENAI_API_KEY']])
    expect(card.store.getSnapshot()).toEqual({ status: 'ready', name: 'daypaw', configured: false })
    // A stale failure lands after: also ignored.
    const parkedAgain = deferred<Result<FakeModelCatalog>>()
    api.onModelCatalog = () => parkedAgain.promise
    const staleAgain = card.load()
    program(api, { id: 'daypaw' }, 'deepseek', true)
    await card.load()
    parkedAgain.reject(new Error('late failure'))
    await staleAgain
    expect(card.store.getSnapshot().configured).toBe(true)
  })
})
