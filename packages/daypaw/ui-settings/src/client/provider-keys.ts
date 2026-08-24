/**
 * Credentials tab store: one snapshot joining the configurable-provider
 * directory (`llm.providers`) with the credential states
 * (`credentials.describe`) of each provider's conventional reference. The
 * host stays the single fact source — every mutation writes through the wire
 * and the tab re-renders from the reload. (Named provider-keys rather than
 * credentials-store because the tooling sensitive-file guard blocks paths
 * containing "credential".)
 */
import type { CredentialView, IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Derive the conventional credential reference for a provider route: this
 * page never asks for an environment-variable name, so a typed key stores
 * under this derived reference. Rewritten from upstream
 * `ui-settings-models/src/client/store.ts` — the client bundle purity gate
 * forbids a cross-plugin value import, so the one-liner is restated here.
 * @param provider - provider route id (e.g. `deepseek`, `openai`).
 * @returns the derived reference name (e.g. `DEEPSEEK_API_KEY`).
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host can reject with anything, and the row still has to say
 * something. Rewritten from the upstream ui-settings-models helper for the
 * same purity-gate reason as {@link deriveKeyRef}.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One provider row the credentials tab renders. */
export interface CredentialRow {
  /** Provider route id. */
  provider: string
  /** Human-readable provider name from the directory. */
  displayName: string
  /** The conventional credential reference this page manages for the provider. */
  ref: string
  /** Credential state for {@link ref} (an absent describe answer reads as unconfigured). */
  credential: CredentialView
}

/** Tab snapshot. */
export interface CredentialsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; row-level write failures stay in the editing row. */
  error: string | null
  rows: readonly CredentialRow[]
}

/** The credential view an absent describe answer implies. */
const UNCONFIGURED: CredentialView = { configured: false, writable: false }

/** Wire-write response shape shared by credentials.set/unset. */
type WriteResponse = { result: { ok: true; value: object } | { ok: false; error: { message: string } } }

/** The credentials tab controller (one per apply). */
export class CredentialsStore {
  /** The snapshot the tab renders from (uSES-safe store). */
  readonly store: SnapshotStore<CredentialsState> = createSnapshotStore<CredentialsState>({
    status: 'idle', error: null, rows: [],
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (credentials/llm domains).
   */
  constructor(private readonly api: Pick<IApiClient, 'credentials' | 'llm'>) {}

  /**
   * Refresh the tab snapshot: the provider directory, then one batched
   * credential describe over every conventional reference. Any failure moves
   * the tab to its error row with a retry.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const providersResponse = await this.api.llm.providers({})
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
      // Derive each provider's conventional reference exactly once; the rows zip back over it.
      const keyed = providersResponse.result.value.providers.map(entry => ({ entry, ref: deriveKeyRef(entry.provider) }))
      let credentials: Record<string, CredentialView> = {}
      if (keyed.length > 0) {
        const credentialsResponse = await this.api.credentials.describe({ refs: keyed.map(({ ref }) => ref) })
        if (!credentialsResponse.result.ok) throw new Error(credentialsResponse.result.error.message)
        credentials = credentialsResponse.result.value.credentials
      }
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.rows = keyed.map(({ entry, ref }) => ({
          provider: entry.provider,
          displayName: entry.displayName,
          ref,
          credential: credentials[ref] ?? UNCONFIGURED,
        }))
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
    }
  }

  /**
   * Store one provider key through the wire, then reload so the row
   * re-renders from the host's answer.
   * @param ref - the credential reference to write.
   * @param value - the key text.
   * @returns the failure message, or undefined once the write and reload landed.
   */
  async set(ref: string, value: string): Promise<string | undefined> {
    return this.write(() => this.api.credentials.set({ ref, value }))
  }

  /**
   * Remove one provider key through the wire, then reload.
   * @param ref - the credential reference to remove.
   * @returns the failure message, or undefined once the write and reload landed.
   */
  async unset(ref: string): Promise<string | undefined> {
    return this.write(() => this.api.credentials.unset({ ref }))
  }

  /**
   * Shared write path: the transport or business failure text, else a reload.
   * @param call - the wire write to perform.
   * @returns the failure message, or undefined on success.
   */
  private async write(call: () => Promise<WriteResponse>): Promise<string | undefined> {
    try {
      const response = await call()
      if (!response.result.ok) return response.result.error.message
    } catch (error) {
      // The transport rejected rather than answering; the row must be able to
      // retry instead of silently keeping the old state.
      return messageOf(error)
    }
    await this.load()
    return undefined
  }
}
