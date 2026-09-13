/**
 * Connection-recovery notice (the workspace column's transport-health
 * chrome, issue #93): the business-language port of the upstream
 * settings-shell indicator over the reused ui-primitives
 * ConnectionIndicator pill — the fork owns placement and copy, the wire
 * kernel owns state. Renders nothing while healthy; a visible outage shows
 * the 「网络连接已断开」 pill (hover offers 「立即重连」, click requests an
 * immediate reconnect), an automatic retry shows 「正在重连」 with animated
 * dots, and a link returning from disconnected/connecting holds the
 * 「连接已恢复」 confirmation for two seconds before vanishing. The first
 * connect never shows the confirmation — only a return from an outage does.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { ConnectionIndicator, type ConnectionIndicatorState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** How long the 「已恢复」 confirmation stays after a link returns. */
const RECOVERY_CONFIRMATION_MS = 2_000

/** Props: the bound connection-state hook, the reconnect command, the locale seat. */
export interface ConnectionNoticeProps {
  /** Recovery lifecycle of the wire (undefined before the first outcome). */
  useConnectionState: SnapshotSelectorHook<ConnectionState | undefined>
  /** Request a fresh logical generation and physical connection immediately. */
  reconnect: () => void
  /** The inbox namespace seat carrying the connection copy. */
  t: TranslateNS<'inbox'>
}

/**
 * Render the connection-recovery notice, or nothing while the wire is healthy.
 * @param props - the bound state hook, the reconnect command, and the locale seat.
 * @returns the indicator pill, or null.
 */
export function ConnectionNotice({ useConnectionState, reconnect, t }: ConnectionNoticeProps) {
  const connectionState = useConnectionState(s => s)
  const [showRecovery, setShowRecovery] = useState(false)
  const previousConnectionState = useRef(connectionState)
  /* jscpd:ignore-start -- business-language port of upstream
     ui-settings-general SettingsRoot's recovery-derivation block (issue #93):
     the outage/retry/two-second-confirmation timing semantics ARE the port,
     kept verbatim; placement and copy are the fork's own. */
  // Layout effect: the recovery pill must exist in the same paint as the
  // 'connected' render, never a healthy frame flashing between the two.
  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    if (previous !== 'disconnected' && previous !== 'connecting') return
    setShowRecovery(true)
    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)
    return () => { window.clearTimeout(timeout) }
  }, [connectionState])
  /* jscpd:ignore-end */

  let state: ConnectionIndicatorState | undefined
  if (connectionState === 'disconnected' || connectionState === 'connecting') {
    state = connectionState
  } else if (showRecovery) {
    state = 'recovered'
  }
  if (state === undefined) return null
  return (
    <ConnectionIndicator
      state={state}
      disconnectedLabel={t('connection.disconnected')}
      reconnectLabel={t('connection.retry')}
      connectingLabel={t('connection.connecting')}
      recoveredLabel={t('connection.recovered')}
      reconnectActionLabel={t('connection.reconnect-action')}
      restartActionLabel={t('connection.restart-action')}
      onReconnect={reconnect}
    />
  )
}
