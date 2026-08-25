import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import DurableEngine from '@daypaw/engine'
import type { EngineDefinition, EngineStepCtx } from '@daypaw/engine'

/** Workflow definition helper: opaque body thunk around one body function. */
function workflowDef(
  body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>,
  name = 'demo',
): EngineDefinition {
  return { kind: 'workflow', name, version: '1', body }
}

async function boot(path = ':memory:', pollMs = 20): Promise<{ ctx: Context; engine: DurableEngine }> {
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

const contexts: Context[] = []
let root: string | undefined

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function tmpPath(prefix: string): Promise<string> {
  root = await mkdtemp(join(tmpdir(), prefix))
  return join(root, 'ledger.db')
}

describe('rerun (ctx.durable.rerun, issue #57)', () => {
  it('rejects an unknown run id', async () => {
    const { ctx, engine } = await boot()
    contexts.push(ctx)
    await expect(engine.rerun('rerun-ghost'))
      .rejects.toThrow('durable engine: rerun targets unknown run rerun-ghost')
  })

  it('rejects an unfinished run, running or waiting', async () => {
    const { ctx, engine } = await boot()
    contexts.push(ctx)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const held = workflowDef(async run => run.step('held', async () => { await gate; return 'released' }), 'held')
    const gated = workflowDef(async (run) => { await run.waitFor('approval'); return null }, 'gated')
    await engine.register(held)
    await engine.register(gated)
    const running = await engine.run(held, null, { runId: 'rerun-running-1' })
    const waiting = await engine.run(gated, null, { runId: 'rerun-waiting-1' })
    await until(() => waiting.status().state === 'waiting')

    await expect(engine.rerun('rerun-running-1'))
      .rejects.toThrow('durable engine: rerun targets unfinished run rerun-running-1 (running)')
    await expect(engine.rerun('rerun-waiting-1'))
      .rejects.toThrow('durable engine: rerun targets unfinished run rerun-waiting-1 (waiting)')

    release()
    await running.result
    await waiting.cancel('cleanup')
    await waiting.result.catch(() => {})
  })

  it('rejects a child run: rerun applies to top-level runs only', async () => {
    const { ctx, engine } = await boot()
    contexts.push(ctx)
    const def = workflowDef(async () => 'ok')
    await engine.register(def)
    await (await engine.run(def, null, { runId: 'rerun-parent-1' })).result
    await (await engine.run(def, null, {
      runId: 'rerun-child-1',
      parent: { runId: 'rerun-parent-1', stepKey: 'spawn#0' },
    })).result

    await expect(engine.rerun('rerun-child-1')).rejects.toThrow(/top-level/)
  })

  it('rejects a rerun whose definition is not registered in this process', async () => {
    const path = await tmpPath('daypaw-engine-rerun-unregistered-')
    const first = await boot(path)
    contexts.push(first.ctx)
    const def = workflowDef(async () => 'ok', 'ephemeral')
    await first.engine.register(def)
    await (await first.engine.run(def, null, { runId: 'rerun-unreg-1' })).result

    const second = await boot(path)
    contexts.push(second.ctx)
    await expect(second.engine.rerun('rerun-unreg-1')).rejects.toThrow(
      'durable engine: run rerun-unreg-1 belongs to workflow/ephemeral/1, which is not registered',
    )
  })

  it('starts a fresh attempt row off a failed run and drives it to completion', async () => {
    const { ctx, engine } = await boot()
    contexts.push(ctx)
    let executions = 0
    const flaky = workflowDef(async () => {
      executions += 1
      if (executions === 1) throw new Error('first attempt fails')
      return `ok-${executions}`
    }, 'flaky')
    await engine.register(flaky)
    const first = await engine.run(flaky, { seed: 7 }, { runId: 'rerun-fail-1' })
    await first.result.catch(() => {})
    expect(executions).toBe(1)

    const secondId = await engine.rerun('rerun-fail-1')
    expect(secondId).not.toBe('rerun-fail-1')
    const second = await engine.run(flaky, { seed: 7 }, { runId: secondId })
    await expect(second.result).resolves.toBe('ok-2')
    expect(executions).toBe(2)

    const rows = await engine.listRuns()
    const secondRow = rows.find(row => row.run_id === secondId)
    expect(secondRow).toMatchObject({
      def_kind: 'workflow',
      def_name: 'flaky',
      def_version: '1',
      status: 'done',
      attempt: 2,
      retried_from_run_id: 'rerun-fail-1',
      parent_run_id: null,
      parent_step_key: null,
    })
    expect(secondRow?.input_json).toBe(JSON.stringify({ seed: 7 }))

    const thirdId = await engine.rerun(secondId)
    const third = await engine.run(flaky, { seed: 7 }, { runId: thirdId })
    await expect(third.result).resolves.toBe('ok-3')
    const thirdRow = (await engine.listRuns()).find(row => row.run_id === thirdId)
    expect(thirdRow).toMatchObject({ attempt: 3, retried_from_run_id: secondId, status: 'done' })
  })

  it('reruns a done run with the same definition and input', async () => {
    const { ctx, engine } = await boot()
    contexts.push(ctx)
    const def = workflowDef(async (_run, input) => ({ echoed: input }))
    await engine.register(def)
    await (await engine.run(def, { seed: 1 }, { runId: 'rerun-done-1' })).result

    const newId = await engine.rerun('rerun-done-1')
    const attached = await engine.run(def, { seed: 1 }, { runId: newId })
    await expect(attached.result).resolves.toEqual({ echoed: { seed: 1 } })
    const row = (await engine.listRuns()).find(entry => entry.run_id === newId)
    expect(row).toMatchObject({
      status: 'done',
      attempt: 2,
      retried_from_run_id: 'rerun-done-1',
      input_json: JSON.stringify({ seed: 1 }),
    })
  })

  it('reruns a cancelled run and settles its gate anew', async () => {
    const { ctx, engine } = await boot()
    contexts.push(ctx)
    const gated = workflowDef(async run => run.waitFor('approval'), 'gated')
    await engine.register(gated)
    const first = await engine.run(gated, null, { runId: 'rerun-cancel-1' })
    await until(() => first.status().state === 'waiting')
    await first.cancel('operator-stop')
    await first.result.catch(() => {})

    const newId = await engine.rerun('rerun-cancel-1')
    const attached = await engine.run(gated, null, { runId: newId })
    await until(() => attached.status().state === 'waiting')
    await engine.resolveGate(newId, 'approval', { state: 'resolved', value: 'go' }, 'sdk')
    await expect(attached.result).resolves.toEqual({ state: 'resolved', value: 'go' })
    const row = (await engine.listRuns()).find(entry => entry.run_id === newId)
    expect(row).toMatchObject({ status: 'done', attempt: 2, retried_from_run_id: 'rerun-cancel-1' })
  })
})
