import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import DurableEngine from '@daypaw/engine'
import { EngineRunError } from '@daypaw/engine'
import type { EngineDefinition, EngineRunHandle, EngineStepCtx } from '@daypaw/engine'

/** Workflow definition helper: opaque body thunk around one body function. */
function workflowDef(
  body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>,
  name: string,
): EngineDefinition {
  return { kind: 'workflow', name, version: '1', body }
}

/** A run that parks on its own gate until something settles or cancels it. */
function parkedDef(name: string, gate: string): EngineDefinition {
  return workflowDef(async (run) => {
    const held = await run.waitFor(gate)
    return held.state
  }, name)
}

async function boot(path: string): Promise<{ ctx: Context; engine: DurableEngine }> {
  const ctx = new Context()
  await ctx.plugin(DurableEngine, { path, pollMs: 20 })
  return { ctx, engine: ctx.durable }
}

async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function readRuns(path: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM runs ORDER BY rowid').all()
  } finally {
    db.close()
  }
}

function readPromises(path: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM promises ORDER BY rowid').all()
  } finally {
    db.close()
  }
}

function cancelled(error: unknown): boolean {
  return error instanceof EngineRunError && error.code === 'RUN_CANCELLED'
}

let root: string | undefined
let contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts = []
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function tmpPath(prefix: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix))
  return join(root, 'ledger.db')
}

describe('run cancellation cascades to descendants (ADR 0016)', () => {
  it('cancels every unfinished descendant of a cancelled run, settling their gates', async () => {
    const path = await tmpPath('daypaw-cascade-deep-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const started = new Map<string, EngineRunHandle>()
    const leaf = parkedDef('leaf', 'leaf-hold')
    const mid = workflowDef(async (run) => {
      started.set('leaf', await engine.run(leaf, null, {
        runId: 'cascade-leaf-1',
        parent: { runId: run.runId, stepKey: 'spawn:0' },
      }))
      await run.waitFor('mid-hold')
      return 'mid'
    }, 'mid')
    const top = workflowDef(async (run) => {
      started.set('mid', await engine.run(mid, null, {
        runId: 'cascade-mid-1',
        parent: { runId: run.runId, stepKey: 'spawn:0' },
      }))
      await run.waitFor('top-hold')
      return 'top'
    }, 'top')
    await engine.register(leaf)
    await engine.register(mid)
    await engine.register(top)
    const handle = await engine.run(top, null, { runId: 'cascade-root-1' })
    await until(() => readPromises(path).length === 3)

    await engine.cancel('cascade-root-1', 'stop-the-work')

    const rows = readRuns(path)
    expect(rows.map(row => [row['run_id'], row['status']])).toEqual([
      ['cascade-root-1', 'cancelled'],
      ['cascade-mid-1', 'cancelled'],
      ['cascade-leaf-1', 'cancelled'],
    ])
    // The cause reaches the whole subtree: one operator action, one reason.
    expect(rows.slice(1).every(row => row['cancel_cause'] === 'stop-the-work')).toBe(true)
    expect(readPromises(path).map(row => row['state'])).toEqual(['cancelled', 'cancelled', 'cancelled'])
    await expect(handle.result).rejects.toSatisfy(cancelled)
    await expect(started.get('mid')?.result).rejects.toSatisfy(cancelled)
    await expect(started.get('leaf')?.result).rejects.toSatisfy(cancelled)

    // Idempotent: a second cancel changes nothing and fails nothing.
    await engine.cancel('cascade-root-1', 'stop-again')
    expect(readRuns(path).map(row => row['status'])).toEqual(['cancelled', 'cancelled', 'cancelled'])
    expect(readRuns(path)[0]?.['cancel_cause']).toBe('stop-the-work')
  })

  it('leaves a descendant that already finished on its own terms', async () => {
    const path = await tmpPath('daypaw-cascade-finished-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    let child: EngineRunHandle | undefined
    const quick = workflowDef(async run => run.step('work', async () => 'quick'), 'quick')
    const top = workflowDef(async (run) => {
      child = await engine.run(quick, null, {
        runId: 'cascade-finished-child-1',
        parent: { runId: run.runId, stepKey: 'spawn:0' },
      })
      await run.waitFor('top-hold')
      return 'top'
    }, 'top')
    await engine.register(quick)
    await engine.register(top)
    const handle = await engine.run(top, null, { runId: 'cascade-finished-1' })
    await until(() => readRuns(path)[1]?.['status'] === 'done')

    await engine.cancel('cascade-finished-1', 'stop')
    expect(readRuns(path).map(row => row['status'])).toEqual(['cancelled', 'done'])
    // Cancelling a run never rewrites what already happened.
    await expect(child?.result).resolves.toBe('quick')
    await expect(handle.result).rejects.toSatisfy(cancelled)
  })

  it('cancels the unfinished children of a run that is already terminal', async () => {
    const path = await tmpPath('daypaw-cascade-terminal-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    let child: EngineRunHandle | undefined
    const parked = parkedDef('parked', 'child-hold')
    const top = workflowDef(async (run) => {
      child = await engine.run(parked, null, {
        runId: 'cascade-orphan-child-1',
        parent: { runId: run.runId, stepKey: 'spawn:0' },
      })
      // Returns without waiting: the child outlives its parent's own work,
      // which is exactly the state an operator can still stop.
      return 'top'
    }, 'top')
    await engine.register(parked)
    await engine.register(top)
    const handle = await engine.run(top, null, { runId: 'cascade-terminal-1' })
    await expect(handle.result).resolves.toBe('top')
    await until(() => readPromises(path).some(row => row['state'] === 'pending'))

    await engine.cancel('cascade-terminal-1', 'sweep-the-orphan')
    const rows = readRuns(path)
    expect(rows.map(row => [row['run_id'], row['status']])).toEqual([
      ['cascade-terminal-1', 'done'],
      ['cascade-orphan-child-1', 'cancelled'],
    ])
    expect(rows[1]?.['cancel_cause']).toBe('sweep-the-orphan')
    await expect(child?.result).rejects.toSatisfy(cancelled)
  })

  it('cascades when the caller signal cancels the run', async () => {
    const path = await tmpPath('daypaw-cascade-signal-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    let child: EngineRunHandle | undefined
    const parked = parkedDef('parked', 'child-hold')
    const top = workflowDef(async (run) => {
      child = await engine.run(parked, null, {
        runId: 'cascade-signal-child-1',
        parent: { runId: run.runId, stepKey: 'spawn:0' },
      })
      // The gate hands the abort back as a programmable outcome; the next
      // primitive the body reaches is where the cancellation lands.
      await run.waitFor('top-hold')
      await run.step('after-hold', async () => 'unreachable')
      return 'top'
    }, 'top')
    await engine.register(parked)
    await engine.register(top)
    const controller = new AbortController()
    const handle = await engine.run(top, null, { runId: 'cascade-signal-1', signal: controller.signal })
    await until(() => readPromises(path).length === 2)

    controller.abort('caller-stop')

    await expect(handle.result).rejects.toSatisfy(cancelled)
    const rows = readRuns(path)
    expect(rows.map(row => [row['run_id'], row['status']])).toEqual([
      ['cascade-signal-1', 'cancelled'],
      ['cascade-signal-child-1', 'cancelled'],
    ])
    await expect(child?.result).rejects.toSatisfy(cancelled)
  })
})
