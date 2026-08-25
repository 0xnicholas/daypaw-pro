import { afterEach, describe, expect, it } from 'vitest'
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

async function boot(pollMs = 20): Promise<{ ctx: Context; engine: DurableEngine }> {
  const ctx = new Context()
  await ctx.plugin(DurableEngine, { path: ':memory:', pollMs })
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

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('engine query face (ctx.durable)', () => {
  it('lists runs newest first and filters by status', async () => {
    const { ctx, engine } = await boot()
    contexts.push(ctx)
    const done = workflowDef(async () => 'ok')
    const failed = workflowDef(async () => { throw new Error('boom') }, 'failing')
    const hanging = workflowDef(async (run) => {
      await run.waitFor('approval')
      return null
    }, 'gated')
    await engine.register(done)
    await engine.register(failed)
    await engine.register(hanging)

    await (await engine.run(done, null, { runId: 'run-a' })).result
    await (await engine.run(done, null, { runId: 'run-b' })).result
    await (await engine.run(failed, null, { runId: 'run-c' })).result.catch(() => {})
    const cancelled = await engine.run(hanging, null, { runId: 'run-d' })
    await until(() => cancelled.status().state === 'waiting')
    await cancelled.cancel('user-stopped')
    await cancelled.result.catch(() => {})
    const waiting = await engine.run(hanging, null, { runId: 'run-e' })
    await until(() => waiting.status().state === 'waiting')

    const all = await engine.listRuns()
    expect(all.map(row => row.run_id)).toEqual(['run-e', 'run-d', 'run-c', 'run-b', 'run-a'])
    expect(all.map(row => row.status)).toEqual(['waiting', 'cancelled', 'failed', 'done', 'done'])
    expect(all[0]).toMatchObject({ def_kind: 'workflow', def_name: 'gated', waiting_gate: 'approval' })

    expect((await engine.listRuns({ status: 'done' })).map(row => row.run_id)).toEqual(['run-b', 'run-a'])
    expect((await engine.listRuns({ status: 'failed' })).map(row => row.run_id)).toEqual(['run-c'])
    expect((await engine.listRuns({ status: 'cancelled' })).map(row => row.run_id)).toEqual(['run-d'])
    expect((await engine.listRuns({ status: 'waiting' })).map(row => row.run_id)).toEqual(['run-e'])
    expect(await engine.listRuns({ status: 'running' })).toEqual([])
  })

  it('answers parent/child lineage for a run', async () => {
    const { ctx, engine } = await boot()
    contexts.push(ctx)
    const def = workflowDef(async () => 'ok')
    await engine.register(def)
    await (await engine.run(def, null, { runId: 'parent-1' })).result
    const parent = { runId: 'parent-1', stepKey: 'spawn#0' }
    await (await engine.run(def, null, { runId: 'child-1', parent })).result
    await (await engine.run(def, null, { runId: 'child-2', parent })).result

    const ofParent = await engine.runLineage('parent-1')
    expect(ofParent.run?.run_id).toBe('parent-1')
    expect(ofParent.parent).toBeUndefined()
    expect(ofParent.children.map(row => row.run_id)).toEqual(['child-1', 'child-2'])
    expect(ofParent.children[0]).toMatchObject({ parent_run_id: 'parent-1', parent_step_key: 'spawn#0' })

    const ofChild = await engine.runLineage('child-1')
    expect(ofChild.run?.run_id).toBe('child-1')
    expect(ofChild.parent?.run_id).toBe('parent-1')
    expect(ofChild.children).toEqual([])

    expect(await engine.runLineage('unknown')).toEqual({ run: undefined, parent: undefined, children: [] })
  })

  it('enumerates a run journal step timeline in start order', async () => {
    const { ctx, engine } = await boot()
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      await run.step('one', async () => 1)
      await run.step('two', async () => { throw new Error('bad step') })
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'steps-1' })
    await handle.result.catch(() => {})

    const timeline = await engine.journalTimeline('steps-1')
    expect(timeline.map(row => [row.step_key, row.name, row.status])).toEqual([
      ['one#0', 'one', 'completed'],
      ['two#0', 'two', 'failed'],
    ])
    expect(timeline[0]?.value_json).toBe('1')
    expect(timeline[1]?.finished_at).toBeTypeOf('number')

    expect(await engine.journalTimeline('unknown')).toEqual([])
  })
})
