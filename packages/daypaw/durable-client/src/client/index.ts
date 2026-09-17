/**
 * daypaw durable wire-vocabulary plugin, browser half: the single home the
 * four ui-* packages read the engine's Remote face through — the seven
 * `durable/*` endpoint calls behind one client interface with fail-loud wire
 * parsing, plus the five-value run-status vocabulary and its copy. The
 * plugin's only effect is registering the `'durable'` dictionaries; the wire
 * face itself is the pure library this module re-exports, consumed through
 * the connection's generic RPC channel. The engine ledger stays the single
 * fact source.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, zh, type DurableKey } from './locales.ts'

export type { DurableClient } from './api.ts'
export { createDurableClient } from './api.ts'
export type {
  WireDefinition,
  WireJournalEntry,
  WireRun,
  WireRunDefKind,
  WireRunLineage,
  WireRunStatus,
  WireStartRunRequest,
} from './wire.ts'
export { isUnfinishedWireRun, runStatusKey } from './status.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The durable run-status words every browser surface shares. */
    durable: DurableKey
  }
}

/** Dictionary namespace owned by this plugin (the status vocabulary). */
const NS = 'durable'

/** Services required by the durable wire-vocabulary plugin. */
export const inject = ['locale']

/** Register the status dictionaries.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'durable-client: dictionaries')
}
