/**
 * About tab store: the client-visible host facts — the default provider/model
 * selection (`session/modelCatalog`) and the attached-session count — plus
 * the diagnostics text the copy button writes to the clipboard. The wire
 * surface no longer carries host version or cwd; the copy lists what the
 * client can actually observe.
 */
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { messageOf } from './provider-keys.ts'

/** The observable host facts the About tab lists. */
export interface HostFacts {
  /** Default provider used by unconfigured sessions. */
  provider: string
  /** Default model on that provider. */
  model: string
  /** Sessions the host currently lists. */
  attachedSessions: number
}

/** Tab snapshot. */
export interface AboutState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** The host facts, once loaded. */
  description: HostFacts | null
}

/**
 * Assemble the plain-text diagnostics block the copy button carries.
 * @param description - the loaded host facts.
 * @returns one `key: value` line per field.
 */
export function diagnosticsText(description: HostFacts): string {
  const lines = [
    `provider: ${description.provider}`,
    `model: ${description.model}`,
    `attachedSessions: ${description.attachedSessions}`,
  ]
  return lines.join('\n')
}

/** The about tab controller (one per apply). */
export class AboutStore {
  /** The snapshot the tab renders from (uSES-safe store). */
  readonly store: SnapshotStore<AboutState> = createSnapshotStore<AboutState>({
    status: 'idle', error: null, description: null,
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (session catalog).
   * @param sessions - the sessions service (the attached count).
   */
  constructor(
    private readonly api: Pick<ClientRemote['session'], 'modelCatalog'>,
    private readonly sessions: Pick<ISessions, 'list'>,
  ) {}

  /**
   * Load the observable host facts once per invalidation; a failure moves the
   * tab to its error row with a retry.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const response = await this.api.modelCatalog()
      if (!response.ok) throw new Error(response.error.message)
      const description: HostFacts = {
        provider: response.value.default.provider,
        model: response.value.default.model,
        attachedSessions: this.sessions.list.getSnapshot().ids.length,
      }
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.description = description
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = messageOf(error)
      })
    }
  }
}
