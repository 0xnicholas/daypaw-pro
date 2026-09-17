/**
 * Wire contract between the daypaw client faces and the durable engine's
 * Remote endpoints: every payload `@daypaw/durable-client` posts and parses
 * must satisfy the real Typert gateway descriptor validation and the real
 * engine's serialization. The assembled golden lane boots against the fixture
 * transport, which answers without descriptor checks, so this spec is the
 * only executed proof of the args envelope the browser plane sends and the
 * rows it decodes — all seven endpoints of the client face ride it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService, { TypertGatewayError } from '@deepseek-ai/dsh-api-gateway'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { DurableEngine } from '@daypaw/sdk'
import type { Json } from '@daypaw/engine'
import { createDurableClient } from '@daypaw/durable-client/src/client/api.ts'

/** One unary RPC result, structurally the client face's caller dependency. */
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
 * @returns the RPC caller the durable client consumes.
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
            // Mirrors the gateway's rpcFailure: a vocabulary failure crosses
            // with its own code and details (ticket #86).
            : remoteErrorOf(error) ?? { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} },
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

/** Wait until the ledger row of one run carries one of the wanted statuses. */
async function awaitStatus(ctx: Context, runId: string, statuses: readonly string[]): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = (await ctx.durable.listRuns()).find(run => run.run_id === runId)
    if (row !== undefined && statuses.includes(row.status)) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('the durable client face against the live durable gateway', () => {
  it('lists the registered agent through the roster face', async () => {
    const ctx = await boot()
    await registerStarterAgent(ctx)
    const agents = await createDurableClient(gatewayRpc(ctx)).listDefinitions()
    expect(agents).toEqual([
      { name: 'contract-assistant', version: '1', display: { title: 'Contract assistant', description: 'Accepts one task string.' }, inputKind: 'text', kind: 'agent' },
    ])
  })

  it('starts a run from the dialog payload and reads it back through listRuns and runLineage', async () => {
    const ctx = await boot()
    await registerStarterAgent(ctx)
    const client = createDurableClient(gatewayRpc(ctx))
    const started = await client.startRun({
      defName: 'contract-assistant',
      defVersion: '1',
      input: 'write the report',
      runId: 'contract-run-1',
    })
    expect(started).toEqual({ runId: 'contract-run-1' })
    await awaitStatus(ctx, 'contract-run-1', ['done'])

    const runs = await client.listRuns()
    const own = runs.filter(run => run.defName === 'contract-assistant')
    expect(own).toHaveLength(1)
    const [ownRun] = own
    expect(ownRun).toMatchObject({
      runId: 'contract-run-1',
      defKind: 'agent',
      defName: 'contract-assistant',
      status: 'done',
      parentRunId: null,
      outputJson: JSON.stringify('done'),
    })
    expect(typeof ownRun?.updatedAt).toBe('number')

    const lineage = await client.runLineage('contract-run-1')
    expect(lineage.run?.runId).toBe('contract-run-1')
    expect(lineage.parent).toBeUndefined()
    expect(lineage.children).toEqual([])

    // An unknown run reads as absent members, not a failure.
    const unknown = await client.runLineage('contract-ghost')
    expect(unknown).toEqual({ run: undefined, parent: undefined, children: [] })
  })

  it('reruns a failed top-level run through the client face', async () => {
    const ctx = await boot()
    await ctx.durable.register({
      kind: 'agent',
      name: 'contract-failer',
      version: '1',
      display: { title: 'Contract failer', description: 'Fails once per run.' },
      body: async () => { throw new Error('first attempt fails') },
      wire: {
        inputKind: 'text',
        parseInput: (value: unknown) => {
          if (typeof value !== 'string') throw new Error('input must be a task string')
          return { task: value }
        },
      },
    })
    const client = createDurableClient(gatewayRpc(ctx))
    await client.startRun({ defName: 'contract-failer', defVersion: '1', input: 'try', runId: 'contract-fail-1' })
    await awaitStatus(ctx, 'contract-fail-1', ['failed'])

    const rerunId = await client.rerun('contract-fail-1')
    expect(rerunId).not.toBe('contract-fail-1')
    await awaitStatus(ctx, rerunId, ['failed'])
    const rows = await client.listRuns()
    const rerunRow = rows.find(run => run.runId === rerunId)
    expect(rerunRow?.status).toBe('failed')
  })

  it('reads a run journal through the timeline face (steps and steer segments)', async () => {
    const ctx = await boot()
    await ctx.durable.register({
      kind: 'agent',
      name: 'contract-journaler',
      version: '1',
      display: { title: 'Contract journaler', description: 'Records one step then parks.' },
      steerable: true,
      body: async (step) => {
        await step.step('collect', async () => 'collected')
        await step.awaitSteer(0)
        return step.steers()
      },
      wire: {
        inputKind: 'text',
        parseInput: (value: unknown) => {
          if (typeof value !== 'string') throw new Error('input must be a task string')
          return { task: value }
        },
      },
    })
    const client = createDurableClient(gatewayRpc(ctx))
    const started = await client.startRun({ defName: 'contract-journaler', defVersion: '1', input: 'collect', runId: 'contract-journal-1' })
    await awaitStatus(ctx, started.runId, ['running'])

    const segments = await client.journalTimeline(started.runId)
    const collect = segments.find(entry => entry.kind === 'step' && entry.stepKey === 'collect#0')
    expect(collect).toBeDefined()
    expect(collect).toMatchObject({ name: 'collect', occurrence: 0, status: 'completed' })
    expect(typeof collect?.finishedAt).toBe('number')
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
    const started = await createDurableClient(gatewayRpc(ctx)).startRun({
      defName: 'contract-waiter',
      defVersion: '1',
      input: 'wait for approval',
      runId: 'contract-wait-1',
    })
    await awaitStatus(ctx, started.runId, ['waiting'])
    await expect(ctx.typertGateway.invoke({
      namespace: 'durable',
      method: 'cancel',
      args: { runId: started.runId, cause: 'user abort' },
    })).resolves.toBeUndefined()
    const row = (await ctx.durable.listRuns()).find(run => run.run_id === started.runId)
    expect(row?.status).toBe('cancelled')
    expect(row?.cancel_cause).toBe('user abort')
  })

  it('steers a running text-kind agent through the client face with the wire face applied (ticket #94)', async () => {
    const ctx = await boot()
    await ctx.durable.register({
      kind: 'agent',
      name: 'contract-steerable',
      version: '1',
      display: { title: 'Contract steerable', description: 'Parks for steer segments.' },
      steerable: true,
      body: async (step) => {
        await step.awaitSteer(0)
        return step.steers()
      },
      wire: {
        inputKind: 'text',
        parseInput: (value: unknown) => {
          if (typeof value !== 'string') throw new Error('input must be a task string')
          return { task: value }
        },
      },
    })
    const client = createDurableClient(gatewayRpc(ctx))
    const started = await client.startRun({
      defName: 'contract-steerable',
      defVersion: '1',
      input: 'count to five',
      runId: 'contract-steer-2',
    })
    await awaitStatus(ctx, started.runId, ['running'])
    // The browser follow-up seat sends the bare text through steerText; the
    // boundary applies the definition's wire face, so the recorded segment
    // carries the starter shape.
    await expect(client.steerText(started.runId, 'stop at three')).resolves.toBe(1)
    const segments = (await ctx.durable.journalTimeline(started.runId))
      .filter(entry => entry.kind === 'segment')
    expect(segments.map(entry => entry.value_json)).toEqual(['{"task":"stop at three"}'])
  })

  it('rejects a steer whose input fails the wire contract at the boundary (ticket #94)', async () => {
    const ctx = await boot()
    await ctx.durable.register({
      kind: 'agent',
      name: 'contract-json-only',
      version: '1',
      display: { title: 'Contract json-only', description: 'Takes structured input only.' },
      steerable: true,
      body: async (step) => {
        await step.awaitSteer(0)
        return step.steers()
      },
      wire: {
        inputKind: 'json',
        parseInput: (value: unknown) => {
          if (typeof value !== 'object' || value === null || !('rows' in value)) {
            throw new Error('input must be a rows object')
          }
          return value as Json
        },
      },
    })
    const client = createDurableClient(gatewayRpc(ctx))
    const started = await client.startRun({
      defName: 'contract-json-only',
      defVersion: '1',
      input: { rows: 1 },
      runId: 'contract-steer-3',
    })
    await awaitStatus(ctx, started.runId, ['running'])
    // A free-text follow-up on a json-kind definition fails the wire contract
    // at the boundary: nothing is recorded, so the run cannot fail later on a
    // consumption-side validation.
    await expect(client.steerText(started.runId, 'just a nudge')).rejects.toThrow('durable-client: durable/steerText failed (durable/input-invalid): input must be a rows object')
    const segments = (await ctx.durable.journalTimeline(started.runId))
      .filter(entry => entry.kind === 'segment')
    expect(segments).toHaveLength(0)
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

  it('carries the durable failure vocabulary across the gateway wire (ticket #86)', async () => {
    const ctx = await boot()
    await registerStarterAgent(ctx)
    // The browser's startRun lane: a definition-resolution failure crosses the
    // real gateway as the stable `durable/definition-not-found` code with
    // typed details — consumers discriminate by code, never by message text.
    await expect(createDurableClient(gatewayRpc(ctx)).startRun({
      defName: 'contract-ghost',
      defVersion: '1',
      input: 'write the report',
      runId: 'contract-vocab-1',
    })).rejects.toThrow(
      'durable-client: durable/startRun failed (durable/definition-not-found): durable engine: no registered definition matches contract-ghost',
    )
  })
})
