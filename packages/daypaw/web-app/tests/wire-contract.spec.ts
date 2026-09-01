/**
 * Wire contract between the daypaw client faces and the durable engine's
 * Remote endpoints: the payloads `@daypaw/ui-tasks` posts must satisfy the
 * real Typert gateway descriptor validation. The assembled golden lane boots
 * against the fixture transport, which answers without descriptor checks, so
 * this spec is the only executed proof of the args envelope the dialog sends.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService, { TypertGatewayError } from '@deepseek-ai/dsh-api-gateway'
import { DurableEngine } from '@daypaw/sdk'
import { createNewTaskApi } from '@daypaw/ui-tasks/src/client/new-task-api.ts'

/** One unary RPC result, structurally the dialog face's caller dependency. */
type UnaryResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.length = 0
})

/** Boot the real registry, gateway, and engine over an in-memory ledger. */
async function boot(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService)
  await ctx.plugin(DurableEngine, { path: ':memory:', pollMs: 20 })
  return ctx
}

/** Register the starter-shaped agent the dialog starts. */
async function registerStarterAgent(ctx: Context): Promise<void> {
  await ctx.durable.register({
    kind: 'agent',
    name: 'contract-assistant',
    version: '1',
    display: { title: 'Contract assistant', description: 'Accepts one task string.' },
    body: async () => 'done',
    wire: {
      inputKind: 'text',
      parseInput: (value: unknown) => {
        if (typeof value !== 'string') throw new Error('input must be a task string')
        return { task: value }
      },
    },
  })
}

/**
 * The browser unary boundary as the gateway serves it: one plain-object
 * `args` envelope per endpoint, dispatched through the live descriptor.
 * @param ctx - gateway-owning Context.
 * @returns the RPC caller the dialog face consumes.
 */
function gatewayRpc(ctx: Context): { call(channel: string, endpoint: string, payload: unknown): Promise<UnaryResult> } {
  return {
    async call(_channel: string, endpoint: string, payload: unknown): Promise<UnaryResult> {
      try {
        const value = await ctx.typertGateway.invoke(remoteRequest(endpoint, payload))
        return { ok: true, value }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof TypertGatewayError
            ? { code: error.code, message: error.message, details: {} }
            : { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} },
        }
      }
    },
  }
}

/** Decode one endpoint call the way the gateway's unary dispatch does. */
function remoteRequest(endpoint: string, payload: unknown): { namespace: string; method: string; args: Record<string, unknown> } {
  const segments = endpoint.split('/')
  if (segments.length !== 2 || segments[0] === '' || segments[1] === '') {
    throw new Error(`invalid Remote endpoint ${JSON.stringify(endpoint)}`)
  }
  const args = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as { args?: unknown }).args
    : undefined
  if (typeof args !== 'object' || args === null || Array.isArray(args) || Object.keys(payload as object).length !== 1) {
    throw new Error('Remote payload must contain exactly one plain-object args field')
  }
  const [namespace, method] = segments as [string, string]
  return { namespace, method, args: args as Record<string, unknown> }
}

describe('new-task dialog against the live durable gateway', () => {
  it('lists the registered agent through the roster face', async () => {
    const ctx = await boot()
    await registerStarterAgent(ctx)
    const agents = await createNewTaskApi(gatewayRpc(ctx)).listDefinitions()
    expect(agents).toEqual([
      { name: 'contract-assistant', version: '1', display: { title: 'Contract assistant' }, inputKind: 'text' },
    ])
  })

  it('starts a run from the dialog payload', async () => {
    const ctx = await boot()
    await registerStarterAgent(ctx)
    const started = await createNewTaskApi(gatewayRpc(ctx)).startRun({
      defName: 'contract-assistant',
      defVersion: '1',
      input: 'write the report',
      runId: 'contract-run-1',
    })
    expect(started).toEqual({ runId: 'contract-run-1' })
    const rows = (await ctx.durable.listRuns()).filter(run => run.def_name === 'contract-assistant')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.run_id).toBe('contract-run-1')
    expect(rows[0]?.input_json).toBe('{"task":"write the report"}')
  })

  it('cancels a gate-waiting run through the gateway (ticket #74)', async () => {
    const ctx = await boot()
    await ctx.durable.register({
      kind: 'agent',
      name: 'contract-waiter',
      version: '1',
      display: { title: 'Contract waiter', description: 'Waits on one gate.' },
      body: async step => (await step.waitFor('approval', { timeout: 60_000 })).state,
      wire: {
        inputKind: 'text',
        parseInput: (value: unknown) => {
          if (typeof value !== 'string') throw new Error('input must be a task string')
          return { task: value }
        },
      },
    })
    const started = await createNewTaskApi(gatewayRpc(ctx)).startRun({
      defName: 'contract-waiter',
      defVersion: '1',
      input: 'wait for approval',
      runId: 'contract-wait-1',
    })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = (await ctx.durable.listRuns()).find(run => run.run_id === started.runId)
      if (row?.status === 'waiting') break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    await expect(ctx.typertGateway.invoke({
      namespace: 'durable',
      method: 'cancel',
      args: { runId: started.runId, cause: 'user abort' },
    })).resolves.toBeUndefined()
    const row = (await ctx.durable.listRuns()).find(run => run.run_id === started.runId)
    expect(row?.status).toBe('cancelled')
    expect(row?.cancel_cause).toBe('user abort')
  })

  it('rejects the request fields spread flat into args: the descriptor names the parameter', async () => {
    const ctx = await boot()
    await registerStarterAgent(ctx)
    await expect(ctx.typertGateway.invoke({
      namespace: 'durable',
      method: 'startRun',
      args: { defName: 'contract-assistant', defVersion: '1', input: 'write the report', runId: 'contract-run-1' },
    })).rejects.toThrow('args fields do not match the descriptor: unexpected "defName", "defVersion", "input", "runId"')
    expect(await ctx.durable.listRuns()).toHaveLength(0)
  })
})
