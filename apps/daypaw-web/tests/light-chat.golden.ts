// @vitest-environment jsdom
// Assembled light-chat snapshot: boots the fork roster's real built workspace
// client bundles through AppWebEntry's ModuleLoader path against the keyless
// FixtureApiClient transport (no API key, no model round), opens a plain
// conversation from the nav's Chat-with-the-assistant entry (issue #102: a
// `session/create` over the wire — no engine run, no definition, no
// startRun), sends one message through the seat's queued prompt, and pins the
// business-language conversation the middle column renders against the
// fixture's streaming echo. Cross-refresh fidelity rides the durable session
// the host owns; this golden pins the client faces: the entry opens no task
// dialog, the seat stays live without a run, and the settled session lists as
// a run-less row in the Completed inbox group.
//
// Keyless and deterministic: the fixture is the fake server, so the roster,
// the echo text, and its chunking are fixed in the fixture, not harvested
// from a live model.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/light-chat/conversation.expected.txt')

installAssembledBootEnv()

/** The one message the golden sends from the chat seat. */
const MESSAGE = 'help me write a haiku'

/** The fixture's streaming echo for the message (the plain prompt text, not engine-input JSON). */
const ECHO = `回声：${MESSAGE}。这是 fixture 的流式回复，用于验证打字机增长与定稿切换。`

/** Normalize the middle column's conversation view to stable text lines: the
 *  status row, each business row in flow order, and the chat seat. */
function conversationShape(root: HTMLElement): string {
  const pick = (name: string): Element[] =>
    [...root.querySelectorAll('*')].filter(el => hasClass(el, name))
  const lines: string[] = []
  lines.push(`status=${pick('statusRow')[0]?.textContent?.trim() ?? 'none'}`)
  const kindOf = (row: Element): string => {
    if (hasClass(row, 'userRow')) return 'user'
    if (hasClass(row, 'assistantRow')) return 'assistant'
    if (hasClass(row, 'errorRow')) return 'error'
    return 'empty'
  }
  const flow = pick('flow')[0]
  for (const row of flow?.children ?? []) {
    lines.push(`${kindOf(row)}=${row.textContent?.trim() ?? ''}`)
  }
  const seat = root.querySelector('input')
  lines.push(`seat=${seat?.getAttribute('placeholder') ?? '<missing>'} disabled=${String(seat?.disabled)}`)
  return lines.join('\n')
}

describe('assembled light chat', () => {
  it('opens a plain conversation from the nav entry and chats without a task dialog (issue #102)', async () => {
    mountAssembledApp()

    // The light-chat entry sits beside New Task in the nav column; clicking
    // it opens the conversation directly — no task dialog ever appears.
    const chatEntry = await screen.findByRole('button', { name: 'Chat with the assistant' }, { timeout: 10_000 })
    fireEvent.click(chatEntry)
    expect(screen.queryByRole('dialog')).toBeNull()

    // The created session renders the middle column's conversation: the
    // empty state and a live chat seat (run-less, so never the closed seat).
    await screen.findByText('No messages yet', undefined, { timeout: 10_000 })
    const seat = screen.getByRole('textbox', { name: 'Chat with the assistant…' })
    expect((seat as HTMLInputElement).disabled).toBe(false)

    // One queued prompt from the seat: the user row and the fixture's echo
    // stream into the flow (re-query every poll: a re-render replaces the
    // flow's DOM nodes).
    fireEvent.change(seat, { target: { value: MESSAGE } })
    fireEvent.submit(seat.closest('form')!)
    await screen.findAllByText(MESSAGE, undefined, { timeout: 10_000 })
    const echoNodes = await screen.findAllByText(ECHO, undefined, { timeout: 10_000 })
    const echoNode = echoNodes.find(node => hasClass(node, 'rowText')) ?? echoNodes[0]!
    const conversation = echoNode.closest('div')!.parentElement!.parentElement as HTMLElement
    // The status row leaves when the turn ends; the seat stays live (the
    // session has no run, so the chat seat never closes).
    await waitFor(() => {
      const status = [...conversation.querySelectorAll('*')].find(el => hasClass(el, 'statusRow'))
      expect(status).toBeUndefined()
    }, { timeout: 10_000 })

    const shape = conversationShape(conversation)
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)

    // The settled session lists as a run-less row in the Completed inbox
    // group (the accepted prompt flipped it off the blank draft it was born
    // as; the row re-derives from the durable sessions list on every
    // projection pass — the same face a refresh rebuilds from). Rows sort by
    // most recent activity first, so the just-chatted session is the first
    // row; opening it returns to the conversation.
    fireEvent.click(screen.getByRole('button', { name: /^Completed/ }))
    const rows = await screen.findAllByRole('button', { name: /fixture/ }, { timeout: 10_000 })
    fireEvent.click(rows[0]!)
    await screen.findAllByText(ECHO, undefined, { timeout: 10_000 })
  })
})
