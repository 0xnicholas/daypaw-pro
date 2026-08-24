/**
 * Selection state shared by the three column occupants. One store handle
 * cannot cross slot scopes (the registry rejects a shared handle mounted
 * under two scopes, and sidebar=root / conversation=session-maybe /
 * details=session differ), so the registrations share one bare observable
 * through their inject `hooks` compartments instead; the renderer binds it as
 * each component's `useSelection` hook.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The three inbox groups. */
export type InboxGroup = 'pending' | 'running' | 'done'

/** What the workbench shows: an inbox group, or a secondary-nav page. */
export type InboxSelection =
  | { kind: 'group'; group: InboxGroup }
  | { kind: 'agents' }
  | { kind: 'settings' }

/** Boot selection: the running group. */
export const DEFAULT_SELECTION: InboxSelection = { kind: 'group', group: 'running' }

/**
 * Apply-closure owner of the shared selection source. Created once per plugin
 * apply (never module-level); every registration's hooks compartment carries
 * {@link InboxSelectionController.store}.
 */
export class InboxSelectionController {
  /** The selection source handed to the hooks compartments. */
  readonly store: SnapshotStore<InboxSelection> = createSnapshotStore(DEFAULT_SELECTION)

  /** Select an inbox group or a secondary page.
   * @param next - the new selection.
   */
  select(next: InboxSelection): void {
    this.store.set(next)
  }
}
