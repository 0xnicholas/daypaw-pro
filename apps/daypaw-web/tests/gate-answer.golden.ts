// @vitest-environment jsdom
// Assembled gate-answer snapshot: boots the fork roster's real built workspace
// client bundles through AppWebEntry's ModuleLoader path against the keyless
// FixtureApiClient transport (no API key, no model round), reaches the waiting
// workflow run the fixture keeps parked on its durable gate, and answers it
// from the detail column's card (issue #128) — the approve path, the
// `durable/resolveGate` round trip, and the triage the row leaves behind. The
// per-package suites bench over src with fake transports and cannot see the
// bundled wiring; this is the assembled-output check that a pending gate is
// unreachable from the shell, or that its answer never leaves the browser.
//
// Keyless and deterministic: the fixture is the fake server, so the ledger
// rows, the gate name, and the settlement are fixed in the fixture, not
// harvested from a live engine. The fixture's own 2s board poll is real, so
// the triage assertion waits one tick past the settle.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/gate-answer/card.expected.txt')

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

/** The middle column's group list rows, title and status text. */
function listRows(): string[] {
  const list = pick(column('centerCol'), 'list')[0]
  return [...(list?.querySelectorAll('button') ?? [])].map(button => [
    textOf(button, 'title') ?? '',
    textOf(button, 'status') ?? '',
  ].join('='))
}

/** The detail column's header plus one line per section. */
function detailShape(): string {
  const details = column('rightbarCol')
  const lines: string[] = []
  const header = pick(details, 'header')[0]
  lines.push(`header=${header === undefined ? 'none' : (textOf(header, 'title') ?? 'none')}`)
  for (const section of pick(details, 'section')) {
    lines.push(`section=${textOf(section, 'heading')}`)
    lines.push(`  empty=${textOf(section, 'empty') ?? 'none'}`)
  }
  return lines.join('\n')
}

describe('assembled gate answer', () => {
  it('triages the parked run into 等待你确认 and answers its gate from the detail card', async () => {
    mountAssembledApp()

    // The waiting run joins the 等待你确认 triage beside the session approval
    // the fixture already carries.
    const pending = await screen.findByRole('button', { name: /^Awaiting your confirmation/ }, { timeout: 10_000 })
    await waitFor(() => { expect(pending.textContent).toMatch(/2/) }, { timeout: 10_000 })
    fireEvent.click(pending)
    await waitFor(() => {
      // The session approval's row carries the newer activity; the parked
      // run's gate row sits behind it.
      const rows = listRows()
      expect(rows).toHaveLength(2)
      expect(rows[1]).toBe('invoice-approval=Awaiting confirmation')
    }, { timeout: 10_000 })
    const pendingRows = listRows().join('|')
    // The parked row carries the gate's own name from the ledger, never a
    // translated stand-in.
    fireEvent.click(screen.getByRole('button', { name: /invoice-approval/ }))
    await waitFor(() => { expect(textOf(column('rightbarCol'), 'headline')).toBe('Waiting for your confirmation') }, { timeout: 10_000 })
    expect(column('rightbarCol').textContent ?? '').toContain('owner-approval')
    expect(column('rightbarCol').textContent ?? '').not.toMatch(FORBIDDEN)

    const shape = [
      `pendingRows=${pendingRows}`,
      `card=${textOf(column('rightbarCol'), 'headline') ?? 'none'}`,
      `gate=${textOf(column('rightbarCol'), 'gate') ?? 'none'}`,
      detailShape(),
    ].join('\n')
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, shape)
    }
    await expect(shape).toMatchFileSnapshot(EXPECTED)

    // Approve with a value the gate's contract takes: the card reports the
    // answer, and the run leaves the waiting triage on the next board poll.
    const detail = column('rightbarCol')
    fireEvent.change(within(detail).getByRole('textbox', { name: 'Response (JSON)' }), { target: { value: '{"approve":true}' } })
    fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }))
    await screen.findByText('Answered — the task continues', undefined, { timeout: 10_000 })
    await waitFor(() => {
      const stillWaiting = column('sidebarCol').textContent ?? ''
      expect(stillWaiting).toMatch(/Awaiting your confirmation\s*1/)
    }, { timeout: 10_000 })
  })
})
