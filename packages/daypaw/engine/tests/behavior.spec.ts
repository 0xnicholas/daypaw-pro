import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import DurableEngine from '@daypaw/engine'
import { currentStepScope } from '@daypaw/engine'
import type { EngineDefinition, EngineRunError, EngineStepCtx } from '@daypaw/engine'

/** Workflow definition helper: opaque body thunk around one body function. */
function workflowDef(
  body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>,
  name = 'demo',
): EngineDefinition {
  return { kind: 'workflow', name, version: '1', body }
}

async function boot(path: string, pollMs = 20): Promise<{ ctx: Context; engine: DurableEngine }> {
  const ctx = new Context()
  await ctx.plugin(DurableEngine, { path, pollMs })
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
    return db.prepare('SELECT * FROM runs').all()
  } finally {
    db.close()
  }
}

function readJournal(path: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM journal ORDER BY rowid').all()
  } finally {
    db.close()
  }
}

function runError(error: unknown): EngineRunError {
  if (!(error instanceof Error) || !('code' in error)) throw new Error(`expected EngineRunError, got ${String(error)}`)
  return error as EngineRunError
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

describe('durable engine service', () => {
  it('runs a workflow to a typed done row with completed journal steps', async () => {
    const path = await tmpPath('daypaw-engine-happy-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const effects: string[] = []
    const def = workflowDef(async (run, input) => {
      const seed = (input as { seed: number }).seed
      const a = await run.step('one', async () => { effects.push('one'); return seed + 1 })
      const b = await run.step('two', async () => { effects.push('two'); return a + 1 })
      return { total: b }
    })
    await engine.register(def)
    const handle = await engine.run(def, { seed: 1 }, { runId: 'happy-1' })
    await expect(handle.result).resolves.toEqual({ total: 3 })
    expect(effects).toEqual(['one', 'two'])
    expect(handle.id).toBe('happy-1')
    expect(handle.status()).toEqual({ state: 'done' })
    const [row] = readRuns(path)
    expect(row?.status).toBe('done')
    expect(JSON.parse(row?.output_json as string)).toEqual({ total: 3 })
    expect(readJournal(path).map(step => [step.step_key, step.status])).toEqual([
      ['one#0', 'completed'],
      ['two#0', 'completed'],
    ])
  })

  it('derives occurrence keys for repeated step names and honors opts.key', async () => {
    const path = await tmpPath('daypaw-engine-keys-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      for (let index = 0; index < 3; index += 1) {
        await run.step('tick', async () => index)
      }
      await run.step('pinned', async () => 'x', { key: 'custom-key' })
      return null
    })
    await engine.register(def)
    const handle = await engine.run(def, null)
    await handle.result
    expect(readJournal(path).map(step => step.step_key)).toEqual([
      'tick#0', 'tick#1', 'tick#2', 'custom-key',
    ])
  })

  it('returns the same live handle for a concurrent same-process attach', async () => {
    const path = await tmpPath('daypaw-engine-attach-live-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('gated', async () => {
      await gate
      return 'done-value'
    })))
    await engine.register(def)
    const first = await engine.run(def, null, { runId: 'attach-1' })
    const second = await engine.run(def, null, { runId: 'attach-1' })
    expect(second).toBe(first)
    release()
    await expect(first.result).resolves.toBe('done-value')
  })

  it('settles an attach on a terminal run from its row', async () => {
    const path = await tmpPath('daypaw-engine-attach-done-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async run => (await run.step('only', async () => 42)) + 1)
    await engine.register(def)
    const first = await engine.run(def, null, { runId: 'settled-1' })
    await expect(first.result).resolves.toBe(43)
    const again = await engine.run(def, null, { runId: 'settled-1' })
    await expect(again.result).resolves.toBe(43)
    expect(again.status()).toEqual({ state: 'done' })
    await expect(again.cancel('noop')).resolves.toBeUndefined()
  })

  it('rejects a runId reused with a different definition or an unregistered definition', async () => {
    const path = await tmpPath('daypaw-engine-identity-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const defA = workflowDef(async () => 1, 'alpha')
    const defB = workflowDef(async () => 2, 'beta')
    await engine.register(defA)
    await engine.register(defB)
    const handle = await engine.run(defA, null, { runId: 'identity-1' })
    await handle.result
    await expect(engine.run(defB, null, { runId: 'identity-1' })).rejects.toThrow(/belongs to workflow\/alpha\/1/)
    await expect(engine.run(workflowDef(async () => 3, 'ghost'), null)).rejects.toThrow(/must be registered/)
  })

  it('rejects registering one identity with two different bodies', async () => {
    const path = await tmpPath('daypaw-engine-registry-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async () => 1, 'clash')
    await engine.register(def)
    await expect(engine.register(workflowDef(async () => 2, 'clash'))).rejects.toThrow(/already registered with a different body/)
    await expect(engine.register(def)).resolves.toBeUndefined()
  })

  it('cancels at the next step boundary and records the cause', async () => {
    const path = await tmpPath('daypaw-engine-cancel-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const effects: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async (run) => {
      await run.step('one', async () => { effects.push('one'); return 1 })
      await run.step('two', async () => { await gate; effects.push('two'); return 2 })
      await run.step('three', async () => { effects.push('three'); return 3 })
      return 0
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'cancel-1' })
    await until(() => effects.includes('one'))
    await handle.cancel('stop-it')
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = runError(error)
      return run.code === 'RUN_CANCELLED' && run.detail === 'stop-it'
    })
    expect(effects).toEqual(['one', 'two'])
    const [row] = readRuns(path)
    expect(row?.status).toBe('cancelled')
    expect(row?.cancel_cause).toBe('stop-it')
    expect(handle.status()).toEqual({ state: 'cancelled', cause: 'stop-it' })
  })

  it('honors a pre-aborted caller signal as an immediate cancellation', async () => {
    const path = await tmpPath('daypaw-engine-signal-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const effects: string[] = []
    const def = workflowDef(async run => (await run.step('never', async () => { effects.push('never'); return 1 })))
    await engine.register(def)
    const controller = new AbortController()
    controller.abort('caller-changed-mind')
    const handle = await engine.run(def, null, { runId: 'signal-1', signal: controller.signal })
    await expect(handle.result).rejects.toSatisfy((error: unknown) => runError(error).code === 'RUN_CANCELLED')
    expect(effects).toEqual([])
    const [row] = readRuns(path)
    expect(row?.status).toBe('cancelled')
  })

  it('fails the run when a step throws, recording error_json on both rows', async () => {
    const path = await tmpPath('daypaw-engine-failure-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async run => (await run.step('boom', async () => { throw new Error('kaput') })))
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'fail-1' })
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = runError(error)
      return run.code === 'RUN_FAILED' && (run.detail as Error).message === 'kaput'
    })
    const [row] = readRuns(path)
    expect(row?.status).toBe('failed')
    expect(JSON.parse(row?.error_json as string)).toEqual({ message: 'kaput' })
    expect(handle.status()).toEqual({ state: 'failed', error: { message: 'kaput' } })
    const [step] = readJournal(path)
    expect(step?.status).toBe('failed')
    expect(JSON.parse(step?.error_json as string)).toEqual({ message: 'kaput' })
  })

  it('fails the run when a step result is not JSON-serializable', async () => {
    const path = await tmpPath('daypaw-engine-badjson-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async run => (await run.step('bigint', async () => 1n)))
    await engine.register(def)
    const handle = await engine.run(def, null)
    await expect(handle.result).rejects.toSatisfy((error: unknown) => runError(error).code === 'RUN_FAILED')
    const [row] = readRuns(path)
    expect(row?.status).toBe('failed')
  })

  it('throws on a waiting status row: that state lands with ctx.waitFor', async () => {
    const path = await tmpPath('daypaw-engine-waiting-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('gated', async () => { await gate; return 1 })))
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'waiting-1' })
    await until(() => readJournal(path).length === 1)
    const poker = new DatabaseSync(path)
    poker.exec("UPDATE runs SET status = 'waiting' WHERE run_id = 'waiting-1'")
    poker.close()
    expect(() => handle.status()).toThrow(/lands with ctx.waitFor/)
    release()
    await handle.result
  })

  it('polls an attach on a run driven elsewhere until it settles', async () => {
    const path = await tmpPath('daypaw-engine-poll-')
    const driverCtx = (await boot(path)).ctx
    const attacher = await boot(path)
    contexts.push(driverCtx, attacher.ctx)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const effects: string[] = []
    const def = workflowDef(async (run) => {
      await run.step('one', async () => { effects.push('one'); return 1 })
      await run.step('two', async () => { await gate; effects.push('two'); return 2 })
      return 'polled-done'
    })
    await driverCtx.durable.register(def)
    await attacher.engine.register(def)
    const driving = await driverCtx.durable.run(def, null, { runId: 'poll-1' })
    await until(() => effects.includes('one'))
    const attached = await attacher.engine.run(def, null, { runId: 'poll-1' })
    expect(attached.id).toBe('poll-1')
    release()
    await expect(driving.result).resolves.toBe('polled-done')
    await expect(attached.result).resolves.toBe('polled-done')
  })

  it('stops driving on dispose, leaves the run unfinished, and a later process revives it with step dedup', async () => {
    const path = await tmpPath('daypaw-engine-revive-')
    const first = await boot(path)
    const effects: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async (run) => {
      const a = await run.step('one', async () => { effects.push('one'); return 10 })
      const b = await run.step('two', async () => { await gate; effects.push('two'); return a + 5 })
      const c = await run.step('three', async () => { effects.push('three'); return b + 1 })
      return { total: c }
    })
    await first.engine.register(def)
    const handle = await first.engine.run(def, { seed: 0 }, { runId: 'revive-1' })
    await until(() => effects.includes('one'))
    await first.ctx.fiber.dispose()
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => runError(error).code === 'ENGINE_DISPOSED')
    const [midRow] = readRuns(path)
    expect(midRow?.status).toBe('running')

    const second = await boot(path)
    contexts.push(second.ctx)
    await second.engine.register(def)
    await second.engine.idle()
    const revived = await second.engine.run(def, { seed: 0 }, { runId: 'revive-1' })
    await expect(revived.result).resolves.toEqual({ total: 16 })
    expect(effects.filter(effect => effect === 'one').length).toBe(1)
    expect(effects.filter(effect => effect === 'three').length).toBe(1)
    expect(effects.filter(effect => effect === 'two').length).toBeGreaterThanOrEqual(1)
    const [row] = readRuns(path)
    expect(row?.status).toBe('done')
  })

  it('resolves idle() when nothing is being driven', async () => {
    const path = await tmpPath('daypaw-engine-idle-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async () => 'quick')
    await engine.register(def)
    const handle = await engine.run(def, null)
    await handle.result
    await expect(engine.idle()).resolves.toBeUndefined()
  })

  it('boots with the default poll interval', async () => {
    const ctx = new Context()
    await ctx.plugin(DurableEngine, { path: ':memory:' })
    contexts.push(ctx)
    expect(ctx.durable).toBeInstanceOf(DurableEngine)
    await ctx.fiber.dispose()
  })

  it('surfaces a ledger open failure on first use and survives disposal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'daypaw-engine-badpath-'))
    const notADir = join(dir, 'plain-file')
    await (await import('node:fs/promises')).writeFile(notADir, 'x')
    const ctx = new Context()
    await ctx.plugin(DurableEngine, { path: join(notADir, 'nested', 'ledger.db') })
    contexts.push(ctx)
    await expect(ctx.durable.register({ kind: 'workflow', name: 'x', version: '1', body: async () => 1 }))
      .rejects.toThrow('failed to open its ledger')
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('warns through the service logger when a revival lacks its definition', async () => {
    const path = await tmpPath('daypaw-engine-warn-')
    const first = await boot(path)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 1 })))
    await first.engine.register(def)
    await first.engine.run(def, null, { runId: 'warn-1' })
    await new Promise(resolve => setImmediate(resolve))
    await first.ctx.fiber.dispose()
    release()

    const second = await boot(path)
    contexts.push(second.ctx)
    await second.engine.register(workflowDef(async () => 'other', 'unrelated'))
    await second.engine.idle()
    expect(readRuns(path).find(row => row.run_id === 'warn-1')?.status).toBe('running')
  })

  it('observes a row cancelled by another engine at the next step boundary', async () => {
    const path = await tmpPath('daypaw-engine-crosscancel-')
    const first = await boot(path)
    const second = await boot(path)
    contexts.push(first.ctx, second.ctx)
    const effects: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async (run) => {
      await run.step('one', async () => { effects.push('one'); return 1 })
      await run.step('two', async () => { await gate; effects.push('two'); return 2 })
      await run.step('three', async () => { effects.push('three'); return 3 })
      return 0
    })
    await first.engine.register(def)
    const handle = await first.engine.run(def, null, { runId: 'cross-1' })
    await until(() => effects.includes('one'))
    // Another writer (a second engine's cancel path) settles the row directly.
    const poker = new DatabaseSync(path)
    poker.exec("UPDATE runs SET status = 'cancelled', cancel_cause = 'cross-process-stop' WHERE run_id = 'cross-1'")
    poker.close()
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => runError(error).code === 'RUN_CANCELLED')
    expect(effects).toEqual(['one', 'two'])
    const [row] = readRuns(path)
    expect(row?.status).toBe('cancelled')
    expect(row?.cancel_cause).toBe('cross-process-stop')
  })

  it('exposes the driving runId on the step ctx', async () => {
    const path = await tmpPath('daypaw-engine-runid-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    let observed: string | undefined
    const def = workflowDef(async (run) => {
      observed = run.runId
      return run.step('only', async () => null)
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'runid-1' })
    await handle.result
    expect(observed).toBe('runid-1')
  })

  it('derives deterministic child run ids inside the ambient step scope', async () => {
    const path = await tmpPath('daypaw-engine-scope-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    expect(currentStepScope()).toBeUndefined()
    const seen: Array<{ stepKey: string; scopeRunId: string; children: string[] }> = []
    const def = workflowDef(async run => (await run.step('parent', async () => {
      const scope = currentStepScope()
      if (scope === undefined) throw new Error('step fn ran without an ambient scope')
      seen.push({
        stepKey: scope.stepKey,
        scopeRunId: scope.runId,
        children: [
          scope.childRunId('agent', 'reviewer'),
          scope.childRunId('agent', 'reviewer'),
          scope.childRunId('workflow', 'child'),
        ],
      })
      return null
    })))
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'scope-1' })
    await handle.result
    expect(currentStepScope()).toBeUndefined()
    expect(seen).toEqual([{
      stepKey: 'parent#0',
      scopeRunId: 'scope-1',
      children: [
        'scope-1/parent#0/agent:reviewer#0',
        'scope-1/parent#0/agent:reviewer#1',
        'scope-1/parent#0/workflow:child#0',
      ],
    }])
  })

  it('re-derives the same child run ids when a step re-executes after revival', async () => {
    const path = await tmpPath('daypaw-engine-rederive-')
    const first = await boot(path)
    const derivations: string[][] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => {
      const scope = currentStepScope()
      if (scope === undefined) throw new Error('step fn ran without an ambient scope')
      derivations.push([scope.childRunId('agent', 'kid'), scope.childRunId('agent', 'kid')])
      await gate
      return null
    })))
    await first.engine.register(def)
    const handle = await first.engine.run(def, null, { runId: 'rederive-1' })
    await until(() => derivations.length === 1)
    await first.ctx.fiber.dispose()
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => runError(error).code === 'ENGINE_DISPOSED')

    const second = await boot(path)
    contexts.push(second.ctx)
    await second.engine.register(def)
    await second.engine.idle()
    await expect((await second.engine.run(def, null, { runId: 'rederive-1' })).result).resolves.toBeNull()
    expect(derivations.length).toBe(2)
    expect(derivations[1]).toEqual(derivations[0])
  })

  it('records parent linkage on insert and never rewrites it on attach', async () => {
    const path = await tmpPath('daypaw-engine-parent-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const child = workflowDef(async () => 'kid', 'child')
    await engine.register(child)
    const handle = await engine.run(child, null, {
      runId: 'child-1',
      parent: { runId: 'parent-1', stepKey: 'agent:reviewer#0' },
    })
    await expect(handle.result).resolves.toBe('kid')
    const [row] = readRuns(path)
    expect(row?.parent_run_id).toBe('parent-1')
    expect(row?.parent_step_key).toBe('agent:reviewer#0')
    const again = await engine.run(child, null, {
      runId: 'child-1',
      parent: { runId: 'other-parent', stepKey: 'elsewhere#0' },
    })
    await expect(again.result).resolves.toBe('kid')
    const [after] = readRuns(path)
    expect(after?.parent_run_id).toBe('parent-1')
    expect(after?.parent_step_key).toBe('agent:reviewer#0')
  })
})
