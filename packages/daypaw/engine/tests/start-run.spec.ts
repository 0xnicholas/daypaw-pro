/**
 * Wire-start behavior (ruling #65): registry resolution by wire identity
 * through the `durable/startRun` Remote endpoint (start-or-attach, wire-face
 * input validation, fire-and-forget result), and the `inputKind` projection
 * on `durable/listDefinitions`.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import DurableEngine from '@daypaw/engine'
import type { EngineDefinition, EngineStepCtx, EngineWireFace, Json } from '@daypaw/engine'
import type { RunRow } from '@daypaw/store'

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.length = 0
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A wire face accepting exactly `{ task: string }`. */
function taskWire(): EngineWireFace {
  return {
    inputKind: 'text',
    parseInput: (value: unknown): Json => {
      if (typeof value !== 'object' || value === null || typeof (value as { task?: unknown }).task !== 'string') {
        throw new Error('input must be { task: string }')
      }
      return value as Json
    },
  }
}

/** Workflow definition helper around one body function. */
function workflowDef(
  name: string,
  version: string,
  body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>,
  wire?: EngineWireFace,
): EngineDefinition {
  return { kind: 'workflow', name, version, body, ...wire === undefined ? {} : { wire } }
}

/** Boot an engine over a fresh ledger. */
async function boot(): Promise<{ ctx: Context; engine: DurableEngine }> {
  root ??= await mkdtemp(join(tmpdir(), 'daypaw-engine-start-'))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(DurableEngine, { path: join(root, `ledger-${contexts.length}.db`), pollMs: 20 })
  return { ctx, engine: ctx.durable }
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function runRow(engine: DurableEngine, runId: string): Promise<RunRow | undefined> {
  return (await engine.listRuns()).find(run => run.run_id === runId)
}

describe('wire identity resolution through durable/startRun', () => {
  it('resolves the unique version when none is given', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('solo', '1', async () => 'ok'))
    const { runId } = await engine.startRun({ defName: 'solo', input: {} })
    expect((await runRow(engine, runId))?.def_version).toBe('1')
  })

  it('resolves an exact version among coexisting ones', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('dual', '1', async () => 'one'))
    await engine.register(workflowDef('dual', '2', async () => 'two'))
    const { runId } = await engine.startRun({ defName: 'dual', defVersion: '1', input: {} })
    expect((await runRow(engine, runId))?.def_version).toBe('1')
  })

  it('rejects version ambiguity, naming the candidates', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('dual', '1', async () => 'one'))
    await engine.register(workflowDef('dual', '2', async () => 'two'))
    await expect(engine.startRun({ defName: 'dual', input: {} })).rejects.toThrow(
      'durable engine: definition dual is ambiguous across workflow/dual/1, workflow/dual/2; pass an exact version',
    )
  })

  it('rejects kind ambiguity under one name', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('clash', '1', async () => 'flow'))
    await engine.register({ kind: 'agent', name: 'clash', version: '1', body: async () => 'agent' })
    await expect(engine.startRun({ defName: 'clash', input: {} })).rejects.toThrow(
      'durable engine: definition clash is ambiguous across workflow/clash/1, agent/clash/1; pass an exact version',
    )
  })

  it('rejects an unknown name and an unknown exact version', async () => {
    const { engine } = await boot()
    await expect(engine.startRun({ defName: 'ghost', input: {} })).rejects.toThrow(
      'durable engine: no registered definition matches ghost',
    )
    await engine.register(workflowDef('solo', '1', async () => 'ok'))
    await expect(engine.startRun({ defName: 'solo', defVersion: '9', input: {} })).rejects.toThrow(
      'durable engine: no registered definition matches solo@9',
    )
  })
})

describe('durable/startRun', () => {
  it('starts a run through the wire face and returns its id', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('tasked', '1', async () => 'done', taskWire()))
    const { runId } = await engine.startRun({ defName: 'tasked', input: { task: 'write the report' } })
    await until(async () => (await runRow(engine, runId))?.status === 'done')
    expect((await runRow(engine, runId))?.input_json).toBe('{"task":"write the report"}')
  })

  it('attaches to an existing runId without starting a second run', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('idem', '1', async () => 'ok', taskWire()))
    const first = await engine.startRun({ defName: 'idem', input: { task: 'a' }, runId: 'run-idem-1' })
    const second = await engine.startRun({ defName: 'idem', input: { task: 'a' }, runId: 'run-idem-1' })
    expect(second.runId).toBe(first.runId)
    expect((await engine.listRuns()).filter(run => run.def_name === 'idem')).toHaveLength(1)
  })

  it('validates input through the definition wire face before starting', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('tasked', '1', async () => 'done', taskWire()))
    await expect(engine.startRun({ defName: 'tasked', input: { wrong: true } })).rejects.toThrow(
      'input must be { task: string }',
    )
    expect(await engine.listRuns()).toHaveLength(0)
  })

  it('passes input verbatim to definitions without a wire face', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('raw', '1', async () => 'ok'))
    const { runId } = await engine.startRun({ defName: 'raw', input: { anything: ['goes'] } })
    await until(async () => (await runRow(engine, runId))?.status === 'done')
    expect((await runRow(engine, runId))?.input_json).toBe('{"anything":["goes"]}')
  })

  it('leaves a failed run in the ledger without surfacing its rejection', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('boom', '1', async () => { throw new Error('body failed') }, taskWire()))
    const { runId } = await engine.startRun({ defName: 'boom', input: { task: 'x' } })
    // The result promise is deliberately not returned by the endpoint; the
    // failed row is the observable outcome and no rejection may escape.
    await until(async () => (await runRow(engine, runId))?.status === 'failed')
  })

  it('projects inputKind on listDefinitions views, null without a wire face', async () => {
    const { engine } = await boot()
    const passthrough = (value: unknown): Json => value as Json
    await engine.register(workflowDef('texted', '1', async () => 'ok', { inputKind: 'text', parseInput: passthrough }))
    await engine.register(workflowDef('jsoned', '1', async () => 'ok', { inputKind: 'json', parseInput: passthrough }))
    await engine.register(workflowDef('bare', '1', async () => 'ok'))
    const views = await engine.listDefinitions()
    expect(views.find(view => view.name === 'texted')?.inputKind).toBe('text')
    expect(views.find(view => view.name === 'jsoned')?.inputKind).toBe('json')
    expect(views.find(view => view.name === 'bare')?.inputKind).toBeNull()
  })
})
