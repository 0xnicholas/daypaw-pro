/**
 * daypaw settings plugin, browser half: the settings single page (通用/凭据/
 * 模型/关于) occupying ui-inbox's 'inbox.settings.page' seat — declaring the
 * upstream 'settings.section' child slot so the dormant ui-settings-models
 * section wakes — plus the first-run API-key banner in
 * 'inbox.workspace.banner'. Credential/host/preset facts come through the
 * Client Remote namespaces; invalidations ride the forwarded `credentials/reference-updated`
 * event and `connection/reset`.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (credentials/reference-updated rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls ui-conversation's Context merge (ctx.get('conversation')
// .blocks — the composer-block face this plugin pushes into).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-inbox's SlotMap merge (the two target seats).
import type {} from '@daypaw/ui-inbox/client'
// Type-only: pulls ui-theme's Context merge (ctx.theme) and the
// `theme/change` event key into this program.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the settings domain base's SlotMap merge (the
// 'settings.section' child slot the page declares).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsPage, type SettingsPageInjected } from './settings-page.tsx'
import { ApiKeyCard, type ApiKeyCardInjected } from './api-key-card.tsx'
import { SettingsTabController } from './tab-store.ts'
import { CredentialsStore } from './provider-keys.ts'
import { AboutStore } from './about-store.ts'
import { createThemeRowStore, themeRowOf } from './theme-row.ts'
import { refreshIfLoaded } from './lazy-refresh.ts'
import { ApiKeyCardStore } from './card-store.ts'
import { en, zh, type DaypawSettingsKey } from './locales.ts'

export type { ApiKeyCardInjected, ApiKeyCardProps } from './api-key-card.tsx'
export type { SettingsPageInjected, SettingsPageProps } from './settings-page.tsx'
export type { SettingsTab } from './tab-store.ts'
export type { ThemeRowState } from './theme-row.ts'
export type { DaypawSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** daypaw settings page + first-run banner copy. */
    'daypaw-settings': DaypawSettingsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'daypaw-settings'

/**
 * Required services (cordis fiber inject). The target seats are declared by
 * ui-inbox's workspace registration, whose activation order relative to this
 * one is NOT constrained; registrations depend on each seat through
 * `slots.inject()`. `conversation` stays an optional ctx.get: the fork shell
 * has no composer yet, so the input block is lazy wiring. `theme` backs the
 * General tab's preference row (light/dark/system, spec 05 §7).
 */
export const inject = [
  'slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.session', 'remote.agentPresets',
  'sessions', 'theme',
]

/**
 * Register the dictionaries, the settings page occupant, and the first-run
 * banner, and keep every store fresh on pushed invalidations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'daypaw-ui-settings: dictionaries')

  const remote = ctx.remote
  const t = ctx.locale.bind(NS)
  const tabs = new SettingsTabController()
  const credentials = new CredentialsStore({ credentials: remote.credentials, llm: remote.llm })
  const about = new AboutStore(remote.session, ctx.sessions)
  const card = new ApiKeyCardStore({
    agentPresets: remote.agentPresets,
    credentials: remote.credentials,
    session: remote.session,
  })
  // The theme row mirror: seeded at apply, then advanced by every service
  // publish (preference switch, registry change, or an OS flip under
  // `system`).
  const themeRow = createThemeRowStore(ctx.theme.getTheme())
  ctx.on('theme/change', (snapshot) => { themeRow.set(themeRowOf(snapshot)) })

  ctx.effect(() => {
    const refresh = (): void => {
      // The tabs fetch lazily (an unopened tab ignores invalidations); the
      // banner always re-checks — appearing the moment a key goes missing IS
      // its completion ledger.
      refreshIfLoaded(credentials)
      refreshIfLoaded(about)
      void card.load()
    }
    const disposers = [
      ctx.remote.$on('credentials/reference-updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'daypaw-ui-settings: pushed invalidations')

  const pageInjected = (): SettingsPageInjected => ({
    hooks: {
      tab: tabs.store,
      credentials: credentials.store,
      about: about.store,
      locale: ctx.locale,
      theme: themeRow,
    },
    selectTab: (tab) => { tabs.select(tab) },
    credentialsStore: credentials,
    aboutStore: about,
    setLocale: (id) => { ctx.locale.setLocale(id) },
    setTheme: (id) => { ctx.theme.setTheme(id) },
  })
  const cardInjected = (): ApiKeyCardInjected => ({
    hooks: { card: card.store },
    openCredentialsTab: () => { tabs.select('credentials') },
    setInputBlock: (sessionId: SessionId | undefined, blocked: boolean) => {
      if (sessionId === undefined) return
      ctx.get('conversation')?.blocks.set(sessionId, blocked ? { reason: t('card.block-reason') } : undefined)
    },
  })

  ctx.slots.inject('inbox.settings.page', () => ctx.slots.register({
    name: 'inbox.settings.page',
    locale: NS,
    children: {
      // The upstream settings.section ecosystem is declared here (the fork
      // composition never mounts ui-settings-general's sidebar occupant, its
      // upstream declarer). The SlotMap entry fixes the scope at root.
      'settings.section': { kind: 'list', scope: 'root' },
    },
    inject: pageInjected,
  }, SettingsPage))
  ctx.slots.inject('inbox.workspace.banner', () => ctx.slots.register({
    name: 'inbox.workspace.banner',
    id: 'api-key',
    order: 0,
    locale: NS,
    inject: cardInjected,
  }, ApiKeyCard))

  // The first-run check runs at boot: the banner must know whether to exist
  // before anyone opens the settings page.
  void card.load()
}
