/** runs-api: the board/detail wire face — endpoint names and payloads, fail-loud wire-boundary validation. */
import { describe, expect, it } from 'vitest'
import { createRunsApi, type WireRun } from '../src/client/runs-api.ts'

const RUN: WireRun = {
  runId: 'r1',
  defKind: 'workflow',
  defName: 'close-the-books',
  status: 'running',
  parentRunId: null,
  outputJson: null,
  updatedAt: 100,
}

/** The run row as it crosses the wire (snake_case engine ledger columns). */
function wireRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: 'r1',
    def_kind: 'workflow',
    def_name: 'close-the-books',
    status: 'running',
    parent_run_id: null,
    output_json: null,
    updated_at: 100,
    ...overrides,
  }
}

function wireEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    step_key: 's1',
    name: 'collect invoices',
    occurrence: 1,
    kind: 'step',
    status: 'completed',
    session_id: null,
    started_at: 10,
    finished_at: 20,
    ...overrides,
  }
}

function rpcReturning(result: unknown): Parameters<typeof createRunsApi>[0] {
  return { call: () => Promise.resolve(result as never) }
}

function rpcRecording(result: unknown): { rpc: Parameters<typeof createRunsApi>[0]; calls: unknown[] } {
  const calls: unknown[] = []
  return {
    rpc: {
      call: (channel: string, endpoint: string, payload: unknown) => {
        calls.push([channel, endpoint, payload])
        return Promise.resolve(result as never)
      },
    },
    calls,
  }
}

describe('createRunsApi', () => {
  it('calls durable/listRuns on /api and validates each row', async () => {
    const { rpc, calls } = rpcRecording({ ok: true, value: [wireRun()] })
    const api = createRunsApi(rpc)
    expect(await api.listRuns()).toEqual([RUN])
    expect(calls).toEqual([['/api', 'durable/listRuns', { args: {} }]])
  })

  it('calls durable/runLineage with the runId and projects run/parent/children', async () => {
    const { rpc, calls } = rpcRecording({
      ok: true,
      value: { run: wireRun(), parent: null, children: [wireRun({ run_id: 'r2', parent_run_id: 'r1' })] },
    })
    const api = createRunsApi(rpc)
    expect(await api.runLineage('r1')).toEqual({
      run: RUN,
      parent: undefined,
      children: [{ ...RUN, runId: 'r2', parentRunId: 'r1' }],
    })
    expect(calls).toEqual([['/api', 'durable/runLineage', { args: { runId: 'r1' } }]])
  })

  it('accepts absent lineage members (an unknown runId answers all-empty)', async () => {
    const api = createRunsApi(rpcReturning({ ok: true, value: { parent: null, children: [] } }))
    expect(await api.runLineage('nope')).toEqual({ run: undefined, parent: undefined, children: [] })
  })

  it('calls durable/journalTimeline with the runId and validates each entry', async () => {
    const { rpc, calls } = rpcRecording({ ok: true, value: [wireEntry()] })
    const api = createRunsApi(rpc)
    expect(await api.journalTimeline('r1')).toEqual([{
      stepKey: 's1',
      name: 'collect invoices',
      occurrence: 1,
      kind: 'step',
      status: 'completed',
      sessionId: null,
      startedAt: 10,
      finishedAt: 20,
    }])
    expect(calls).toEqual([['/api', 'durable/journalTimeline', { args: { runId: 'r1' } }]])
  })

  it('calls durable/rerun with the runId and returns the new run id', async () => {
    const { rpc, calls } = rpcRecording({ ok: true, value: 'r9' })
    const api = createRunsApi(rpc)
    expect(await api.rerun('r1')).toBe('r9')
    expect(calls).toEqual([['/api', 'durable/rerun', { args: { runId: 'r1' } }]])
  })

  it('throws the endpoint error message on a wire error branch', async () => {
    const api = createRunsApi(rpcReturning({ ok: false, error: { code: 'internal', message: 'no engine', details: {} } }))
    await expect(api.listRuns()).rejects.toThrow('ui-inbox: durable/listRuns failed: no engine')
    await expect(api.runLineage('r1')).rejects.toThrow('ui-inbox: durable/runLineage failed: no engine')
    await expect(api.journalTimeline('r1')).rejects.toThrow('ui-inbox: durable/journalTimeline failed: no engine')
    await expect(api.rerun('r1')).rejects.toThrow('ui-inbox: durable/rerun failed: no engine')
  })

  it.each([
    ['a non-array listRuns payload', 'listRuns', { ok: true, value: { runs: [] } }, 'non-array'],
    ['a non-object listRuns entry', 'listRuns', { ok: true, value: [42] }, 'not an object'],
    ['a run entry missing run_id', 'listRuns', { ok: true, value: [wireRun({ run_id: 7 })] }, 'run_id'],
    ['a run entry missing def_name', 'listRuns', { ok: true, value: [wireRun({ def_name: 7 })] }, 'def_name'],
    ['a run entry with an unknown def_kind', 'listRuns', { ok: true, value: [wireRun({ def_kind: 'robot' })] }, 'def_kind'],
    ['a run entry with an unknown status', 'listRuns', { ok: true, value: [wireRun({ status: 'asleep' })] }, 'status'],
    ['a run entry with a bad parent_run_id', 'listRuns', { ok: true, value: [wireRun({ parent_run_id: 7 })] }, 'parent_run_id'],
    ['a run entry with a bad output_json', 'listRuns', { ok: true, value: [wireRun({ output_json: 7 })] }, 'output_json'],
    ['a run entry with a bad updated_at', 'listRuns', { ok: true, value: [wireRun({ updated_at: 'now' })] }, 'updated_at'],
    ['a non-object lineage payload', 'runLineage', { ok: true, value: 42 }, 'not an object'],
    ['a lineage with a bad run member', 'runLineage', { ok: true, value: { run: 42, parent: null, children: [] } }, 'not an object'],
    ['a lineage with a bad parent member', 'runLineage', { ok: true, value: { run: null, parent: 'x', children: [] } }, 'not an object'],
    ['a lineage with a non-array children member', 'runLineage', { ok: true, value: { run: null, parent: null, children: {} } }, 'non-array'],
    ['a non-array journalTimeline payload', 'journalTimeline', { ok: true, value: {} }, 'non-array'],
    ['a non-object journal entry', 'journalTimeline', { ok: true, value: [42] }, 'not an object'],
    ['a journal entry missing step_key/name', 'journalTimeline', { ok: true, value: [wireEntry({ step_key: 1 })] }, 'step_key'],
    ['a journal entry with a bad occurrence', 'journalTimeline', { ok: true, value: [wireEntry({ occurrence: 'x' })] }, 'occurrence'],
    ['a journal entry with an unknown kind', 'journalTimeline', { ok: true, value: [wireEntry({ kind: 'leap' })] }, 'kind'],
    ['a journal entry with an unknown status', 'journalTimeline', { ok: true, value: [wireEntry({ status: 'ok' })] }, 'status'],
    ['a journal entry with a bad session_id', 'journalTimeline', { ok: true, value: [wireEntry({ session_id: 7 })] }, 'session_id'],
    ['a journal entry with a bad started_at', 'journalTimeline', { ok: true, value: [wireEntry({ started_at: 'x' })] }, 'started_at'],
    ['a journal entry with a bad finished_at', 'journalTimeline', { ok: true, value: [wireEntry({ finished_at: 'x' })] }, 'finished_at'],
    ['a non-string rerun result', 'rerun', { ok: true, value: 42 }, 'non-string'],
  ])('throws on %s', async (_label, method, result, match) => {
    const api = createRunsApi(rpcReturning(result))
    const byMethod = {
      listRuns: () => api.listRuns(),
      runLineage: () => api.runLineage('r1'),
      journalTimeline: () => api.journalTimeline('r1'),
      rerun: () => api.rerun('r1'),
    } as const
    const call = byMethod[method as keyof typeof byMethod]()
    // Every failure is fail-loud with the ui-inbox: prefix and names the field.
    await expect(call).rejects.toThrow('ui-inbox:')
    await expect(call).rejects.toThrow(match)
  })
})
