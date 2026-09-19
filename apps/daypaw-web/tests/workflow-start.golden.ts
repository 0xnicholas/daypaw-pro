// @vitest-environment jsdom
// Assembled workflow-start snapshot: boots the fork roster's real built
// workspace client bundles through AppWebEntry's ModuleLoader path against the
// keyless FixtureApiClient transport (no API key, no model round), picks the
// registry's workflow definition in the new-task dialog (issue #127) and
// starts it through the JSON surface its wire-less definition rules, then pins
// what the owner gets: the run itself, with no session twin anywhere (a
// workflow run has none, ADR 0016). The per-package suites bench over src with
// fake hosts and cannot see the bundled wiring or the owner props crossing the
// slot boundary; this is the assembled-output check that a workflow row cannot
// be started, or waits for a twin that never arrives.
//
// Keyless and deterministic: the fixture is the fake server, so the roster and
// the ledger row are fixed in the fixture, not harvested from a live engine.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/workflow-start/start.expected.txt')

installAssembledBootEnv()

/** Product vocabulary rule: run/session/journal wording stays off the task surface. */
const FORBIDDEN = /\b(runs?|ran|running|sessions?|journals?)\b/i

/** Match CSS-module class by logical name (the scaffold's hasClass) over a subtree. */
function pick(root: ParentNode, name: string): Element[] {
  return [...root.querySelectorAll('*')].filter(el => hasClass(el, name))
}

/** One shell column by its AppFrame module class. */
function column(name: 'sidebarCol' | 'centerCol' | 'rightbarCol'): HTMLElement {
  const el = pick(document.body, name)[0]
  if (el === undefined) throw new Error(`assembled frame column ${name} is not rendered`)
  return el as HTMLElement
}

/** Trimmed text of the first element carrying the module class, undefined when absent. */
function textOf(root: ParentNode, name: string): string | undefined {
  return pick(root, name)[0]?.textContent?.trim() ?? undefined
}

/** Normalize the nav group counts plus the middle column's list to stable lines. */
function boardShape(): string {
  const lines: string[] = []
  const groups = pick(column('sidebarCol'), 'groups')[0]
  for (const button of groups?.querySelectorAll('button') ?? []) {
    lines.push(`group=${textOf(button, 'rowLabel')} count=${textOf(button, 'count')}`)
  }
  const list = pick(column('centerCol'), 'list')[0]
  for (const item of list?.children ?? []) {
    const row = item.querySelector('button')
    if (row !== null) lines.push(`row=${textOf(row, 'title')}`)
  }
  return lines.join('\n')
}

/** Normalize the right column: header (title, status, retry affordance) then one block per section. */
function detailShape(): string {
  const details = column('rightbarCol')
  const lines: string[] = []
  const header = pick(details, 'header')[0]
  lines.push(`header=${header === undefined ? 'none' : (textOf(header, 'title') ?? 'none')}`)
  if (header !== undefined) lines.push(`status=${textOf(header, 'status') ?? 'none'}`)
  for (const section of pick(details, 'section')) {
    lines.push(`section=${textOf(section, 'heading')}`)
    lines.push(`  empty=${textOf(section, 'empty') ?? 'none'}`)
  }
  return lines.join('\n')
}

describe('assembled workflow start', () => {
  it('starts the registry workflow definition from the dialog and opens the session-less run itself', async () => {
    mountAssembledApp()

    const newTask = await screen.findByRole('button', { name: 'New Task' }, { timeout: 10_000 })
    fireEvent.click(newTask)
    const picker = await screen.findByRole('combobox', { name: 'Task type' }, { timeout: 10_000 })
    await waitFor(() => { expect((picker as HTMLSelectElement).disabled).toBe(false) }, { timeout: 10_000 })
    // Every registry definition rosters, the workflow row last and by its
    // technical name (a workflow declares no display title).
    expect([...screen.getAllByRole('option')].map(option => option.textContent))
      .toEqual(['Starter assistant', 'Weekly report assistant', 'invoice-checker', 'nightly-digest'])

    // Picking it swaps the free-text surface for the JSON one: a definition
    // without a wire face takes the JSON box on both the render and send sides.
    fireEvent.change(picker, { target: { value: 'nightly-digest@1' } })
    await waitFor(() => { expect(screen.queryByRole('textbox', { name: 'Task' })).toBeNull() })
    fireEvent.change(screen.getByRole('textbox', { name: 'Task JSON' }), { target: { value: '{"topics":["notes"]}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }))

    // No session twin exists to wait for, so the owner opens the run the
    // moment the wire answers: the middle column shows the run placeholder
    // instead of a conversation, and the detail column carries the run's
    // header off the ledger row.
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() }, { timeout: 10_000 })
    await waitFor(() => {
      expect(textOf(column('centerCol'), 'empty')).toBe('This task has no conversation — see its progress and outputs in the details column')
    }, { timeout: 10_000 })
    await waitFor(() => {
      expect(textOf(pick(column('rightbarCol'), 'header')[0] ?? document.body, 'title')).toBe('nightly-digest')
    }, { timeout: 10_000 })
    expect(column('centerCol').textContent ?? '').not.toMatch(FORBIDDEN)
    expect(column('rightbarCol').textContent ?? '').not.toMatch(FORBIDDEN)

    const shape = `conversation\nplaceholder=${textOf(column('centerCol'), 'empty') ?? 'none'}\ndetail\n${detailShape()}`
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)

    // The started run joins the board as a ledger row with no session behind
    // it: the 进行中 group carries exactly that one row.
    fireEvent.click(within(column('sidebarCol')).getByRole('button', { name: /^In progress/ }))
    await waitFor(() => {
      expect(boardShape()).toContain('row=nightly-digest')
    }, { timeout: 10_000 })
  })
})
