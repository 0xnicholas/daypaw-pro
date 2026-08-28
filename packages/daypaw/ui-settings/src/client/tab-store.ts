/**
 * Settings-page tab selection. One apply-closure controller shared by the
 * settings page occupant (reads) and the first-run API-key banner (presets
 * 凭据 before navigating to the page), following the ui-inbox
 * InboxSelectionController pattern: the bare source travels in each register
 * call's inject `hooks` compartment.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The four settings sections. */
export type SettingsTab = 'general' | 'credentials' | 'models' | 'about'

/** Boot tab: 通用. */
export const DEFAULT_TAB: SettingsTab = 'general'

/** Apply-closure owner of the tab selection source. */
export class SettingsTabController {
  /** The tab source handed to the hooks compartments. */
  readonly store: SnapshotStore<SettingsTab> = createSnapshotStore(DEFAULT_TAB)

  /** Switch the active tab.
   * @param tab - the tab to activate.
   */
  select(tab: SettingsTab): void {
    this.store.set(tab)
  }
}
