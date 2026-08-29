/** ApiKeyCardStore: the readiness check (roster's first agent name × default provider × credential state) and its failure silence. */
import { describe, expect, it } from 'vitest'
import { ApiKeyCardStore, FALLBACK_AGENT_NAME } from '../src/client/card-store.ts'
import type { FakeDefinitionRow } from './fake-host-api.client.ts'
import { FakeHostApi, fail, ok } from './fake-host-api.client.ts'

/** Program the happy-path answers: one roster and one host provider. */
function program(api: FakeHostApi, agents?: readonly FakeDefinitionRow[], provider?: string, configured = false): void {
  api.onListDefinitions = () => Promise.resolve(ok(agents ?? []))
  api.onModelCatalog = () => Promise.resolve(ok({
    default: { provider: provider ?? 'deepseek', model: 'deepseek-chat' }, routableProviders: [], groups: [], failures: [],
  }))
  api.onDescribeCredentials = () => Promise.resolve(ok({ DEEPSEEK_API_KEY: { configured, writable: true } }))
}

describe('ApiKeyCardStore readiness', () => {
  it('names the card after the first roster agent display title', async () => {
    const api = new FakeHostApi()
    program(api, [
      { kind: 'agent', name: 'starter-assistant', version: '1.0.0', display: { title: '小爪' } },
      { kind: 'agent', name: 'weekly-report', version: '1.2.0' },
    ], 'deepseek')
    const card = new ApiKeyCardStore({ credentials: api.credentials, session: api.session }, api.rpc)
    await card.load()
    expect(card.store.getSnapshot()).toEqual({ status: 'ready', name: '小爪', configured: false })
  })

  it('falls back to the technical name when the agent declares no display title', async () => {
    const api = new FakeHostApi()
    program(api, [{ kind: 'agent', name: 'starter-assistant', version: '1.0.0' }])
    const card = new ApiKeyCardStore({ credentials: api.credentials, session: api.session }, api.rpc)
    await card.load()
    expect(card.store.getSnapshot().name).toBe('starter-assistant')
  })

  it('skips workflow rows and falls back to the generic name on an empty roster', async () => {
    const api = new FakeHostApi()
    program(api, [{ kind: 'workflow', name: 'release-digest', version: '0.4.0' }])
    const card = new ApiKeyCardStore({ credentials: api.credentials, session: api.session }, api.rpc)
    await card.load()
    expect(card.store.getSnapshot().name).toBe(FALLBACK_AGENT_NAME)
  })

  it('falls back to the generic name when the first agent row is malformed', async () => {
    const api = new FakeHostApi()
    program(api, [{ kind: 'agent' } as never])
    const card = new ApiKeyCardStore({ credentials: api.credentials, session: api.session }, api.rpc)
    await card.load()
    expect(card.store.getSnapshot()).toMatchObject({ status: 'ready', name: FALLBACK_AGENT_NAME })
  })

  it('reports configured when the active provider key is set', async () => {
    const api = new FakeHostApi()
    program(api, [{ kind: 'agent', name: 'starter-assistant', version: '1.0.0' }], 'deepseek', true)
    const card = new ApiKeyCardStore({ credentials: api.credentials, session: api.session }, api.rpc)
    await card.load()
    expect(card.store.getSnapshot().configured).toBe(true)
  })

  it('assumes the fallback provider while the catalog names none', async () => {
    const api = new FakeHostApi()
    api.onListDefinitions = () => Promise.resolve(ok([]))
    api.onModelCatalog = () => Promise.resolve(ok({
      default: { provider: '', model: '' }, routableProviders: [], groups: [], failures: [],
    }))
    const card = new ApiKeyCardStore({ credentials: api.credentials, session: api.session }, api.rpc)
    await card.load()
    // The empty provider routes nowhere, so the reference stays unconfigured.
    expect(card.store.getSnapshot().configured).toBe(false)
  })

  it.each([
    ['roster fetch', (api: FakeHostApi) => { api.onListDefinitions = () => Promise.resolve(fail('roster down')) }],
    ['catalog fetch', (api: FakeHostApi) => { api.onModelCatalog = () => Promise.resolve(fail('catalog down')) }],
    ['credential describe', (api: FakeHostApi) => { api.onDescribeCredentials = () => Promise.resolve(fail('describe down')) }],
  ])('stays silent (renders like loading) when the %s fails', async (_name, breakIt) => {
    const api = new FakeHostApi()
    program(api, [{ kind: 'agent', name: 'starter-assistant', version: '1.0.0' }])
    breakIt(api)
    const card = new ApiKeyCardStore({ credentials: api.credentials, session: api.session }, api.rpc)
    await card.load()
    expect(card.store.getSnapshot().status).toBe('error')
  })

  it('keeps the latest load when an older response lands late', async () => {
    const api = new FakeHostApi()
    program(api, [{ kind: 'agent', name: 'starter-assistant', version: '1.0.0' }])
    const card = new ApiKeyCardStore({ credentials: api.credentials, session: api.session }, api.rpc)
    // Park one roster answer, run a second load, then release the stale one.
    let release!: (value: unknown) => void
    const parked = new Promise<unknown>((resolve) => { release = resolve })
    api.onListDefinitions = () => parked as never
    const stale = card.load()
    program(api, [{ kind: 'agent', name: 'fresh', version: '1.0.0' }])
    await card.load()
    release(ok([{ kind: 'agent', name: 'stale', version: '1.0.0' }]))
    await stale
    expect(card.store.getSnapshot().name).toBe('fresh')
  })

  it('ignores a stale load failure landing after a newer load succeeded', async () => {
    const api = new FakeHostApi()
    program(api, [{ kind: 'agent', name: 'starter-assistant', version: '1.0.0' }])
    const card = new ApiKeyCardStore({ credentials: api.credentials, session: api.session }, api.rpc)
    let reject!: (error: unknown) => void
    const parked = new Promise<unknown>((_resolve, rej) => { reject = rej })
    api.onListDefinitions = () => parked as never
    const stale = card.load()
    program(api, [{ kind: 'agent', name: 'fresh', version: '1.0.0' }])
    await card.load()
    reject(new Error('late failure'))
    await stale
    expect(card.store.getSnapshot().status).toBe('ready')
  })

  it('flags a non-array roster answer as an error', async () => {
    const api = new FakeHostApi()
    api.onListDefinitions = () => Promise.resolve(ok('nope' as never))
    const card = new ApiKeyCardStore({ credentials: api.credentials, session: api.session }, api.rpc)
    await card.load()
    expect(card.store.getSnapshot().status).toBe('error')
  })
})
