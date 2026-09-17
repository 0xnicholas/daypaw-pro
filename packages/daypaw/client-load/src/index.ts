/**
 * Newest-wins settlement for the daypaw browser plane's store loads: the one
 * guard the fork's shell stores share, so the staleness rule and its tests live
 * in one place instead of once per store.
 *
 * A store keeps what is genuinely its own — the wire read, the projection into
 * its snapshot, and the status policy it shows while an attempt is in flight or
 * after it fails. What it delegates here is the generation bookkeeping and the
 * rule that a superseded attempt writes nothing at all: neither its data nor its
 * rejection reaches the snapshot once a newer attempt exists.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** What one load attempt may write into the store. */
export interface LoadPolicy<S, D> {
  /**
   * The attempt's synchronous writes before its read settles: the status the
   * store shows while the attempt is in flight, plus any selection or reset
   * that belongs to it. Runs for every attempt, including one a later call is
   * about to supersede — the caller's intent is already in the snapshot.
   * @param draft - the store's mutable draft.
   */
  start?: (draft: S) => void
  /**
   * The newest attempt's data, folded into the snapshot.
   * @param draft - the store's mutable draft.
   * @param data - the resolved read value.
   */
  success: (draft: S, data: D) => void
  /**
   * The newest attempt's rejection. Omitted when a failed load writes nothing
   * beyond what {@link LoadPolicy.start} wrote.
   * @param draft - the store's mutable draft.
   * @param error - the rejection value, as thrown by the read.
   */
  failure?: (draft: S, error: unknown) => void
}

/**
 * Runs store loads under the newest-wins rule. One instance per store, held for
 * the store's lifetime: the attempt counter is the instance's state, so a
 * controller built per call would let every attempt write.
 */
export class LatestLoad<S> {
  /** Latest attempt wins; an older attempt writes nothing, success or failure alike. */
  private generation = 0

  /**
   * @param store - the snapshot store every attempt settles into.
   */
  constructor(private readonly store: SnapshotStore<S>) {}

  /**
   * Supersede any in-flight attempt without starting one — the clear or
   * selection path, where the store resets itself and the outstanding read must
   * no longer land.
   */
  invalidate(): void {
    this.generation += 1
  }

  /**
   * Run one attempt: apply the policy's start writes, await the read, then let
   * the attempt write its outcome only while it is still the newest one.
   * @param fetch - the read; its rejection is the attempt's failure.
   * @param policy - what this attempt writes.
   * @returns a promise settling once this attempt has settled or dropped, never
   *   rejected: the snapshot carries the outcome.
   */
  async run<D>(fetch: () => Promise<D>, policy: LoadPolicy<S, D>): Promise<void> {
    const { start, success, failure } = policy
    const generation = ++this.generation
    if (start !== undefined) this.store.update((draft) => { start(draft) })
    try {
      const data = await fetch()
      if (generation !== this.generation) return
      this.store.update((draft) => { success(draft, data) })
    } catch (error) {
      if (generation !== this.generation) return
      if (failure !== undefined) this.store.update((draft) => { failure(draft, error) })
    }
  }
}
