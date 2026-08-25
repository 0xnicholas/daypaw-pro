// @vitest-environment jsdom
// Assembled task-progress snapshot (fork ticket #57): boots the fork roster's
// real built workspace client bundles through AppWebEntry's ModuleLoader path
// against the keyless FixtureApiClient transport (no API key, no model round)
// and pins the engine-fed inbox board — the 进行中/已完成 group counts and
// rows projected from the durable run ledger joined to the sessions list, an
// agent task's conversation + four-section detail (including the
// approvalHistory projection rows), a session-less workflow run's step
// timeline and output_json deliverables, and a failed run's 出错了 + 重试
// rerun landing back on the board through the poll. The per-package suites
// bench over src and cannot see the bundled wiring; this is the
// assembled-output check that a dropped slot registration, a broken
// listRuns/runLineage/journalTimeline/rerun wire projection, or leaked
// run/session/journal wording fails.
//
// Keyless and deterministic: the fixture is the fake server, so the ledger
// rows, step names, outputs, and approval pairs are fixed in the fixture, not
// harvested from a live engine. The wall clock is pinned (Date only — the
// board poll keeps real timers) so the list's 最近动态 relative-time labels
// over the fixture's fixed ledger epoch survive between record and replay.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const DIR = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/task-progress')
const expected = (name: string): string => join(DIR, `${name}.expected.txt`)

installAssembledBootEnv()

// The fixture's ledger timestamps anchor at FX_RUN_EPOCH (2026-08-20); pinning
// Date here (timers stay real for the 2s board poll and testing-library) makes
// every "Last activity …" label a fixed bucket.
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
function column(name: 'sidebarCol' | 'centerCol' | 'detailsCol'): HTMLElement {
  const el = pick(document.body, name)[0]
  if (el === undefined) throw new Error(`assembled frame column ${name} is not rendered`)
  return el as HTMLElement
}

/** Trimmed text of the first element carrying the module class, undefined when absent. */
function textOf(root: ParentNode, name: string): string | undefined {
  return pick(root, name)[0]?.textContent?.trim() ?? undefined
}

/** Normalize the nav group counts plus the middle column's group list to stable lines. */
function boardShape(): string {
  const lines: string[] = []
  const groups = pick(column('sidebarCol'), 'groups')[0]
  for (const button of groups?.querySelectorAll('button') ?? []) {
    lines.push(`group=${textOf(button, 'rowLabel')} count=${textOf(button, 'count')}`)
  }
  const center = column('centerCol')
  lines.push(`title=${textOf(center, 'title') ?? 'none'}`)
  const list = pick(center, 'list')[0]
  if (list === undefined) {
    lines.push(`empty=${textOf(center, 'empty') ?? 'none'}`)
    return lines.join('\n')
  }
  for (const item of list.children) {
    const row = item.querySelector('button')
    if (row === null) continue
    lines.push(`row=${textOf(row, 'title')}|agent=${textOf(row, 'agent') ?? '-'}|status=${textOf(row, 'status') ?? '-'}|activity=${textOf(row, 'activity') ?? '-'}`)
  }
  return lines.join('\n')
}

/** Normalize the right column: header (title, status, retry affordance) then one block per detail section. */
function detailShape(): string {
  const details = column('detailsCol')
  const lines: string[] = []
  const header = pick(details, 'header')[0]
  lines.push(`header=${header === undefined ? 'none' : (textOf(header, 'title') ?? 'none')}`)
  if (header !== undefined) {
    const status = textOf(header, 'status')
    if (status !== undefined) lines.push(`status=${status}`)
    lines.push(`retry=${pick(header, 'retry').length > 0}`)
  }
  for (const section of pick(details, 'section')) {
    lines.push(`section=${textOf(section, 'heading')}`)
    const rows = pick(section, 'row')
    if (rows.length === 0) {
      lines.push(`  empty=${textOf(section, 'empty') ?? 'none'}`)
      continue
    }
    for (const row of rows) {
      const label = textOf(row, 'rowLabel') ?? textOf(row, 'rowError')
      const value = textOf(row, 'rowStatus') ?? textOf(row, 'rowValue')
      lines.push(`  row=${[label, value].filter(part => part !== undefined).join('=')}`)
    }
  }
  return lines.join('\n')
}

/** Normalize the middle column's conversation view: status row, business rows in flow order, follow-up seat. */
function conversationShape(): string {
  const center = column('centerCol')
  const lines: string[] = []
  const view = pick(center, 'flow')[0]?.parentElement
  if (view === undefined || view === null) return `placeholder=${textOf(center, 'empty') ?? 'none'}`
  lines.push(`status=${textOf(view, 'statusRow') ?? 'none'}`)
  const kindOf = (row: Element): string => {
    if (hasClass(row, 'userRow')) return 'user'
    if (hasClass(row, 'assistantRow')) return 'assistant'
    if (hasClass(row, 'errorRow')) return 'error'
    return 'empty'
  }
  const flow = pick(view, 'flow')[0]
  for (const row of flow?.children ?? []) {
    lines.push(`${kindOf(row)}=${row.textContent?.trim() ?? ''}`)
  }
  return lines.join('\n')
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

/** The row buttons of the middle column's current group list. */
function listButtons(): HTMLButtonElement[] {
  const list = pick(column('centerCol'), 'list')[0]
  return [...(list?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]
}

describe('assembled task progress', () => {
  it('feeds the inbox board from the engine ledger and renders run details from the built bundles', async () => {
    mountAssembledApp()

    // ---- board-groups: the default 进行中 group after the board's first fetch.
    await screen.findByRole('button', { name: 'New Task' }, { timeout: 10_000 })
    await waitFor(() => { expect(listButtons()).toHaveLength(1) }, { timeout: 10_000 })
    const board = column('centerCol')
    expect(board.textContent ?? '').not.toMatch(FORBIDDEN)
    await snap('board-groups', boardShape())

    // ---- open-agent-task: the fx-alpha run row joins to its session twin.
    fireEvent.click(listButtons()[0]!)
    await waitFor(() => {
      expect(pick(column('centerCol'), 'flow')[0]?.children.length).toBeGreaterThan(0)
    }, { timeout: 10_000 })
    // The detail column's 审批历史 section arrives with the session baseline.
    await screen.findByText('写入工作区外路径', undefined, { timeout: 10_000 })
    const detail = column('detailsCol')
    expect(detail.textContent ?? '').not.toMatch(FORBIDDEN)
    await snap('open-agent-task', `conversation\n${conversationShape()}\ndetail\n${detailShape()}`)

    // ---- workflow-run-detail: the session-less done workflow run.
    fireEvent.click(within(column('sidebarCol')).getByRole('button', { name: /^Completed/ }))
    await waitFor(() => { expect(listButtons()).toHaveLength(4) }, { timeout: 10_000 })
    fireEvent.click(within(column('centerCol')).getByRole('button', { name: /release-digest/ }))
    await screen.findByText('Collect team updates', undefined, { timeout: 10_000 })
    const runDetail = column('detailsCol')
    expect(runDetail.textContent ?? '').not.toMatch(FORBIDDEN)
    await snap('workflow-run-detail', `conversation\n${conversationShape()}\ndetail\n${detailShape()}`)

    // ---- failed-task-retry: 出错了 + 重试, then the rerun row tops the next poll.
    // The workflow selection replaced the list with the run placeholder; reopen
    // the group to reach the failed row (an untwinned agent run routes through
    // the run selection, like a workflow row).
    fireEvent.click(within(column('sidebarCol')).getByRole('button', { name: /^Completed/ }))
    await waitFor(() => { expect(listButtons()).toHaveLength(4) }, { timeout: 10_000 })
    fireEvent.click(within(column('centerCol')).getByRole('button', { name: /invoice-checker/ }))
    // The failed child subtask row carries the failed status text.
    await screen.findByText('Something went wrong', undefined, { timeout: 10_000 })
    const failedDetail = column('detailsCol')
    expect(failedDetail.textContent ?? '').not.toMatch(FORBIDDEN)
    const retry = within(failedDetail).getByRole('button', { name: 'Retry' })
    const failedShape = `conversation\n${conversationShape()}\ndetail\n${detailShape()}`
    fireEvent.click(retry)
    // The retry dispatcher reruns, selects the running group, and kicks an
    // out-of-band board refresh; wait one full poll tick past that (real
    // timers, 2s cadence) so the captured board is the engine query surface's
    // own refresh, not only the kick.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2_500)) })
    await waitFor(() => {
      expect(listButtons().some(button => button.textContent?.includes('invoice-checker'))).toBe(true)
    }, { timeout: 10_000 })
    const retriedBoard = column('centerCol')
    expect(retriedBoard.textContent ?? '').not.toMatch(FORBIDDEN)
    await snap('failed-task-retry', `before-retry\n${failedShape}\nafter-retry\n${boardShape()}\ndetail\n${detailShape()}`)
  })
})
