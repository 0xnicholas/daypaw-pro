/** CatalogStore: load lifecycle, card projection (display fallback + agent-only filter), and the detail selection. */
import { describe, expect, it, vi } from 'vitest'
import type { DurableClient, WireDefinition } from '@daypaw/durable-client/client'
import { CatalogStore } from '../src/client/catalog-store.ts'

const DISPLAYED: WireDefinition = {
  kind: 'agent',
  name: 'weekly-report',
  version: '1.2.0',
  display: { title: 'Weekly report assistant', description: 'Drafts the weekly report.' },
  inputKind: 'text',
}
const PLAIN: WireDefinition = { kind: 'agent', name: 'invoice-checker', version: '0.3.1', inputKind: null }
const WORKFLOW: WireDefinition = { kind: 'workflow', name: 'close-the-books', version: '2.0.0', inputKind: null }

/** The catalog reads one endpoint; the rest of the single wire face stays unused. */
const UNUSED = () => { throw new Error('the catalog reads listDefinitions only') }

function apiOf(listDefinitions: DurableClient['listDefinitions']): DurableClient {
  return {
    listDefinitions,
    listRuns: UNUSED,
    runLineage: UNUSED,
    journalTimeline: UNUSED,
    rerun: UNUSED,
    startRun: UNUSED,
    steerText: UNUSED,
    resolveGate: UNUSED,
  }
}

describe('CatalogStore', () => {
  it('loads the registry view and projects cards with the display fallback', async () => {
    const store = new CatalogStore(apiOf(() => Promise.resolve([DISPLAYED, PLAIN, WORKFLOW])))
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
    const store = new CatalogStore(apiOf(() => Promise.reject(new Error('boom'))))
    await store.load()
    expect(store.store.getSnapshot().status).toBe('error')
  })

  // The rule's own spec lives in @daypaw/client-load; this asserts both loads
  // share one guard.
  it('shares one newest-wins guard across loads: a stale response never overwrites it', async () => {
    let resolveFirst!: (value: WireDefinition[]) => void
    const first = new Promise<WireDefinition[]>((resolve) => { resolveFirst = resolve })
    const listDefinitions = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve([PLAIN]))
    const store = new CatalogStore(apiOf(listDefinitions))
    const stale = store.load()
    const fresh = store.load()
    resolveFirst([DISPLAYED])
    await Promise.all([stale, fresh])
    expect(store.store.getSnapshot().cards.map(card => card.key)).toEqual(['invoice-checker@0.3.1'])
  })

  it('opens and closes the detail view, ignoring unknown keys', async () => {
    const store = new CatalogStore(apiOf(() => Promise.resolve([DISPLAYED])))
    await store.load()
    store.open('unknown@0')
    expect(store.store.getSnapshot().selected).toBeUndefined()
    store.open('weekly-report@1.2.0')
    expect(store.store.getSnapshot().selected).toBe('weekly-report@1.2.0')
    store.close()
    expect(store.store.getSnapshot().selected).toBeUndefined()
  })
})
