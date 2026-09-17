/** The durable client: the `{ args }` envelope, the ok/error unwrap, and the answer checks. */
import { describe, expect, it } from 'vitest'
import type { ClientConnectionRpc, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { createDurableClient } from '../src/client/api.ts'

/** One captured call: the endpoint and the payload the client posted. */
interface CapturedCall {
  endpoint: string
  payload: unknown
}

/**
 * A fake RPC caller answering from a script and recording every call.
 * @param script - endpoint → answer (a plain value or a wire failure).
 * @param calls - the capture sink.
 * @returns the caller `createDurableClient` consumes.
 */
function scriptedRpc(script: Record<string, unknown>, calls: CapturedCall[] = []): Pick<ClientConnectionRpc, 'call'> {
  return {
    async call(_channel: string, endpoint: string, payload: unknown): Promise<ConnectionRpcResult<unknown>> {
      calls.push({ endpoint, payload })
      const answer = script[endpoint]
      if (typeof answer === 'object' && answer !== null && 'ok' in answer && answer.ok === false) {
        return answer as ConnectionRpcResult<unknown>
      }
      return { ok: true, value: answer }
    },
  }
}

/** A complete, valid run row (the wire shape the engine answers). */
const RUN_ROW = {
  run_id: 'run-1',
  def_kind: 'agent' as const,
  def_name: 'weekly-report',
  status: 'running' as const,
  parent_run_id: null,
  output_json: null,
  updated_at: 1_000,
}

describe('createDurableClient', () => {
  it('posts the args envelope and unwraps ok answers', async () => {
    const calls: CapturedCall[] = []
    const client = createDurableClient(scriptedRpc({
      'durable/listRuns': [RUN_ROW],
      'durable/runLineage': { run: RUN_ROW, parent: null, children: [RUN_ROW] },
      'durable/journalTimeline': [],
      'durable/rerun': 'run-2',
      'durable/listDefinitions': [{ kind: 'agent', name: 'a', version: '1', inputKind: null }],
      'durable/startRun': { runId: 'run-1' },
      'durable/steerText': 1,
    }, calls))
    await expect(client.listRuns()).resolves.toHaveLength(1)
    await expect(client.runLineage('run-1')).resolves.toEqual({
      run: { runId: 'run-1', defKind: 'agent', defName: 'weekly-report', status: 'running', parentRunId: null, outputJson: null, updatedAt: 1_000 },
      parent: undefined,
      children: [{ runId: 'run-1', defKind: 'agent', defName: 'weekly-report', status: 'running', parentRunId: null, outputJson: null, updatedAt: 1_000 }],
    })
    await expect(client.journalTimeline('run-1')).resolves.toEqual([])
    await expect(client.rerun('run-1')).resolves.toBe('run-2')
    await expect(client.listDefinitions()).resolves.toEqual([{ kind: 'agent', name: 'a', version: '1', inputKind: null }])
    await expect(client.startRun({ defName: 'a', defVersion: '1', input: 'task', runId: 'run-1' })).resolves.toEqual({ runId: 'run-1' })
    await expect(client.steerText('run-1', 'nudge')).resolves.toBe(1)
    expect(calls).toEqual([
      { endpoint: 'durable/listRuns', payload: { args: {} } },
      { endpoint: 'durable/runLineage', payload: { args: { runId: 'run-1' } } },
      { endpoint: 'durable/journalTimeline', payload: { args: { runId: 'run-1' } } },
      { endpoint: 'durable/rerun', payload: { args: { runId: 'run-1' } } },
      { endpoint: 'durable/listDefinitions', payload: { args: {} } },
      { endpoint: 'durable/startRun', payload: { args: { request: { defName: 'a', defVersion: '1', input: 'task', runId: 'run-1' } } } },
      { endpoint: 'durable/steerText', payload: { args: { runId: 'run-1', text: 'nudge' } } },
    ])
  })

  it('fails loud with the endpoint and wire failure code on error answers', async () => {
    const client = createDurableClient(scriptedRpc({
      'durable/startRun': { ok: false, error: { code: 'durable/definition-not-found', message: 'no registered definition matches ghost', details: {} } },
    }))
    await expect(client.startRun({ defName: 'ghost', defVersion: '1', input: 'task', runId: 'run-1' }))
      .rejects.toThrow('durable-client: durable/startRun failed (durable/definition-not-found): no registered definition matches ghost')
  })

  it('rejects malformed answers: non-arrays, non-objects, wrong member types', async () => {
    const client = createDurableClient(scriptedRpc({
      'durable/listRuns': 'not an array',
      'durable/runLineage': { run: null, parent: null, children: 'not an array' },
      'durable/journalTimeline': 'not an array',
      'durable/listDefinitions': 'not an array',
      'durable/rerun': 7,
      'durable/startRun': { noRunId: true },
      'durable/steerText': '1',
    }))
    await expect(client.listRuns()).rejects.toThrow('durable-client: durable/listRuns answered a non-array')
    await expect(client.runLineage('run-1')).rejects.toThrow('durable-client: durable/runLineage children is a non-array')
    await expect(client.journalTimeline('run-1')).rejects.toThrow('durable-client: durable/journalTimeline answered a non-array')
    await expect(client.listDefinitions()).rejects.toThrow('durable-client: durable/listDefinitions answered a non-array')
    await expect(client.rerun('run-1')).rejects.toThrow('durable-client: durable/rerun answered a non-string run id')
    await expect(client.startRun({ defName: 'a', defVersion: '1', input: 'task', runId: 'run-1' }))
      .rejects.toThrow('durable-client: durable/startRun answered no run id')
    await expect(client.steerText('run-1', 'nudge')).rejects.toThrow('durable-client: durable/steerText answered a non-number segment ordinal')
  })

  it('rejects a non-object lineage payload and a non-object startRun answer', async () => {
    const nonObject = createDurableClient(scriptedRpc({ 'durable/runLineage': 'not an object' }))
    await expect(nonObject.runLineage('run-1')).rejects.toThrow('durable-client: durable/runLineage payload is not an object')
    const bare = createDurableClient(scriptedRpc({ 'durable/startRun': 'not an object' }))
    await expect(bare.startRun({ defName: 'a', defVersion: '1', input: 'task', runId: 'run-1' }))
      .rejects.toThrow('durable-client: durable/startRun answer is not an object')
  })
})
