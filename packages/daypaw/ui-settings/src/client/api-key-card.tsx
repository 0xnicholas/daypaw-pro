/**
 * First-run API-key banner (the 'inbox.workspace.banner' entry, id 'api-key',
 * order 0): the yellow card shown atop the workspace while the active
 * provider's conventional credential reference is unconfigured. The card IS
 * the completion ledger — configured state dismisses it, no persisted flag.
 * Following the onboarding-ledger mechanics it renders null while the check
 * is undecided (loading or failed). While visible with a current session it
 * pushes the composer block through the conversation service (lazy wiring:
 * the fork shell has no composer yet, so the block is a no-op seat until the
 * conversation column ticket lands).
 */
import { useEffect } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-inbox's SlotMap merge (the 'inbox.workspace.banner' entry).
import type {} from '@daypaw/ui-inbox/client'
import type { ApiKeyCardState } from './card-store.ts'
import css from './api-key-card.module.css'

/** Registration-side business face for the API-key banner. */
export interface ApiKeyCardInjected {
  hooks: {
    /** The readiness snapshot, bound by the renderer as useCard. */
    card: SnapshotStore<ApiKeyCardState>
  }
  /** Preset the settings page's 凭据 tab before openSettings navigates there. */
  openCredentialsTab: () => void
  /**
   * Raise (with this plugin's localized reason) or clear the current
   * session's composer block; a no-op while the composition has no
   * conversation service or no current session.
   */
  setInputBlock: (sessionId: SessionId | undefined, blocked: boolean) => void
}

/** Full component props: runtime share + injected face + locale seat. */
export type ApiKeyCardProps =
  PropsRuntime<'inbox.workspace.banner'>
  & InjectFace<ApiKeyCardInjected>
  & PropsLocale<'daypaw-settings'>

/**
 * Render the banner, or null while the check is undecided or the key exists.
 * @param props - composed slot props (runtime share + injected face + locale seat).
 * @returns the card element, or null.
 */
export function ApiKeyCard({ openSettings, sessionId, useCard, openCredentialsTab, setInputBlock, t }: ApiKeyCardProps) {
  const state = useCard(s => s)
  const visible = state.status === 'ready' && !state.configured
  // Card visibility decides the composer block; unmount or dismissal clears it.
  useEffect(() => {
    if (sessionId === undefined) return
    setInputBlock(sessionId, visible)
    return () => { setInputBlock(sessionId, false) }
  }, [sessionId, visible, setInputBlock])
  if (!visible) return null
  return (
    <div className={css.card}>
      <span className={css.cardText}>{t('card.needs-key', { name: state.name })}</span>
      <button
        type="button"
        className={css.cardButton}
        onClick={() => {
          openCredentialsTab()
          openSettings()
        }}
      >
        {t('card.go-settings')}
      </button>
    </div>
  )
}
