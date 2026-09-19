import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import DurableEngine from '@daypaw/engine'
import { bind, defineAgent, defineWorkflow } from '@daypaw/sdk'
import type { WorkflowCtx } from '@daypaw/sdk'
import { z } from 'zod'

let root: string | undefined
let contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts = []
  if (root !== undefined) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 2) throw error
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
  }
  root = undefined
})

async function tmpPath(prefix: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix))
  return join(root, 'ledger.db')
}

async function bootEngine(path: string): Promise<DurableEngine> {
  const ctx = new Context()
  await ctx.plugin(DurableEngine, { path, pollMs: 10 })
  contexts.push(ctx)
  return ctx.durable
}

async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function readTable(path: string, table: 'runs' | 'promises' | 'journal'): Array<Record<string, unknown>> {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  } finally {
    db.close()
  }
}

function readRuns(path: string): Array<Record<string, unknown>> {
  return readTable(path, 'runs')
}

function readPromises(path: string): Array<Record<string, unknown>> {
  return readTable(path, 'promises')
}

function readJournal(path: string): Array<Record<string, unknown>> {
  return readTable(path, 'journal')
}

/** A child that ends `done` on its own: the parent never waits for it. */
const quickChild = defineWorkflow({
  name: 'quick-child',
  version: '1',
  input: z.object({ tag: z.string() }),
  output: z.object({ echo: z.string() }),
  body: async (ctx, input) => ({ echo: await ctx.step('work', async () => input.tag) }),
})

describe('ctx.spawn', () => {
  it('starts a child under a derived id, records the linkage, and returns that id without waiting', async () => {
    const path = await tmpPath('daypaw-spawn-happy-')
    const engine = await bootEngine(path)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const heldChild = defineWorkflow({
      name: 'held-child',
      version: '1',
      input: z.object({ tag: z.string() }),
      output: z.object({ echo: z.string() }),
      body: async (ctx, input) => ({ echo: await ctx.step('slow', async () => { await gate; return input.tag }) }),
    })
    const parent = defineWorkflow({
      name: 'spawner',
      version: '1',
      input: z.object({ tag: z.string() }),
      output: z.string(),
      body: async (ctx, input) => ctx.spawn(heldChild, { tag: input.tag }),
    })
    await bind(heldChild, engine)
    const boundParent = await bind(parent, engine)

    const handle = await boundParent.run({ tag: 'a' }, { runId: 'spawn-happy-1' })
    // Awaiting the spawn covers the child's start, never its result: the
    // parent settles while the child is still working.
    await expect(handle.result).resolves.toBe('spawn-happy-1/spawn:0/workflow:held-child#0')
    expect(handle.status()).toEqual({ state: 'done' })

    const childRow = readRuns(path).find(row => row['run_id'] === 'spawn-happy-1/spawn:0/workflow:held-child#0')
    expect(childRow?.['parent_run_id']).toBe('spawn-happy-1')
    expect(childRow?.['parent_step_key']).toBe('spawn:0')
    expect(childRow?.['status']).toBe('running')

    release()
    await until(() => readRuns(path)[1]?.['status'] === 'done')
    const lineage = await engine.runLineage('spawn-happy-1')
    expect(lineage.run?.status).toBe('done')
    expect(lineage.children.map(child => [child.def_name, child.status])).toEqual([['held-child', 'done']])
  })

  it('keys a spawn inside a step under that step, and re-derives the same slot on re-drive', async () => {
    const path = await tmpPath('daypaw-spawn-redrive-')
    const first = await bootEngine(path)
    const childX = defineWorkflow({
      name: 'child-x',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async ctx => ctx.step('x', async () => 'x'),
    })
    const childY = defineWorkflow({
      name: 'child-y',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async ctx => ctx.step('y', async () => 'y'),
    })
    const parent = defineWorkflow({
      name: 'fan-out',
      version: '1',
      input: z.object({}),
      output: z.object({ xId: z.string(), yId: z.string() }),
      body: async (ctx) => {
        // The step's recorded value is the child id: a re-drive that skips
        // the step fn still knows which child that step started.
        const xId = await ctx.step('fan', () => ctx.spawn(childX, {}))
        const yId = await ctx.spawn(childY, {})
        await ctx.waitFor('go')
        return { xId, yId }
      },
    })
    await bind(childX, first)
    await bind(childY, first)
    const boundParent = await bind(parent, first)
    await boundParent.run({}, { runId: 'spawn-redrive-1' })
    await until(() => readPromises(path).some(row => row['gate'] === 'go'))
    const disposed = contexts.shift()
    if (disposed === undefined) throw new Error('no engine context to dispose')
    await disposed.fiber.dispose()

    const second = await bootEngine(path)
    await bind(childX, second)
    await bind(childY, second)
    const reboundParent = await bind(parent, second)
    const attached = await reboundParent.run({}, { runId: 'spawn-redrive-1' })
    await second.resolveGate('spawn-redrive-1', 'go', { state: 'resolved', value: null }, 'sdk')

    await expect(attached.result).resolves.toEqual({
      xId: 'spawn-redrive-1/fan#0/spawn:0/workflow:child-x#0',
      yId: 'spawn-redrive-1/spawn:0/workflow:child-y#0',
    })
    // Two children, not three: the revived run attached to the child each
    // slot already recorded instead of starting a second one.
    expect(readRuns(path).filter(row => row['parent_run_id'] === 'spawn-redrive-1')).toHaveLength(2)
  })

  it('leaves the parent untouched when a spawned child fails, and shows the child in the lineage', async () => {
    const path = await tmpPath('daypaw-spawn-failure-')
    const engine = await bootEngine(path)
    const failingChild = defineWorkflow({
      name: 'failing-child',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async (ctx) => {
        await ctx.step('boom', async () => { throw new Error('child-boom') })
        return 'unreachable'
      },
    })
    const parent = defineWorkflow({
      name: 'unbothered',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async (ctx) => {
        const childId = await ctx.spawn(failingChild, {})
        await ctx.waitFor('never')
        return childId
      },
    })
    await bind(failingChild, engine)
    const boundParent = await bind(parent, engine)
    const handle = await boundParent.run({}, { runId: 'spawn-failure-1' })
    await until(() => readRuns(path)[1]?.['status'] === 'failed')
    // The child's failure is the child's: the parent still waits on its own
    // gate, with its own status and no failure of its own.
    expect(handle.status()).toEqual({ state: 'waiting', gate: 'never' })
    const lineage = await engine.runLineage('spawn-failure-1')
    expect(lineage.children.map(child => [child.def_name, child.status])).toEqual([['failing-child', 'failed']])
    await handle.cancel('cleanup')
    await handle.result.catch(() => {})
  })

  it('cancels an unfinished spawned child with its parent', async () => {
    const path = await tmpPath('daypaw-spawn-cancel-')
    const engine = await bootEngine(path)
    const parkedChild = defineWorkflow({
      name: 'parked-child',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async (ctx) => {
        const held = await ctx.waitFor('child-hold')
        return held.state
      },
    })
    const parent = defineWorkflow({
      name: 'cancelling-parent',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async (ctx) => {
        const childId = await ctx.spawn(parkedChild, {})
        await ctx.waitFor('parent-hold')
        return childId
      },
    })
    await bind(parkedChild, engine)
    const boundParent = await bind(parent, engine)
    const handle = await boundParent.run({}, { runId: 'spawn-cancel-1' })
    await until(() => readPromises(path).filter(row => row['state'] === 'pending').length === 2)

    await handle.cancel('stop-the-work')
    await expect(handle.result).rejects.toSatisfy((error: unknown) =>
      error instanceof Error && error.name === 'RunCancelledError')
    const rows = readRuns(path)
    expect(rows.map(row => row['status'])).toEqual(['cancelled', 'cancelled'])
    expect(rows[1]?.['cancel_cause']).toBe('stop-the-work')
    // Every gate of the subtree settles cancelled, so nothing waits on work
    // that will never finish.
    expect(readPromises(path).map(row => row['state'])).toEqual(['cancelled', 'cancelled'])
  })

  it('starts no child when the body reaches the spawn already cancelled', async () => {
    const path = await tmpPath('daypaw-spawn-late-')
    const engine = await bootEngine(path)
    let release!: () => void
    const hold = new Promise<void>((resolve) => { release = resolve })
    const late = defineWorkflow({
      name: 'late-spawner',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async (ctx) => {
        try {
          // The step ends in a rejection once the hold releases, which is
          // how the body gets to run code after its cancellation landed.
          await ctx.step('hold', async () => { await hold; throw new Error('hold-ended') })
        } catch {
          // Cancellation reached the body first; this spawn must not
          // outlive its parent.
          return ctx.spawn(quickChild, { tag: 'late' })
        }
        return 'unreachable'
      },
    })
    await bind(quickChild, engine)
    const boundLate = await bind(late, engine)
    const handle = await boundLate.run({}, { runId: 'spawn-late-1' })
    await until(() => readJournal(path).some(row => row['step_key'] === 'hold#0'))
    await handle.cancel('too-late')
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) =>
      error instanceof Error && error.name === 'RunCancelledError')
    expect(readRuns(path).map(row => row['def_name'])).toEqual(['late-spawner'])
  })

  it('fails loud when the spawned definition was never bound', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-spawn-unbound-'))
    const unbound = defineWorkflow({
      name: 'unbound-child',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async ctx => ctx.step('never-runs', async () => 'no'),
    })
    const parent = defineWorkflow({
      name: 'unbound-parent',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async ctx => ctx.spawn(unbound, {}),
    })
    const boundParent = await bind(parent, engine)
    const handle = await boundParent.run({}, { runId: 'spawn-unbound-1' })
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof Error) || error.name !== 'RunFailedError') return false
      return String((error as { cause?: unknown }).cause).includes('is not bound; call bind/bindAgent before ctx.spawn')
    })
  })

  it('allocates reserved slot keys through the ctx face, per scope', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-spawn-slots-'))
    const reader = defineWorkflow({
      name: 'slot-reader',
      version: '1',
      input: z.object({}),
      output: z.array(z.string()),
      body: async (ctx) => {
        const spawned = ctx.slot('spawn')
        const slept = ctx.slot('sleep')
        const nested = await ctx.step('nested', async () => ctx.slot('spawn'))
        return [spawned, slept, nested]
      },
    })
    const bound = await bind(reader, engine)
    const handle = await bound.run({}, { runId: 'spawn-slots-1' })
    await expect(handle.result).resolves.toEqual(['spawn:0', 'sleep:0', 'nested#0/spawn:0'])
  })

  it('types the spawn face over both definition families', () => {
    const typedWorkflow = defineWorkflow({
      name: 'typed-workflow',
      version: '1',
      input: z.object({ seed: z.number() }),
      output: z.object({ total: z.number() }),
      body: async (ctx, input) => ({ total: await ctx.step('noop', async () => input.seed) }),
    })
    const typedAgent = defineAgent({
      name: 'typed-agent',
      version: '1',
      input: z.object({ seed: z.number() }),
      output: z.object({ total: z.number() }),
      prompt: [],
      tools: [],
      model: { provider: 'test', model: 'test' },
      maxTurns: 1,
    })
    const check = (ctx: WorkflowCtx): void => {
      expectTypeOf(ctx.spawn(typedWorkflow, { seed: 1 })).toEqualTypeOf<Promise<string>>()
      expectTypeOf(ctx.spawn(typedAgent, { seed: 1 })).toEqualTypeOf<Promise<string>>()
    }
    expect(check).toBeTypeOf('function')
  })
})
