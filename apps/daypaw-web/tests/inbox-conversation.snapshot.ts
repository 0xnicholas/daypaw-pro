// @vitest-environment jsdom
// Assembled inbox-conversation snapshot: boots the fork roster's real built
// workspace client bundles through AppWebEntry's ModuleLoader path against the
// keyless FixtureApiClient transport (no API key, no model round), creates a
// task through the new-task dialog, and pins the business-language
// conversation the middle column renders for the fixture's streaming echo.
// The per-package suites bench over src and cannot see the bundled wiring;
// this is the assembled-output check that a dropped slot registration, a
// broken whitelist projection, or leaked run/session/journal wording fails.
//
// Keyless and deterministic: the fixture is the fake server, so the preset
// roster, the echo text, and its chunking are fixed in the fixture, not
// harvested from a live model.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/inbox-conversation/conversation.expected.txt')

installAssembledBootEnv()

/** The fixture's streaming echo for the submitted task text. */
const ECHO = '回声：write a poem。这是 fixture 的流式回复，用于验证打字机增长与定稿切换。'

/** Product vocabulary rule: run/session/journal wording stays off the task surface. */
const FORBIDDEN = /\b(runs?|ran|running|sessions?|journals?)\b/i

/** Normalize the middle column's conversation view to stable text lines: the
 *  status row, each business row in flow order, and the follow-up seat. */
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
  const followup = root.querySelector('input')
  lines.push(`followup=${followup?.getAttribute('placeholder') ?? '<missing>'} disabled=${String(followup?.disabled)}`)
  return lines.join('\n')
}

describe('assembled inbox conversation', () => {
  it('creates a task from the dialog and renders its business-language conversation from the built bundles', async () => {
    mountAssembledApp()

    // The nav column boots on the running group; open the new-task dialog.
    const newTask = await screen.findByRole('button', { name: 'New Task' }, { timeout: 10_000 })
    fireEvent.click(newTask)
    const picker = await screen.findByRole('combobox', { name: 'Agent' }, { timeout: 10_000 })
    // The fixture roster, healthy and in order, with the deployment default preselected.
    await waitFor(() => { expect((picker as HTMLSelectElement).disabled).toBe(false) }, { timeout: 10_000 })
    expect([...screen.getAllByRole('option')].map(option => option.textContent)).toEqual(['standard', 'minimal', 'my-agent'])
    expect((picker as HTMLSelectElement).value).toBe('standard')

    fireEvent.change(screen.getByRole('textbox', { name: 'Task' }), { target: { value: 'write a poem' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }))

    // The dialog dismisses into the task's conversation; the fixture's echo
    // streams in and settles (the status row leaves when the run ends).
    // Re-query every poll: a re-render replaces the flow's DOM nodes.
    await screen.findByText('write a poem', undefined, { timeout: 10_000 })
    const echoNode = await screen.findByText(ECHO, undefined, { timeout: 10_000 })
    const conversation = echoNode.closest('div')!.parentElement!.parentElement as HTMLElement
    // The status row leaves when the run ends (the nav's group label also reads
    // "In progress", so this assertion is scoped to the conversation column).
    await waitFor(() => {
      const status = [...conversation.querySelectorAll('*')].find(el => hasClass(el, 'statusRow'))
      expect(status).toBeUndefined()
    }, { timeout: 10_000 })

    // Business language only: no tool rows, no run/session/journal wording.
    expect(conversation.querySelector('[data-tool]')).toBeNull()
    expect(conversation.textContent ?? '').not.toMatch(FORBIDDEN)

    const shape = conversationShape(conversation)
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)
  })
})
