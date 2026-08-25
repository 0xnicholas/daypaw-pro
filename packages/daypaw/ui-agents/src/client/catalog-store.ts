/**
 * Agent catalog store: loads the engine's definition registry read view
 * (spec 05 §5) through the wire face and projects it into catalog cards. The
 * presentation rules live here, not in the component: an agent's title falls
 * back to its technical `name` when the definition declares no display
 * metadata (#52 fallback), and workflow definitions never list — the catalog
 * is the agent directory. The host stays the single fact source; a failure
 * anywhere lands inline on the page.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { CatalogApi } from './definitions-api.ts'

/** One catalog card (agents only; broken or non-agent definitions never list). */
export interface CatalogCard {
  /** Card identity: the registry identity `name@version`. */
  readonly key: string
  /** Business name, falling back to the technical name (#52 fallback). */
  readonly title: string
  /** Business description; empty when the definition declares none (no dead row renders). */
  readonly description: string
  /** Technical name (the detail view's identity line). */
  readonly name: string
  /** Definition version (the detail view's identity line). */
  readonly version: string
}

/** Catalog snapshot. */
export interface CatalogState {
  /** Roster load lifecycle; idle until the page first opens. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Agent cards in registration order. */
  cards: readonly CatalogCard[]
  /** The card open in the detail view; undefined renders the grid. */
  selected: string | undefined
}

/** The agent catalog controller (one per apply). */
export class CatalogStore {
  /** The snapshot the page renders from (uSES-safe store). */
  readonly store: SnapshotStore<CatalogState> = createSnapshotStore<CatalogState>({
    status: 'idle', cards: [], selected: undefined,
  })

  /** Latest roster load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (durable/listDefinitions).
   */
  constructor(private readonly api: CatalogApi) {}

  /**
   * Fetch the registry view and project the agent cards. Safe to call again;
   * only an idle catalog skips it.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading' })
    try {
      const definitions = await this.api.listDefinitions()
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.cards = definitions
          .filter(definition => definition.kind === 'agent')
          .map(definition => ({
            key: `${definition.name}@${definition.version}`,
            title: definition.display?.title ?? definition.name,
            description: definition.display?.description ?? '',
            name: definition.name,
            version: definition.version,
          }))
      })
    } catch {
      if (generation !== this.generation) return
      // Any wire or payload failure reads as the same generic inline failure;
      // raw host wording never reaches the page.
      this.store.update((s) => { s.status = 'error' })
    }
  }

  /**
   * Open one card's detail view.
   * @param key - the card identity (`name@version`).
   */
  open(key: string): void {
    this.store.update((s) => {
      if (s.cards.some(card => card.key === key)) s.selected = key
    })
  }

  /** Leave the detail view for the grid. */
  close(): void {
    this.store.update((s) => { s.selected = undefined })
  }
}
