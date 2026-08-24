/**
 * About tab store: the `host.describe` snapshot (version, cwd, provider/model)
 * plus the diagnostics text the copy button writes to the clipboard.
 */
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostDescription } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { messageOf } from './provider-keys.ts'

/** Tab snapshot. */
export interface AboutState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** The host description, once loaded. */
  description: HostDescription | null
}

/**
 * Assemble the plain-text diagnostics block the copy button carries.
 * @param description - the loaded host description.
 * @returns one `key: value` line per field.
 */
export function diagnosticsText(description: HostDescription): string {
  const lines = [
    `version: ${description.version}`,
    `cwd: ${description.cwd}`,
  ]
  if (description.provider !== undefined) lines.push(`provider: ${description.provider}`)
  if (description.model !== undefined) lines.push(`model: ${description.model}`)
  lines.push(`attachedSessions: ${description.attachedSessions}`)
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
   * @param api - the wire face (host domain).
   */
  constructor(private readonly api: Pick<IApiClient, 'host'>) {}

  /**
   * Load the host description once per invalidation; a failure moves the tab
   * to its error row with a retry.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const response = await this.api.host.describe({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const description = response.result.value
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
