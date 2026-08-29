// @vitest-environment jsdom
// Assembled approval-board snapshot (fork ticket #58): boots the fork roster's
// real built workspace client bundles through AppWebEntry's ModuleLoader path
// against the keyless FixtureApiClient transport (no API key, no model round)
// and pins the 审批待办 surface — the cold-start mux-open replay restoring the
// 等待你确认 group (count + row + 等待确认 status) before any session is
// opened, the in-conversation approval card (「<任务名> 请你确认：<业务动作
// 摘要>」 headline, raw command folded into the details expander, tool name
// never rendered), and both answer closures: 同意 drops the card and returns
// the row to 进行中, and 拒绝 with a note resolves the approval and rides the
// note back into the conversation as a user row. The per-package suites bench
// over src and cannot see the bundled wiring; this is the assembled-output
// check that a dropped slot registration, a broken pending-replay path, or a
// leaked tool name fails.
//
// Keyless and deterministic: the fixture is the fake server, so the pending
// approval, its paired call, and the note echo are fixed in the fixture, not
// harvested from a live engine. Date is pinned so the row's 最近动态 label
// stays a fixed bucket.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const DIR = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/task-approval')
const expected = (name: string): string => join(DIR, `${name}.expected.txt`)

installAssembledBootEnv()

// The fixture's sessions anchor at boot time; pinning Date here makes every
// "Last activity …" label a fixed bucket.
const PINNED_NOW = new Date('2026-08-25T09:00:00.000Z')
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(PINNED_NOW)
})
afterEach(() => { vi.useRealTimers() })

/** Product vocabulary rule: run/session/journal wording stays off the task surface. */
const FORBIDDEN = /\b(runs?|ran|running|sessions?|journals?)\b/i

/** Match CSS-module class by logical name (the scaffold's hasClass) over a subtree. */
function pick(root: ParentNode, name: string): Element[] {
  return [...root.querySelectorAll('*')].filter(el => hasClass(el, name))
}

/** One shell column by its AppFrame module class. */
function column(name: 'sidebarCol' | 'centerCol'): HTMLElement {
  const el = pick(document.body, name)[0]
  if (el === undefined) throw new Error(`assembled frame column ${name} is not rendered`)
  return el as HTMLElement
}

/** Trimmed text of the first element carrying the module class, undefined when absent. */
function textOf(root: ParentNode, name: string): string | undefined {
  return pick(root, name)[0]?.textContent?.trim() ?? undefined
}

/** Normalize the nav group buttons to `group=<label> count=<n>` lines. */
function groupsShape(): string {
  const groups = pick(column('sidebarCol'), 'groups')[0]
  if (groups === undefined) throw new Error('nav groups missing')
  return [...groups.querySelectorAll('button')]
    .map(button => `group=${textOf(button, 'rowLabel')} count=${textOf(button, 'count')}`)
    .join('\n')
}

/** Normalize the middle column's pending-group list rows. */
function listShape(): string {
  const list = pick(column('centerCol'), 'list')[0]
  if (list === undefined) return 'empty'
  return [...list.querySelectorAll('button')]
    .map(row => `row=${textOf(row, 'title')}|status=${textOf(row, 'status') ?? '-'}|activity=${textOf(row, 'activity') ?? '-'}`)
    .join('\n')
}

/** Normalize the pinned approval card: headline, folded detail, actions, tool-name leak check. */
function cardShape(): string {
  const card = document.querySelector('[data-approval-card]')
  if (card === null) return 'card=absent'
  return [
    `headline=${textOf(card, 'headline') ?? 'none'}`,
    `detail=${textOf(card, 'detailBody') ?? 'none'}`,
    `actions=${[...card.querySelectorAll('button')].map(button => button.textContent?.trim()).join(',')}`,
    `toolname=${/dangerous_tool/.test(card.textContent ?? '') ? 'leaked' : 'absent'}`,
  ].join('\n')
}

/** Write-then-compare one scenario golden (the lanes' record/replay pattern). */
async function snap(name: string, shape: string): Promise<void> {
  const path = expected(name)
  if (REFRESHING_GOLDEN) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, shape)
  }
  await expect(shape).toMatchFileSnapshot(path)
}

/** Boot, then settle on the 等待你确认 group with the replayed fx-alpha row. */
async function openPendingGroup(): Promise<void> {
  await screen.findByRole('button', { name: 'New Task' }, { timeout: 10_000 })
  // Cold start: the mux-open replay carries the pending approval, so the group
  // count reaches 1 before any session is opened.
  await waitFor(() => {
    const pending = within(column('sidebarCol')).getByRole('button', { name: /^Awaiting your confirmation/ })
    expect(pending.textContent).toMatch(/1/)
  }, { timeout: 10_000 })
  fireEvent.click(within(column('sidebarCol')).getByRole('button', { name: /^Awaiting your confirmation/ }))
  await waitFor(() => {
    const buttons = [...pick(column('centerCol'), 'list')[0]?.querySelectorAll('button') ?? []]
    expect(buttons).toHaveLength(1)
  }, { timeout: 10_000 })
}

/** Click through the pending row into the task's conversation (the card mounts). */
function openPendingTask(): void {
  const rows = [...pick(column('centerCol'), 'list')[0]?.querySelectorAll('button') ?? []] as HTMLButtonElement[]
  fireEvent.click(rows[0]!)
}

describe('assembled approval board', () => {
  it('restores the pending group from the mux replay and closes 同意 back to the engine', async () => {
    mountAssembledApp()
    await openPendingGroup()
    // The replayed board: the group carries the fx-alpha row with the 等待确认
    // status copy before anything is opened.
    const sidebar = column('sidebarCol')
    expect(sidebar.textContent ?? '').not.toMatch(FORBIDDEN)
    await snap('cold-start', [groupsShape(), listShape()].join('\n'))

    openPendingTask()
    // The replayed card: task title headline, raw command folded into details.
    await waitFor(() => {
      expect(document.querySelector('[data-approval-card]')).not.toBeNull()
    }, { timeout: 10_000 })
    const center = column('centerCol')
    expect(center.textContent ?? '').not.toMatch(FORBIDDEN)
    expect(cardShape()).toContain('rm -rf /tmp/build-cache')
    await snap('card', cardShape())

    // 同意: the answer rides the replayed wait, the resolved broadcast drops
    // the card, and the badge clears so the row returns to 进行中.
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => {
      expect(document.querySelector('[data-approval-card]')).toBeNull()
    }, { timeout: 10_000 })
    await waitFor(() => {
      const running = within(column('sidebarCol')).getByRole('button', { name: /^In progress/ })
      expect(running.textContent).toMatch(/1/)
    }, { timeout: 10_000 })
    await snap('after-approve', [groupsShape(), cardShape()].join('\n'))
  })

  it('rejects with a note and rides the note back into the conversation', async () => {
    mountAssembledApp()
    await openPendingGroup()
    openPendingTask()
    await waitFor(() => {
      expect(document.querySelector('[data-approval-card]')).not.toBeNull()
    }, { timeout: 10_000 })

    // 拒绝 opens the optional note row; confirming sends rejected plus the note.
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Add a note for the agent/ }), { target: { value: '先别删' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }))
    // The card drops with the resolution; the note lands as a user row and the
    // fixture's echo turn settles (the status row leaves when the turn ends).
    await waitFor(() => {
      expect(document.querySelector('[data-approval-card]')).toBeNull()
    }, { timeout: 10_000 })
    const center = column('centerCol')
    expect(center.textContent ?? '').not.toMatch(FORBIDDEN)
    const flow = pick(center, 'flow')[0]
    if (flow === undefined) throw new Error('conversation flow missing')
    await waitFor(() => {
      expect([...flow.querySelectorAll('*')].some(el => hasClass(el, 'userRow') && el.textContent?.includes('先别删'))).toBe(true)
    }, { timeout: 10_000 })
    await waitFor(() => {
      expect(pick(column('centerCol'), 'statusRow')[0]).toBeUndefined()
    }, { timeout: 10_000 })
    // The badge cleared with the answer: the row is back on the 进行中 group.
    await waitFor(() => {
      const running = within(column('sidebarCol')).getByRole('button', { name: /^In progress/ })
      expect(running.textContent).toMatch(/1/)
    }, { timeout: 10_000 })
    const noteRows = [...flow.querySelectorAll('*')].filter(el => hasClass(el, 'userRow')).map(el => el.textContent?.trim())
    await snap('after-reject', [groupsShape(), `note=${noteRows.at(-1) ?? 'none'}`].join('\n'))
  })
})
