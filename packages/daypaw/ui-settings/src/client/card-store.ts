/**
 * First-run API-key banner store: resolves the display name (the engine
 * roster's first agent's business name — the agent a shell-started task
 * runs; the generic name on an empty roster) and the provider the host
 * defaults to (`session/modelCatalog`'s default selection, falling back to
 * deepseek), then checks whether that provider's conventional credential
 * reference is configured. The banner IS the completion ledger: configured =
 * done, so there is no persisted flag — a `credentials/reference-updated`
 * push re-runs the check.
 */
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DurableClient } from '@daypaw/durable-client/client'
import { deriveKeyRef } from './provider-keys.ts'

/** The provider route assumed while the host description names none. */
export const FALLBACK_PROVIDER = 'deepseek'

/** The card's display name while the roster carries no agent. */
export const FALLBACK_AGENT_NAME = 'Agent'

/** Banner snapshot. */
export interface ApiKeyCardState {
  /** 'error' renders like loading: an undecidable check must not paint a false alarm. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Display name interpolated into the card copy; meaningful only when ready. */
  name: string
  /** Whether the active provider's conventional key reference is configured. */
  configured: boolean
}

/** The banner controller (one per apply). */
export class ApiKeyCardStore {
  /** The snapshot the banner renders from (uSES-safe store). */
  readonly store: SnapshotStore<ApiKeyCardState> = createSnapshotStore<ApiKeyCardState>({
    status: 'idle', name: FALLBACK_AGENT_NAME, configured: false,
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (credentials/host domains).
   * @param durable - the durable wire face (durable/listDefinitions).
   */
  constructor(private readonly api: {
    credentials: Pick<ClientRemote['credentials'], 'describe'>
    session: Pick<ClientRemote['session'], 'modelCatalog'>
  }, private readonly durable: DurableClient) {}

  /**
   * Run the readiness check: the roster's first agent name + host provider,
   * then the credential state of the derived reference. Unlike the settings
   * tabs this check re-runs unconditionally on invalidation — the banner
   * appearing the moment a key goes missing is its job.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading' })
    try {
      const [name, catalogResponse] = await Promise.all([
        this.loadFirstAgentName(),
        this.api.session.modelCatalog(),
      ])
      if (!catalogResponse.ok) throw new Error(catalogResponse.error.message)
      const provider = catalogResponse.value.default.provider
      const ref = deriveKeyRef(provider)
      const credentialsResponse = await this.api.credentials.describe([ref])
      if (!credentialsResponse.ok) throw new Error(credentialsResponse.error.message)
      const configured = credentialsResponse.value[ref]?.configured === true
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.name = name
        s.configured = configured
      })
    } catch {
      if (generation !== this.generation) return
      // The failure detail has nowhere useful to go: the banner stays hidden
      // (an unverifiable key must not block the workspace) and the settings
      // page carries its own load errors.
      this.store.update((s) => { s.status = 'error' })
    }
  }

  /**
   * The roster's first agent business name. Roster-level tolerance, unlike
   * the catalog's fail-loud read of the same endpoint: a failed or malformed
   * roster must not hide the key-readiness banner, so the name degrades to
   * the generic label and the check continues.
   * @returns the first agent's display title, its technical name, or the fallback.
   */
  private async loadFirstAgentName(): Promise<string> {
    try {
      const firstAgent = (await this.durable.listDefinitions()).find(definition => definition.kind === 'agent')
      return firstAgent?.display?.title ?? firstAgent?.name ?? FALLBACK_AGENT_NAME
    } catch {
      return FALLBACK_AGENT_NAME
    }
  }
}
