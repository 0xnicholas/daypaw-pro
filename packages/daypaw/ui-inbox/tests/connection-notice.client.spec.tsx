// @vitest-environment jsdom
/** ConnectionNotice: the workspace column's connection-recovery chrome — outage, retry, two-second recovery confirmation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import { ConnectionNotice, type ConnectionNoticeProps } from '../src/client/ConnectionNotice.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t: ConnectionNoticeProps['t'] = key => (zh as Record<string, string>)[key] ?? key

/**
 * Mount the notice over a mutable observable standing in for the renderer's
 * bound `useConnectionState` hook (the same contract the injected
 * ConnectionStateSource satisfies).
 */
function harness(initial: ConnectionState | undefined) {
  const source = {
    current: initial,
    listeners: new Set<() => void>(),
    reconnect: vi.fn(),
    set(next: ConnectionState | undefined): void {
      act(() => {
        source.current = next
        for (const fn of [...source.listeners]) fn()
      })
    },
  }
  function Host(): React.ReactElement {
    const useConnectionState: ConnectionNoticeProps['useConnectionState'] = (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = (): void => { force(n => n + 1) }
        source.listeners.add(listener)
        return () => { source.listeners.delete(listener) }
      }, [])
      return select(source.current)
    }
    return <ConnectionNotice useConnectionState={useConnectionState} reconnect={source.reconnect} t={t} />
  }
  render(<Host />)
  return source
}

describe('ConnectionNotice', () => {
  it('renders nothing while healthy and before the first wire outcome', () => {
    harness('connected')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    harness(undefined)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the outage pill with business copy and reconnects on click', () => {
    const source = harness('disconnected')
    const pill = screen.getByRole('button', { name: zh['connection.reconnect-action'] })
    expect(pill.textContent).toContain(zh['connection.disconnected'])
    fireEvent.click(pill)
    expect(source.reconnect).toHaveBeenCalledOnce()
  })

  it('shows the retry pill with animated dots while connecting', () => {
    harness('connecting')
    const pill = screen.getByRole('button', { name: zh['connection.restart-action'] })
    // The state label carries the retry copy plus the three animated dots
    // (the size-reserving ghost labels echo the copy; textContent sees all).
    expect(pill.textContent).toContain(`${zh['connection.connecting']}...`)
  })

  it('holds the recovery confirmation for two seconds after a link returns, then clears', () => {
    vi.useFakeTimers()
    const source = harness('connected')
    source.set('disconnected')
    source.set('connected')
    expect(screen.getByRole('status', { name: zh['connection.recovered'] }).textContent)
      .toContain(zh['connection.recovered'])
    act(() => { vi.advanceTimersByTime(1_999) })
    expect(screen.getByRole('status')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('never flashes the recovery pill on the first connect', () => {
    const source = harness(undefined)
    source.set('connected')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('clears a showing recovery pill at once when the link drops again', () => {
    const source = harness('connected')
    source.set('disconnected')
    source.set('connected')
    expect(screen.getByRole('status')).toBeTruthy()
    source.set('disconnected')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: zh['connection.reconnect-action'] })).toBeTruthy()
  })
})
