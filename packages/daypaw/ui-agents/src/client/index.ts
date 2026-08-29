/**
 * daypaw agent catalog plugin, browser half: one registration over the
 * ui-inbox slot tree — AgentsPage into 'inbox.agents.page' (catalog cards +
 * detail view). Definition facts come from the engine's registry read view
 * through the connection's generic RPC channel (`durable/listDefinitions`,
 * the Remote endpoint the gateway claims from the engine); the host stays the
 * single fact source.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ui-inbox's SlotMap merge (the catalog seat) in.
import type {} from '@daypaw/ui-inbox/client'
import { AgentsPage, type AgentsPageInjected } from './agents-page.tsx'
import { CatalogStore } from './catalog-store.ts'
import { createCatalogApi } from './definitions-api.ts'
import { en, zh, type DaypawAgentsKey } from './locales.ts'

export type { AgentsPageInjected, AgentsPageProps } from './agents-page.tsx'
export type { CatalogCard, CatalogState } from './catalog-store.ts'
export type { CatalogApi, WireDefinition } from './definitions-api.ts'
export type { DaypawAgentsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** daypaw agent catalog copy (grid, detail, load states). */
    'daypaw-agents': DaypawAgentsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'daypaw-agents'

/**
 * Required services (cordis fiber inject). The target seat is declared by
 * ui-inbox's workspace registration, whose activation order relative to this
 * one is NOT constrained; the registration depends on the seat through
 * `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection']

/** Register the dictionaries and the catalog page occupant.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'daypaw-ui-agents: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const catalog = new CatalogStore(createCatalogApi(connection.rpc))

  ctx.slots.inject('inbox.agents.page', () => ctx.slots.register({
    name: 'inbox.agents.page',
    locale: NS,
    inject: (): AgentsPageInjected => ({
      hooks: { catalog: catalog.store },
      store: catalog,
    }),
  }, AgentsPage))
}
