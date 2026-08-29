/**
 * NewTaskApi wire module: roster validation (agent filter, display/inputKind guards) and startRun
 * result validation over a programmable RPC channel.
 */
import { describe, expect, it } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { createNewTaskApi } from '../src/client/new-task-api.ts'

/** Local structural RPC result envelope. */
type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: unknown } }

/** Programmable RPC channel: [endpoint, payload] calls recorded, answers scripted. */
function fakeRpc(answer: (endpoint: string, payload: unknown) => RpcResult<unknown>) {
  const calls: { endpoint: string; payload: unknown }[] = []
  const rpc = {
    call: (_channel: string, endpoint: string, payload: unknown): Promise<RpcResult<unknown>> => {
      calls.push({ endpoint, payload })
      return Promise.resolve(answer(endpoint, payload))
    },
  } as unknown as ClientConnectionRpc
  return { rpc, calls }
}

describe('createNewTaskApi roster', () => {
  it('keeps agent rows in registration order, dropping non-agent kinds', async () => {
    const { rpc } = fakeRpc(() => ({ ok: true, value: [
      { kind: 'agent', name: 'starter-assistant', version: '1.0.0', inputKind: 'text', display: { title: 'Starter assistant' } },
      { kind: 'workflow', name: 'release-digest', version: '0.4.0', inputKind: 'json' },
      { kind: 'agent', name: 'invoice-checker', version: '0.3.1', inputKind: null },
    ] }))
    const agents = await createNewTaskApi(rpc).listDefinitions()
    expect(agents).toEqual([
      { name: 'starter-assistant', version: '1.0.0', display: { title: 'Starter assistant' }, inputKind: 'text' },
      { name: 'invoice-checker', version: '0.3.1', inputKind: null },
    ])
  })

  it('fails loud when the endpoint answers a non-array', async () => {
    const { rpc } = fakeRpc(() => ({ ok: true, value: 'nope' }))
    await expect(createNewTaskApi(rpc).listDefinitions()).rejects.toThrow('answered a non-array')
  })

  it.each([
    ['a non-object entry', 42],
    ['a row missing name/version', { kind: 'agent', inputKind: 'text' }],
    ['a row with an unknown inputKind', { kind: 'agent', name: 'a', version: '1', inputKind: 'yaml' }],
    ['a non-object display', { kind: 'agent', name: 'a', version: '1', inputKind: 'text', display: 'x' }],
    ['a display without a title', { kind: 'agent', name: 'a', version: '1', inputKind: 'text', display: {} }],
  ])('fails loud on %s', async (_name, row) => {
    const { rpc } = fakeRpc(() => ({ ok: true, value: [row] }))
    await expect(createNewTaskApi(rpc).listDefinitions()).rejects.toThrow(/^ui-tasks: definition/)
  })
})

describe('createNewTaskApi startRun', () => {
  it('posts the request under /api and returns the answered run id', async () => {
    const { rpc, calls } = fakeRpc(() => ({ ok: true, value: { runId: 'r-answered' } }))
    const started = await createNewTaskApi(rpc).startRun({ defName: 'a', defVersion: '1', input: 'x', runId: 'r-minted' })
    expect(started).toEqual({ runId: 'r-answered' })
    expect(calls).toEqual([{ endpoint: 'durable/startRun', payload: { args: { defName: 'a', defVersion: '1', input: 'x', runId: 'r-minted' } } }])
  })

  it('fails loud when the endpoint answers a business failure', async () => {
    const { rpc } = fakeRpc(() => ({ ok: false, error: { code: 'internal', message: 'engine down', details: {} } }))
    await expect(createNewTaskApi(rpc).startRun({ defName: 'a', defVersion: '1', input: 'x', runId: 'r' }))
      .rejects.toThrow('durable/startRun failed: engine down')
  })

  it.each([
    ['a non-object answer', 'nope'],
    ['an answer without a run id', {}],
    ['an answer with a non-string run id', { runId: 7 }],
  ])('fails loud on %s', async (_name, value) => {
    const { rpc } = fakeRpc(() => ({ ok: true, value }))
    await expect(createNewTaskApi(rpc).startRun({ defName: 'a', defVersion: '1', input: 'x', runId: 'r' }))
      .rejects.toThrow('answered no run id')
  })
})
