/** daypaw settings apply: the two ui-inbox seats, the settings.section declaration, pushed invalidations, and teardown. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { ThemeSettings } from '@deepseek-ai/dsh-client-ui-theme/client'
import { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNodeHalf } from '../src/index.ts'
import { ApiKeyCard, type ApiKeyCardInjected } from '../src/client/api-key-card.tsx'
import { SettingsPage, type SettingsPageInjected } from '../src/client/settings-page.tsx'
import { FakeHostApi, ok } from './fake-host-api.client.ts'

// The locale service reads its initial locale from the browser; these specs
// assert the shipped Chinese copy, so they state the browser they assume.
async function bench(withConversation: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  // The theme service the General tab's preference row rides (a real
  // ThemeRuntime over a stub settings scope, the ui-theme bench shape).
  const theme = new ThemeRuntime(ctx, stubSettingsScope<ThemeSettings>().scope)
  ctx.provide('theme', theme)
  // The plugin injects `remote` + `sessions`; namespaces ride the TestRemote
  // constructor and forwarded events reach subscribers through its emit driver.
  const api = new FakeHostApi()
  const remote = new TestRemote(ctx, {
    agentPresets: api.agentPresets,
    credentials: api.credentials,
    llm: api.llm,
    session: api.session,
  })
  ctx.provide('sessions', {
    list: createSnapshotStore<SessionListState>({
      ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }),
  })
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
  return { ctx, slots, locale, theme, api, remote, conversation }
}

describe('ui-settings apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.session', 'remote.agentPresets',
      'sessions', 'theme',
    ])
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
    expect(b.api.callsOf('agentPresets.list')).toHaveLength(1)
  })

  it('re-runs the banner check on pushed invalidations while idle tabs stay lazy', async () => {
    const b = await bench(false)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.api.callsOf('agentPresets.list')).toHaveLength(1)
    b.remote.emit('credentials/reference-updated', ['DEEPSEEK_API_KEY'])
    expect(b.api.callsOf('agentPresets.list')).toHaveLength(2)
    // The credentials tab never loaded: no directory fetch rides the push.
    expect(b.api.callsOf('llm.listProviders')).toEqual([])
    // A loaded tab does refresh; the about tab stays lazy until opened.
    const pageFace = (b.slots.entriesOfSlot('inbox.settings.page')[0]!.inject as unknown as () => SettingsPageInjected)()
    await pageFace.credentialsStore.load()
    expect(b.api.callsOf('llm.listProviders')).toHaveLength(1)
    b.ctx.emit('connection/reset')
    expect(b.api.callsOf('agentPresets.list')).toHaveLength(3)
    expect(b.api.callsOf('llm.listProviders')).toHaveLength(2)
    expect(b.api.callsOf('session.modelCatalog')).toHaveLength(3) // the card's checks only; the about tab never opened
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
    // The theme row writes through the theme service and mirrors its publishes.
    expect(pageFace.hooks.theme.getSnapshot()).toEqual({ preference: 'light' })
    pageFace.setTheme('dark')
    expect(b.theme.getTheme().preference).toBe('dark')
    expect(pageFace.hooks.theme.getSnapshot()).toEqual({ preference: 'dark' })
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
    b.remote.emit('credentials/reference-updated', [])
    b.ctx.emit('connection/reset')
    expect(b.api.callsOf('agentPresets.list')).toHaveLength(1) // the boot check only
  })
})

describe('ok helper', () => {
  it('mints result envelopes (keeps the shared fake honest)', () => {
    expect(ok({})).toEqual({ ok: true, value: {} })
  })
})
