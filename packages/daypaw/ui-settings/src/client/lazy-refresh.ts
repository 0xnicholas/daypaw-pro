/** Shared lazy-invalidation guard and first-open load hook for the settings page's tab stores. */
import { useEffect } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** A tab controller that fetches on demand: a status-carrying snapshot plus its load. */
export interface LazilyLoaded {
  readonly store: SnapshotStore<{ status: 'idle' | 'loading' | 'ready' | 'error' }>
  /** Fetch the tab's facts; safe to call again (latest load wins). */
  load(): Promise<void>
}

/**
 * Refetch a tab snapshot only after its first load: an unopened tab must not
 * fetch on background invalidations.
 * @param controller - the tab store.
 */
export function refreshIfLoaded(controller: LazilyLoaded): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Load a lazy tab store on first open; later refreshes ride pushed invalidations.
 * @param state - the tab snapshot (its status gates the load).
 * @param controller - the tab store to load.
 */
export function useLazyTabLoad(state: { status: 'idle' | 'loading' | 'ready' | 'error' }, controller: LazilyLoaded): void {
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [state.status, controller])
}
