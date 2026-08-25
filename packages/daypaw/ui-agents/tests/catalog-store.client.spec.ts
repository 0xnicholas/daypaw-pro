/** CatalogStore: load lifecycle, card projection (display fallback + agent-only filter), and the detail selection. */
import { describe, expect, it, vi } from 'vitest'
import type { CatalogApi, WireDefinition } from '../src/client/definitions-api.ts'
import { createCatalogApi } from '../src/client/definitions-api.ts'
import { CatalogStore } from '../src/client/catalog-store.ts'

const DISPLAYED: WireDefinition = {
  kind: 'agent',
  name: 'weekly-report',
  version: '1.2.0',
  display: { title: 'Weekly report assistant', description: 'Drafts the weekly report.' },
}
const PLAIN: WireDefinition = { kind: 'agent', name: 'invoice-checker', version: '0.3.1' }
const WORKFLOW: WireDefinition = { kind: 'workflow', name: 'close-the-books', version: '2.0.0' }

function apiOf(definitions: readonly WireDefinition[]): CatalogApi {
  return { listDefinitions: () => Promise.resolve([...definitions]) }
}

describe('CatalogStore', () => {
  it('loads the registry view and projects cards with the display fallback', async () => {
    const store = new CatalogStore(apiOf([DISPLAYED, PLAIN, WORKFLOW]))
    expect(store.store.getSnapshot().status).toBe('idle')
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    // The workflow definition never lists; the undeclared card falls back to
    // the technical name with an empty description (no dead row).
    expect(state.cards).toEqual([
      { key: 'weekly-report@1.2.0', title: 'Weekly report assistant', description: 'Drafts the weekly report.', name: 'weekly-report', version: '1.2.0' },
      { key: 'invoice-checker@0.3.1', title: 'invoice-checker', description: '', name: 'invoice-checker', version: '0.3.1' },
    ])
  })

  it('lands in the error state when the wire call fails', async () => {
    const store = new CatalogStore({ listDefinitions: () => Promise.reject(new Error('boom')) })
    await store.load()
    expect(store.store.getSnapshot().status).toBe('error')
  })

  it('keeps the newest load: a stale response never overwrites it', async () => {
    let resolveFirst!: (value: WireDefinition[]) => void
    const first = new Promise<WireDefinition[]>((resolve) => { resolveFirst = resolve })
    const api: CatalogApi = {
      listDefinitions: vi.fn()
        .mockImplementationOnce(() => first)
        .mockImplementationOnce(() => Promise.resolve([PLAIN])),
    }
    const store = new CatalogStore(api)
    const stale = store.load()
    const fresh = store.load()
    resolveFirst([DISPLAYED])
    await Promise.all([stale, fresh])
    expect(store.store.getSnapshot().cards.map(card => card.key)).toEqual(['invoice-checker@0.3.1'])
  })

  it('keeps the newest load: a stale rejection never overwrites it', async () => {
    let rejectFirst!: (error: Error) => void
    const first = new Promise<WireDefinition[]>((_resolve, reject) => { rejectFirst = reject })
    const api: CatalogApi = {
      listDefinitions: vi.fn()
        .mockImplementationOnce(() => first)
        .mockImplementationOnce(() => Promise.resolve([PLAIN])),
    }
    const store = new CatalogStore(api)
    const stale = store.load()
    const fresh = store.load()
    rejectFirst(new Error('boom'))
    await Promise.all([stale, fresh])
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.cards.map(card => card.key)).toEqual(['invoice-checker@0.3.1'])
  })

  it('opens and closes the detail view, ignoring unknown keys', async () => {
    const store = new CatalogStore(apiOf([DISPLAYED]))
    await store.load()
    store.open('unknown@0')
    expect(store.store.getSnapshot().selected).toBeUndefined()
    store.open('weekly-report@1.2.0')
    expect(store.store.getSnapshot().selected).toBe('weekly-report@1.2.0')
    store.close()
    expect(store.store.getSnapshot().selected).toBeUndefined()
  })
})

describe('createCatalogApi', () => {
  function rpcReturning(result: unknown): Parameters<typeof createCatalogApi>[0] {
    return { call: () => Promise.resolve(result as never) }
  }

  it('calls the durable/listDefinitions endpoint on /api and validates the payload', async () => {
    const calls: unknown[] = []
    const api = createCatalogApi({
      call: (channel, endpoint, payload) => {
        calls.push([channel, endpoint, payload])
        return Promise.resolve({ ok: true, value: [DISPLAYED, PLAIN] } as never)
      },
    })
    expect(await api.listDefinitions()).toEqual([DISPLAYED, PLAIN])
    expect(calls).toEqual([['/api', 'durable/listDefinitions', { args: {} }]])
  })

  it('throws on a wire error branch', async () => {
    const api = createCatalogApi(rpcReturning({ ok: false, error: { code: 'internal', message: 'no engine', details: {} } }))
    await expect(api.listDefinitions()).rejects.toThrow('no engine')
  })

  it('throws on a non-array payload', async () => {
    const api = createCatalogApi(rpcReturning({ ok: true, value: { entries: [] } }))
    await expect(api.listDefinitions()).rejects.toThrow('non-array')
  })

  it.each([
    ['a non-object entry', [42]],
    ['an entry missing kind/name/version', [{ kind: 'agent', name: 'x' }]],
    ['a non-object display', [{ kind: 'agent', name: 'x', version: '1', display: 'yes' }]],
    ['a display missing title/description', [{ kind: 'agent', name: 'x', version: '1', display: { title: 'X' } }]],
  ])('throws on %s', async (_label, value) => {
    const api = createCatalogApi(rpcReturning({ ok: true, value }))
    await expect(api.listDefinitions()).rejects.toThrow('ui-agents:')
  })
})
