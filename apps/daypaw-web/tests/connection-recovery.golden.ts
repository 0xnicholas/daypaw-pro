// @vitest-environment jsdom
// Assembled connection-recovery snapshot: boots the fork roster's real built
// workspace client bundles through AppWebEntry's ModuleLoader path against the
// keyless fixture transport, then drives the wire kernel's REAL recovery loop
// through the browser network path the loop listens on (issue #93: the
// business-language connection-recovery notice at the workspace column top).
// An `offline` event ends the active generation and parks the loop — the
// notice shows the outage pill with its click-to-reconnect command — and the
// pill's click exercises the user-requested reconnect through
// `connection.reconnect()`: an immediate attempt over the still-live in-process
// fixture transport, a returning link, and the two-second 「连接已恢复」
// confirmation before the column settles back to chrome-free health. The
// per-package suites bench the component over a fake observable; this golden
// pins the composed shell — real ConnectionController, real state source, real
// locale dictionary (en, the pinned navigator), real pill.
//
// Keyless and deterministic: the fixture is the fake server, so nothing here
// reaches a model or the network; the offline/online events only flip the
// controller's network gate, never the in-process carrier.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/connection-recovery/notice.expected.txt')

installAssembledBootEnv()

describe('assembled connection recovery', () => {
  it('shows the outage pill on the workspace column and recovers through the pill click (issue #93)', async () => {
    mountAssembledApp()

    const lines: string[] = []
    // Healthy wire: the column carries no connection chrome while the first
    // generation holds — the notice seats nothing until the wire says otherwise.
    const heading = await screen.findByRole('heading', { name: 'In progress' }, { timeout: 10_000 })
    expect(screen.queryByRole('button', { name: 'Connection lost, reconnect now' })).toBeNull()
    lines.push('healthy=none')
    lines.push(`workspace=${heading.textContent ?? ''}`)

    // The browser goes offline: the loop aborts the active generation and
    // parks, and the outage pill appears at the column top with the
    // business-language outage copy and its accessible reconnect command.
    fireEvent(window, new Event('offline'))
    const pill = await screen.findByRole('button', { name: 'Connection lost, reconnect now' }, { timeout: 10_000 })
    expect(pill.textContent).toContain('Connection lost')
    // The pill rides atop the live workspace content, never replacing it.
    expect(screen.getByRole('heading', { name: 'In progress' })).toBeTruthy()
    lines.push('outage=Connection lost')

    // The user asks for the link back: the pill's click command is the wire
    // service's immediate reconnect, whose attempt succeeds over the
    // in-process fixture carrier — the confirmation pill holds for two
    // seconds, then the column returns to chrome-free health.
    fireEvent.click(pill)
    const recovered = await screen.findByRole('status', { name: 'Connection restored' }, { timeout: 10_000 })
    // The confirmation's accessible name carries the visible label (textContent
    // also sees the width-reserving ghost labels).
    lines.push(`after-click=${recovered.getAttribute('aria-label') ?? ''}`)
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() }, { timeout: 10_000 })
    lines.push('settled=none')

    const shape = lines.join('\n')
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)
  })
})
