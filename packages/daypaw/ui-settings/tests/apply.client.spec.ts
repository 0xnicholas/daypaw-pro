/** daypaw settings apply: the two ui-inbox seats, the settings.section declaration, pushed invalidations, and teardown. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNodeHalf } from '../src/index.ts'
import { ApiKeyCard, type ApiKeyCardInjected } from '../src/client/api-key-card.tsx'
import { SettingsPage, type SettingsPageInjected } from '../src/client/settings-page.tsx'
import { FakeHostApi, ok } from './fake-host-api.client.ts'

// The locale service reads its initial locale from the browser; these specs
// assert the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

async function bench(withConversation: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  // The plugin injects `remote`; forwarded events reach it through the same
  // `$dispatch` handoff the connection sink makes.
  new TestRemote(ctx)
  const api = new FakeHostApi()
  ctx.provide('connection', { api } as never)
  const conversation = { blocks: { set: vi.fn() } }
  if (withConversation) ctx.provide('conversation', conversation)
  const slots = ctx.get('slots') as SlotRegistry
  // The frame's root declaration, as ui-layout's root registration makes it.
  slots.register(
    { name: 'root', children: { 'conversation': { kind: 'single', scope: 'session-maybe' } } } as never,
    () => null,
  )
  // The ui-inbox workspace occupant's declarations, as WorkspaceSwitch makes them.
  slots.register(
    {
      name: 'conversation',
      children: {
        'inbox.workspace.banner': { kind: 'list', scope: 'session-maybe' },
        'inbox.settings.page': { kind: 'single', scope: 'session-maybe' },
      },
    } as never,
    () => null,
  )
  return { ctx, slots, locale, api, conversation }
}

describe('ui-settings apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote'])
  })

  it('the node half provides no host-side behavior', () => {
    applyNodeHalf()
  })

  it('occupies both inbox seats and declares the settings.section child slot', async () => {
    const b = await bench(false)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const page = b.slots.entriesOfSlot('inbox.settings.page')[0]!
    expect(page.component).toBe(SettingsPage)
    expect(page.locale).toBe('daypaw-settings')
    // The page declares the upstream models-section ecosystem it renders.
    expect(Object.keys(page.children ?? {})).toEqual(['settings.section'])
    expect(b.slots.snapshot('settings.section')).toMatchObject([{ kind: 'list', scope: 'root' }])
    const banner = b.slots.entries('inbox.workspace.banner')[0]!
    expect(banner.component).toBe(ApiKeyCard)
    expect(banner.options).toMatchObject({ id: 'api-key', order: 0 })
    expect(banner.locale).toBe('daypaw-settings')
    // The dictionaries answer in the browser's zh locale.
    expect(b.locale.bind('daypaw-settings')('title')).toBe('设置')
    // The boot readiness check ran without anyone opening the page.
    expect(b.api.callsOf('agentPreset.list')).toHaveLength(1)
  })

  it('re-runs the banner check on pushed invalidations while idle tabs stay lazy', async () => {
    const b = await bench(false)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.api.callsOf('agentPreset.list')).toHaveLength(1)
    b.ctx.remote.$dispatch('credentials/updated', ['DEEPSEEK_API_KEY'])
    expect(b.api.callsOf('agentPreset.list')).toHaveLength(2)
    // The credentials tab never loaded: no directory fetch rides the push.
    expect(b.api.callsOf('llm.providers')).toEqual([])
    // A loaded tab does refresh; the about tab stays lazy until opened.
    const pageFace = (b.slots.entriesOfSlot('inbox.settings.page')[0]!.inject as unknown as () => SettingsPageInjected)()
    await pageFace.credentialsStore.load()
    expect(b.api.callsOf('llm.providers')).toHaveLength(1)
    b.ctx.emit('connection/reset')
    expect(b.api.callsOf('agentPreset.list')).toHaveLength(3)
    expect(b.api.callsOf('llm.providers')).toHaveLength(2)
    expect(b.api.callsOf('host.describe')).toHaveLength(3) // the card's checks only; the about tab never opened
  })

  it('pushes the composer block through the conversation service when one exists', async () => {
    const b = await bench(true)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const cardFace = (b.slots.entries('inbox.workspace.banner')[0]!.inject as unknown as () => ApiKeyCardInjected)()
    const sessionId = 's1' as SessionId
    cardFace.setInputBlock(sessionId, true)
    expect(b.conversation.blocks.set).toHaveBeenCalledWith(sessionId, { reason: '配置 API key 后即可开始输入' })
    cardFace.setInputBlock(sessionId, false)
    expect(b.conversation.blocks.set).toHaveBeenLastCalledWith(sessionId, undefined)
    cardFace.setInputBlock(undefined, true)
    expect(b.conversation.blocks.set).toHaveBeenCalledTimes(2)
  })

  it('drops the composer block silently while no conversation service exists', async () => {
    const b = await bench(false)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const cardFace = (b.slots.entries('inbox.workspace.banner')[0]!.inject as unknown as () => ApiKeyCardInjected)()
    cardFace.setInputBlock('s1' as SessionId, true)
  })

  it('wires the page and banner inject faces to the shared tab store and the locale service', async () => {
    const b = await bench(false)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const pageFace = (b.slots.entriesOfSlot('inbox.settings.page')[0]!.inject as unknown as () => SettingsPageInjected)()
    const cardFace = (b.slots.entries('inbox.workspace.banner')[0]!.inject as unknown as () => ApiKeyCardInjected)()
    // The banner's credential-tab preset and the page's tab buttons share one source.
    pageFace.selectTab('models')
    expect(pageFace.hooks.tab.getSnapshot()).toBe('models')
    cardFace.openCredentialsTab()
    expect(pageFace.hooks.tab.getSnapshot()).toBe('credentials')
    // The language row writes through the locale service.
    pageFace.setLocale('en')
    expect(b.locale.getSnapshot().active).toBe('en')
    expect(b.locale.bind('daypaw-settings')('title')).toBe('Settings')
  })

  it('removes every entry, collapses the declared child slot, and frees the dictionary seats on teardown', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('inbox.settings.page')).toHaveLength(0)
    expect(b.slots.entries('inbox.workspace.banner')).toHaveLength(0)
    expect(b.slots.snapshot('settings.section')).toEqual([])
    // The (ns, locale) seats are free again — the dictionary disposers ran.
    expect(() => b.locale.register('daypaw-settings', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('daypaw-settings', 'en', {})).not.toThrow()
  })

  it('stops reacting to invalidations after teardown', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    b.ctx.remote.$dispatch('credentials/updated', [])
    b.ctx.emit('connection/reset')
    expect(b.api.callsOf('agentPreset.list')).toHaveLength(1) // the boot check only
  })
})

describe('ok helper', () => {
  it('mints sequential response envelopes (keeps the shared fake honest)', () => {
    expect(ok({}).result).toEqual({ ok: true, value: {} })
  })
})
