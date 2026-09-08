// @vitest-environment jsdom
// Assembled trajectory-inspector snapshot (single-shell layering, ticket
// #105): boots the fork roster's real built workspace client bundles through
// AppWebEntry's ModuleLoader path against the keyless fixture transport, opens
// a plain conversation from the nav's light-chat entry, exchanges one message
// with the fixture's echo, and then expands the conversation seat's Inspector
// tab — pinning that the retargeted upstream trajectory ledger (the
// ui-trajectory row's `viewSlot` config points its registration at the seat's
// 'inbox.workspace.conversation.inspector' ring, carried over the browser
// boot wire's row-config channel) renders the session's turn-aware event
// ledger verbatim while the business pane steps aside. The follow-up seat
// stays live in both panes: layering, not a mode switch.
//
// Keyless and deterministic: the fixture is the fake server, so the roster,
// the echo text, and its chunking are fixed in the fixture, not harvested
// from a live model.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/trajectory-inspector/inspector.expected.txt')

installAssembledBootEnv()

/** The one message the golden sends from the chat seat. */
const MESSAGE = 'help me write a haiku'

/** The fixture's streaming echo for the message (the plain prompt text). */
const ECHO = `回声：${MESSAGE}。这是 fixture 的流式回复，用于验证打字机增长与定稿切换。`

/** Normalize the conversation seat's inspector state to stable text lines:
 *  the tab strip, the ring's chrome (toolbar + timeline), the ledger's turn
 *  rows, and the still-live follow-up seat. */
function inspectorShape(root: HTMLElement): string {
  const pick = (name: string): Element[] =>
    [...root.querySelectorAll('*')].filter(el => hasClass(el, name))
  const lines: string[] = []
  const tabs = pick('tabs')[0]
  lines.push(`tabs=${[...(tabs?.querySelectorAll('[role="tab"]') ?? [])].map(tab => `${tab.textContent}:${tab.getAttribute('aria-selected')}`).join('|')}`)
  lines.push(`toolbar=${root.querySelector('[role="toolbar"]')?.getAttribute('aria-label') ?? 'none'}`)
  lines.push(`timeline=${root.querySelector('section[aria-label="Trajectory timeline"]') ? 'present' : 'none'}`)
  const ledger = pick('ledger')[0]
  const rows = ledger === undefined ? [] : [...ledger.querySelectorAll('tr[aria-label]')]
  lines.push(`ledger=${rows.map(row => row.getAttribute('aria-label') ?? '').join(' / ')}`)
  // The follow-up seat is the seat's own form input (the ledger's toolbar
  // search input is not the seat).
  const seat = root.querySelector('form input')
  const seatDisabled = seat === null ? '<missing>' : String((seat as HTMLInputElement).disabled)
  lines.push(`seat=${seat?.getAttribute('placeholder') ?? '<missing>'} disabled=${seatDisabled}`)
  return lines.join('\n')
}

describe('assembled trajectory inspector', () => {
  it('expands the conversation seat\'s inspector tab into the retargeted trajectory ledger (ticket #105)', async () => {
    mountAssembledApp()

    // Open the light-chat conversation and exchange one message with the
    // fixture's echo (the lane the ledger projects: a user turn, a streamed
    // assistant reply, and the settled turn end).
    const chatEntry = await screen.findByRole('button', { name: 'Chat with the assistant' }, { timeout: 10_000 })
    fireEvent.click(chatEntry)
    const seat = await screen.findByRole('textbox', { name: 'Chat with the assistant…' }, { timeout: 10_000 })
    fireEvent.change(seat, { target: { value: MESSAGE } })
    fireEvent.submit(seat.closest('form')!)
    const echoNodes = await screen.findAllByText(ECHO, undefined, { timeout: 10_000 })
    const echoNode = echoNodes.find(node => hasClass(node, 'rowText')) ?? echoNodes[0]!
    const conversation = echoNode.closest('div')!.parentElement!.parentElement as HTMLElement

    // The tab strip offers both panes; the business pane is the default and
    // the inspector ring renders nothing until expanded.
    expect(screen.getByRole('tab', { name: 'Conversation' }).getAttribute('aria-selected')).toBe('true')
    expect(conversation.querySelector('[role="toolbar"]')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Inspector' }))
    // The retargeted ledger answers: the upstream toolbar and timing overview
    // render inside the seat's inspector pane, and the exchange shows up as a
    // user record row (re-query every render: the ledger virtualizes its rows).
    const toolbar = await screen.findByRole('toolbar', { name: 'Trajectory toolbar' }, { timeout: 10_000 })
    expect(toolbar).toBeTruthy()
    expect(conversation.querySelector('section[aria-label="Trajectory timeline"]')).toBeTruthy()
    await waitFor(() => {
      const userRow = [...conversation.querySelectorAll('tr[aria-label]')]
        .find(row => (row.getAttribute('aria-label') ?? '').includes(MESSAGE))
      expect(userRow).toBeDefined()
    }, { timeout: 10_000 })
    // The business pane steps aside (the flow's rows are unmounted) while the
    // follow-up seat stays live below the ledger.
    expect([...conversation.querySelectorAll('*')].find(el => hasClass(el, 'flow'))).toBeUndefined()
    expect(screen.getByRole('textbox', { name: 'Chat with the assistant…' })).toHaveProperty('disabled', false)

    const shape = inspectorShape(conversation)
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)

    // Switching back restores the business pane; the ledger unmounts.
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }))
    await screen.findAllByText(ECHO, undefined, { timeout: 10_000 })
    expect(conversation.querySelector('[role="toolbar"]')).toBeNull()
  })
})
