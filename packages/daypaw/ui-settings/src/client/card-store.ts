/**
 * First-run API-key banner store: resolves the display name (the default
 * agent preset's `name`, falling back to its id) and the provider the host
 * runs with (`host.describe.provider`, falling back to deepseek), then checks
 * whether that provider's conventional credential reference is configured.
 * The banner IS the completion ledger: configured = done, so there is no
 * persisted flag — a `credentials/updated` push re-runs the check.
 */
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { deriveKeyRef } from './provider-keys.ts'

/** The provider route assumed while the host description names none. */
export const FALLBACK_PROVIDER = 'deepseek'

/** The card's display name while the deployment has no default preset. */
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
   * @param api - the wire face (agentPresets/host/credentials domains).
   */
  constructor(private readonly api: Pick<IApiClient, 'agentPresets' | 'host' | 'credentials'>) {}

  /**
   * Run the readiness check: default preset name + host provider, then the
   * credential state of the derived reference. Unlike the settings tabs this
   * check re-runs unconditionally on invalidation — the banner appearing the
   * moment a key goes missing is its job.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading' })
    try {
      const [presetsResponse, hostResponse] = await Promise.all([
        this.api.agentPresets.list({}),
        this.api.host.describe({}),
      ])
      if (!presetsResponse.result.ok) throw new Error(presetsResponse.result.error.message)
      if (!hostResponse.result.ok) throw new Error(hostResponse.result.error.message)
      const defaultPreset = presetsResponse.result.value.presets.find(preset => preset.isDefault)
      const name = defaultPreset === undefined ? FALLBACK_AGENT_NAME : (defaultPreset.name ?? defaultPreset.id)
      const provider = hostResponse.result.value.provider ?? FALLBACK_PROVIDER
      const ref = deriveKeyRef(provider)
      const credentialsResponse = await this.api.credentials.describe({ refs: [ref] })
      if (!credentialsResponse.result.ok) throw new Error(credentialsResponse.result.error.message)
      const configured = credentialsResponse.result.value.credentials[ref]?.configured === true
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
}
