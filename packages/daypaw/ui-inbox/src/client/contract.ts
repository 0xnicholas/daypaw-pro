/**
 * Slot contracts owned by the inbox workbench: the holes WorkspaceSwitch
 * declares and renders for the fork composition. Both live one scope inside
 * the parent 'conversation' slot (session-maybe), so occupants receive the
 * current-session-or-undefined inject parameter.
 */

/** Owner share of a workspace banner entry. */
export interface InboxBannerOwnerProps {
  /** Switch the middle column to the settings page (the banner's one navigation affordance). */
  openSettings: () => void
}

/** Owner share of the settings page occupant. */
export interface InboxSettingsPageOwnerProps {
  /** Leave the settings page: switch the middle column back to the running group. */
  close: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The banner strip atop a group container: first-run and workspace-level
     * notices, one row per entry. Following the onboarding-ledger mechanics,
     * each registrant owns its readiness and completion state and renders
     * null until its facts load — a mounted-but-deciding entry shows nothing.
     */
    'inbox.workspace.banner': { kind: 'list'; scope: 'session-maybe'; owner: InboxBannerOwnerProps }
    /**
     * The 设置 page content: the single occupant draws the whole settings
     * surface inside the middle column. An absent occupant falls back to the
     * owner's placeholder.
     */
    'inbox.settings.page': { kind: 'single'; scope: 'session-maybe'; owner: InboxSettingsPageOwnerProps }
  }
}
