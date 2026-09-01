/**
 * Fixture daypaw durable lane: the `durable/*` Remote endpoints over the seeded
 * run ledger (list/lineage/timeline/rerun) and the approvalHistory projection
 * fold (control-stream baseline plus live advance on asked/decided appends).
 */
import { describe, expect, it } from 'vitest'
import type { ClientConnectionRpc } from '../src/client/index.ts'
import { createFixtureFaces } from '../src/client/fixture.ts'

interface TimingHooks {
  appendApproval(id: string, approvalId: string, toolName: string, outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'): void
}
const timing = (): TimingHooks => (globalThis as Record<string, unknown>).__fxTiming as TimingHooks

/** Drive one durable Remote endpoint against the fixture state graph. */
async function callRemote<T>(
  rpc: ReturnType<typeof createFixtureFaces>['rpc'],
  endpoint: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await rpc.call('/api', endpoint, { args })
  if (!result.ok) throw new Error(`${endpoint} failed: ${result.error.code}`)
  return result.value as T
}

interface RunRow {
  run_id: string
  def_kind: string
  def_name: string
  def_version: string
  input_json: string
  status: string
  parent_run_id: string | null
  parent_step_key: string | null
  attempt: number
  retried_from_run_id: string | null
  output_json: string | null
  error_json: string | null
  created_at: number
  finished_at: number | null
}

interface JournalRow {
  run_id: string
  step_key: string
  name: string
  status: string
}

describe('fixture durable endpoints', () => {
  it('lists every run newest-first, honoring the optional status filter', async () => {
    const { rpc } = createFixtureFaces()
    const all = await callRemote<RunRow[]>(rpc, 'durable/listRuns', {})
    // created_at DESC: the running agent run (aliasing the fx-alpha session) leads.
    expect(all.map(row => row.run_id)).toEqual([
      'fx-alpha',
      'fx-run-invoice-audit:sub:1',
      'fx-run-invoice-audit',
      'fx-run-release-digest',
    ])
    expect(all[0]).toMatchObject({ def_kind: 'agent', def_name: 'weekly-report', status: 'running' })
    expect(all[3]).toMatchObject({ def_kind: 'workflow', status: 'done' })
    expect(all[3]!.finished_at).not.toBeNull()
    expect(JSON.parse(all[3]!.output_json!)).toEqual({ summary: 'Shipped the durable tasks board and two follow-up fixes.', count: 3 })

    const failed = await callRemote<RunRow[]>(rpc, 'durable/listRuns', { status: 'failed' })
    expect(failed.map(row => row.run_id)).toEqual(['fx-run-invoice-audit:sub:1', 'fx-run-invoice-audit'])
    expect(await callRemote<RunRow[]>(rpc, 'durable/listRuns', { status: 'cancelled' })).toEqual([])
  })

  it('answers run lineage: own row, parent, and direct children oldest-first', async () => {
    const { rpc } = createFixtureFaces()
    const top = await callRemote<{ run?: RunRow; parent?: RunRow; children: RunRow[] }>(
      rpc, 'durable/runLineage', { runId: 'fx-run-invoice-audit' })
    expect(top.run?.run_id).toBe('fx-run-invoice-audit')
    expect(top.parent).toBeUndefined()
    expect(top.children.map(row => row.run_id)).toEqual(['fx-run-invoice-audit:sub:1'])
    const topError = JSON.parse(top.run!.error_json!) as { message: string }
    expect(topError.message).toContain('audit-line-items')

    const child = await callRemote<{ run?: RunRow; parent?: RunRow; children: RunRow[] }>(
      rpc, 'durable/runLineage', { runId: 'fx-run-invoice-audit:sub:1' })
    expect(child.parent?.run_id).toBe('fx-run-invoice-audit')
    expect(child.run?.parent_step_key).toBe('audit-line-items')
    expect(child.children).toEqual([])

    const unknown = await callRemote<{ run?: RunRow; parent?: RunRow; children: RunRow[] }>(
      rpc, 'durable/runLineage', { runId: 'fx-run-ghost' })
    expect(unknown).toEqual({ run: undefined, parent: undefined, children: [] })
  })

  it('serves the run journal in start order and an empty timeline for journal-less runs', async () => {
    const { rpc } = createFixtureFaces()
    const steps = await callRemote<JournalRow[]>(rpc, 'durable/journalTimeline', { runId: 'fx-run-release-digest' })
    expect(steps.map(row => [row.step_key, row.name, row.status])).toEqual([
      ['collect-updates', 'Collect team updates', 'completed'],
      ['draft-report', 'Draft the report', 'completed'],
      ['publish-summary', 'Publish the summary', 'completed'],
    ])
    expect(await callRemote<JournalRow[]>(rpc, 'durable/journalTimeline', { runId: 'fx-alpha' })).toEqual([])
  })

  it('rerun appends a fresh running row chaining the source, visible to the next listRuns poll', async () => {
    const { rpc } = createFixtureFaces()
    const before = await callRemote<RunRow[]>(rpc, 'durable/listRuns', {})
    const newId = await callRemote<string>(rpc, 'durable/rerun', { runId: 'fx-run-invoice-audit' })
    expect(newId).toMatch(/^fx-rerun-\d+$/)

    const after = await callRemote<RunRow[]>(rpc, 'durable/listRuns', {})
    expect(after.length).toBe(before.length + 1)
    // Newest created_at: the rerun row tops the next poll.
    expect(after[0]).toMatchObject({
      run_id: newId,
      def_kind: 'agent',
      def_name: 'invoice-checker',
      status: 'running',
      attempt: 2,
      retried_from_run_id: 'fx-run-invoice-audit',
    })

    const missing = await rpc.call('/api', 'durable/rerun', { args: { runId: 'fx-run-ghost' } })
    expect(missing).toMatchObject({ ok: false, error: { code: 'internal', message: 'no run fx-run-ghost' } })
  })
})

describe('fixture durable startRun', () => {
  it('starts a run with a dialog-minted id, coerces the starter text shape, and lists the session twin', async () => {
    const { rpc } = createFixtureFaces()
    const runId = 'fx-started-by-dialog'
    const started = await callRemote<{ runId: string }>(rpc, 'durable/startRun', {
      request: { defName: 'starter-assistant', defVersion: '1.0.0', input: 'write a poem', runId },
    })
    expect(started.runId).toBe(runId)

    const rows = await callRemote<RunRow[]>(rpc, 'durable/listRuns', {})
    const row = rows.find(candidate => candidate.run_id === runId)
    // The free text was wrapped into the starter `{ task }` contract value.
    expect(row).toMatchObject({ def_kind: 'agent', def_name: 'starter-assistant', def_version: '1.0.0', status: 'running' })
    expect(row!.input_json).toBe('{"task":"write a poem"}')

    // The session twin exists (sessionId ≡ runId) and carries the first turn
    // (the input's JSON serialization as the first user message, ADR 0010).
    const listed = await callRemote<{ items: { sessionId: string }[] }>(rpc, 'session/list', {})
    expect(listed.items.map(item => item.sessionId)).toContain(runId)

    // Start-or-attach: the same run id answers without a second row.
    const again = await callRemote<{ runId: string }>(rpc, 'durable/startRun', {
      request: { defName: 'starter-assistant', defVersion: '1.0.0', input: 'write a poem', runId },
    })
    expect(again.runId).toBe(runId)
    expect((await callRemote<RunRow[]>(rpc, 'durable/listRuns', {})).filter(candidate => candidate.run_id === runId)).toHaveLength(1)
  })

  it('mints a fresh run id when the caller passes none', async () => {
    const { rpc } = createFixtureFaces()
    const started = await callRemote<{ runId: string }>(rpc, 'durable/startRun', {
      request: { defName: 'invoice-checker', input: { invoice: 'INV-2044' } },
    })
    expect(started.runId).toMatch(/^fx-run-start-\d+$/)
    const row = (await callRemote<RunRow[]>(rpc, 'durable/listRuns', {})).find(candidate => candidate.run_id === started.runId)
    // A json-kind input crosses as given, no text coercion.
    expect(row!.input_json).toBe('{"invoice":"INV-2044"}')
  })

  it('rejects an unregistered definition name', async () => {
    const { rpc } = createFixtureFaces()
    const missing = await rpc.call('/api', 'durable/startRun', { args: { request: { defName: 'ghost-agent', input: 'x' } } })
    expect(missing).toMatchObject({ ok: false, error: { code: 'internal', message: 'no registered definition matches ghost-agent' } })
    const wrongVersion = await rpc.call('/api', 'durable/startRun', { args: { request: { defName: 'starter-assistant', defVersion: '9.9.9', input: 'x' } } })
    expect(wrongVersion).toMatchObject({ ok: false, error: { code: 'internal', message: 'no registered definition matches starter-assistant@9.9.9' } })
  })
})

describe('fixture approvalHistory projection', () => {
  const openControl = (rpc: ClientConnectionRpc, signal: AbortSignal): AsyncIterable<unknown> => {
    const stream = rpc.open?.('/api', 'session/control', { args: {} }, signal)
    if (stream === undefined) throw new Error('fixture control stream is unavailable')
    return stream
  }

  it('replays the seeded pairs in the control baseline', async () => {
    const { rpc } = createFixtureFaces()
    const abort = new AbortController()
    for await (const frame of openControl(rpc, abort.signal)) {
      const baseline = frame as {
        type: string
        value: { projections: Record<string, { values: Record<string, unknown> }> }
      }
      if (baseline.type !== 'baseline') continue
      abort.abort()
      expect(baseline.value.projections['fx-alpha']?.values['approvalHistory']).toEqual([
        { id: 'fx-approval-hist-1', toolName: 'bash', reason: '写入工作区外路径', outcome: 'allowed-once' },
        { id: 'fx-approval-hist-2', toolName: 'write', outcome: 'rejected' },
      ])
      return
    }
    throw new Error('fixture control baseline missing')
  })

  it('pushes a live approvalHistory frame on each asked/decided append', async () => {
    const { rpc } = createFixtureFaces()
    const abort = new AbortController()
    const framesPromise = (async (): Promise<unknown[]> => {
      const frames: unknown[] = []
      for await (const frame of openControl(rpc, abort.signal)) {
        frames.push(frame)
        if (frames.filter(f => (f as { type: string; key?: string }).type === 'projection'
          && (f as { key?: string }).key === 'approvalHistory').length >= 2) abort.abort()
      }
      return frames
    })()
    await new Promise(resolve => setTimeout(resolve, 10))
    timing().appendApproval('fx-alpha', 'fx-approval-live-1', 'web_fetch', 'rejected')
    const frames = await framesPromise
    const history = frames
      .filter((f): f is { type: 'projection'; key: string; value: { id: string; toolName: string; outcome?: string }[] } =>
        (f as { type: string }).type === 'projection' && (f as { key?: string }).key === 'approvalHistory')
      .map(f => f.value)
    // Asked (outcome pending), then decided (paired).
    expect(history.length).toBe(2)
    expect(history[0]?.at(-1)).toEqual({ id: 'fx-approval-live-1', toolName: 'web_fetch' })
    expect(history[1]?.at(-1)).toEqual({ id: 'fx-approval-live-1', toolName: 'web_fetch', outcome: 'rejected' })
  })
})
