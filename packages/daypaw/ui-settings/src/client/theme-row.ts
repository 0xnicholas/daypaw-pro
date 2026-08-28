/**
 * Theme preference mirror for the General tab's 主题 row: the apply-world
 * `theme/change` listener is the only writer, the row reads the snapshot
 * store, and writes travel the injected `setTheme` callback — the ui-theme
 * AppearanceRow pattern carried on the fork page's hooks channel. The store
 * holds the persisted preference, never the resolved active theme (spec 05
 * §7: the switch is a preference, `system` included).
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ThemePreference, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Row state mirrored from the theme service snapshot. */
export interface ThemeRowState {
  /** Persisted preference (light/dark/system). */
  preference: ThemePreference
}

/**
 * Extract the row state from the service snapshot's preference face. Each
 * publish lands as a fresh object, so the store's identity-based subscribers
 * re-render without a revision guard.
 * @param snapshot - the theme service's current snapshot.
 * @returns the row-shaped state for the page store.
 */
export function themeRowOf(snapshot: Pick<ThemeSnapshot, 'preference'>): ThemeRowState {
  return { preference: snapshot.preference }
}

/**
 * Seed the row store from the service snapshot's preference face.
 * @param initial - the theme service's current snapshot (preference).
 * @returns the store for the hooks compartment.
 */
export function createThemeRowStore(initial: Pick<ThemeSnapshot, 'preference'>): SnapshotStore<ThemeRowState> {
  return createSnapshotStore<ThemeRowState>(themeRowOf(initial))
}
