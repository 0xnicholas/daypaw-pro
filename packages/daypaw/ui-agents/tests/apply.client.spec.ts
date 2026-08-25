/** daypaw agents apply: the ui-inbox catalog seat, the dictionaries, the shared catalog store, and teardown. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNodeHalf } from '../src/index.ts'
import { AgentsPage, type AgentsPageInjected } from '../src/client/agents-page.tsx'

// The locale service reads its initial locale from the browser; these specs
// assert the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  // The catalog store reads connection.rpc only when a load runs; the apply
  // assertions never load, so a shape stub suffices.
  ctx.provide('connection', { rpc: { call: () => Promise.reject(new Error('unused')) } } as never)
  const slots = ctx.get('slots') as SlotRegistry
  // The frame's root declaration, as ui-layout's root registration makes it.
  slots.register(
    { name: 'root', children: { 'conversation': { kind: 'single', scope: 'session-maybe' } } } as never,
    () => null,
  )
  // The ui-inbox workspace declaration, as WorkspaceSwitch makes it.
  slots.register(
    { name: 'conversation', children: { 'inbox.agents.page': { kind: 'single', scope: 'session-maybe' } } } as never,
    () => null,
  )
  return { ctx, slots, locale }
}

describe('ui-agents apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('the node half provides no host-side behavior', () => {
    applyNodeHalf()
  })

  it('occupies the ui-inbox catalog seat once the owner declares it', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const page = b.slots.entriesOfSlot('inbox.agents.page')[0]!
    expect(page.component).toBe(AgentsPage)
    expect(page.locale).toBe('daypaw-agents')
    // The dictionaries answer in the browser's zh locale.
    expect(b.locale.bind('daypaw-agents')('page.empty')).toBe('暂无可用 Agent')
  })

  it('binds the page inject face to one shared catalog store', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (b.slots.entriesOfSlot('inbox.agents.page')[0]!.inject as unknown as () => AgentsPageInjected)()
    expect(face.hooks.catalog).toBe(face.store.store)
    face.store.open('unknown@0')
    expect(face.hooks.catalog.getSnapshot().selected).toBeUndefined()
  })

  it('removes the entry and frees the dictionary seats on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('inbox.agents.page')).toHaveLength(0)
    // The (ns, locale) seats are free again — the dictionary disposers ran.
    expect(() => b.locale.register('daypaw-agents', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('daypaw-agents', 'en', {})).not.toThrow()
  })
})
