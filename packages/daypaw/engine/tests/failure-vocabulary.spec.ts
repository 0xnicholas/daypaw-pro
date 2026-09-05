/**
 * The `durable/*` Remote failure vocabulary (ticket #86): every wire-reachable
 * engine failure throws its typed code with stable details, message text
 * unchanged from the pre-vocabulary wording. One spec walks the whole code
 * map so the vocabulary has a single home; per-path behavior specs keep
 * their message assertions.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import DurableEngine from '@daypaw/engine'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { EngineDefinition, EngineStepCtx, EngineWireFace, Json } from '@daypaw/engine'

const contexts: Context[] = []
let root: string | undefined

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Workflow definition helper around one body function. */
function workflowDef(
  name: string,
  body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>,
  wire?: EngineWireFace,
): EngineDefinition {
  return { kind: 'workflow', name, version: '1', body, ...wire === undefined ? {} : { wire } }
}

/** Boot an engine over a fresh ledger at the given path (in-memory by default). */
async function boot(path = ':memory:'): Promise<{ ctx: Context; engine: DurableEngine }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(DurableEngine, { path, pollMs: 20 })
  return { ctx, engine: ctx.durable }
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

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

/**
 * Run one action and return its thrown vocabulary failure.
 * @param action - the engine call expected to reject.
 * @returns the thrown {@link TypertRemoteFailure}.
 */
async function failureOf(action: () => Promise<unknown>): Promise<TypertRemoteFailure> {
  return await action().then(
    () => { throw new Error('expected a rejection') },
    (error: unknown) => {
      if (error instanceof TypertRemoteFailure) return error
      throw new Error(`expected a TypertRemoteFailure vocabulary failure, got: ${String(error)}`)
    },
  )
}

describe('durable failure vocabulary (ticket #86)', () => {
  it('startRun reports definition resolution as not-found or ambiguous with identity details', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('solo', async () => 'ok'))
    await engine.register(workflowDef('dual', async () => 'ok'))
    await engine.register({ ...workflowDef('dual', async () => 'ok'), version: '2' })

    const byName = await failureOf(() => engine.startRun({ defName: 'ghost', input: {} }))
    expect(byName.failure).toEqual({
      code: 'durable/definition-not-found',
      message: 'durable engine: no registered definition matches ghost',
      details: { defName: 'ghost' },
    })
    const byVersion = await failureOf(() => engine.startRun({ defName: 'solo', defVersion: '9', input: {} }))
    expect(byVersion.failure).toEqual({
      code: 'durable/definition-not-found',
      message: 'durable engine: no registered definition matches solo@9',
      details: { defName: 'solo', defVersion: '9' },
    })
    const ambiguous = await failureOf(() => engine.startRun({ defName: 'dual', input: {} }))
    expect(ambiguous.failure).toEqual({
      code: 'durable/definition-ambiguous',
      message: 'durable engine: definition dual is ambiguous across workflow/dual/1, workflow/dual/2; pass an exact version',
      details: { defName: 'dual', candidates: ['workflow/dual/1', 'workflow/dual/2'] },
    })
  })

  it('startRun folds a wire-face rejection into input-invalid, message preserved', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('tasked', async () => 'done', taskWire()))
    const failure = await failureOf(() => engine.startRun({ defName: 'tasked', input: { wrong: true } }))
    expect(failure.failure).toEqual({
      code: 'durable/input-invalid',
      message: 'input must be { task: string }',
      details: { issues: [] },
    })
    expect(await engine.listRuns()).toHaveLength(0)
  })

  it('startRun folds a non-Error wire-face rejection under the same code', async () => {
    const { engine } = await boot()
    const throwingString: EngineWireFace = {
      inputKind: 'json',
      parseInput: () => {
        throw 'not a contract value'
      },
    }
    await engine.register(workflowDef('stringy', async () => 'done', throwingString))
    const failure = await failureOf(() => engine.startRun({ defName: 'stringy', input: {} }))
    expect(failure.failure).toEqual({
      code: 'durable/input-invalid',
      message: 'not a contract value',
      details: { issues: [] },
    })
  })

  it('startRun attach onto another definition reports run-definition-mismatch', async () => {
    const { engine } = await boot()
    await engine.register(workflowDef('owned-a', async () => 'ok'))
    await engine.register(workflowDef('owned-b', async () => 'ok'))
    const started = await engine.startRun({ defName: 'owned-a', input: {} })
    const failure = await failureOf(() => engine.startRun({ defName: 'owned-b', input: {}, runId: started.runId }))
    expect(failure.failure).toEqual({
      code: 'durable/run-definition-mismatch',
      message: `durable engine: run ${started.runId} belongs to workflow/owned-a/1, not workflow/owned-b/1`,
      details: { runId: started.runId },
    })
  })

  it('steer reports unknown, terminal, and not-steerable runs', async () => {
    const { engine } = await boot()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const heldDef = workflowDef('held', async () => { await gate; return 'ok' })
    const quickDef = workflowDef('quick', async () => 'ok')
    await engine.register(heldDef)
    await engine.register(quickDef)
    const held = await engine.run(heldDef, null, { runId: 'steer-held-1' })
    const done = await engine.run(quickDef, null, { runId: 'steer-done-1' })
    await done.result
    await until(async () => (await engine.runLineage('steer-held-1')).run?.status === 'running')

    const unknown = await failureOf(() => engine.steer('steer-ghost', null))
    expect(unknown.failure).toEqual({
      code: 'durable/run-not-found',
      message: 'durable engine: steer targets unknown run steer-ghost',
      details: { runId: 'steer-ghost' },
    })
    const terminal = await failureOf(() => engine.steer('steer-done-1', null))
    expect(terminal.failure).toEqual({
      code: 'durable/run-terminal',
      message: 'durable engine: steer targets terminal run steer-done-1 (done)',
      details: { runId: 'steer-done-1', status: 'done' },
    })
    const notSteerable = await failureOf(() => engine.steer('steer-held-1', null))
    expect(notSteerable.failure).toEqual({
      code: 'durable/run-not-steerable',
      message: 'durable engine: run steer-held-1 belongs to workflow/held/1, which is not steerable',
      details: { runId: 'steer-held-1', defKind: 'workflow', defName: 'held', defVersion: '1' },
    })

    release()
    await held.result
  })

  it('steerText reports an unknown run through the steer delegation', async () => {
    const { engine } = await boot()
    const failure = await failureOf(() => engine.steerText('steertext-ghost', 'follow up'))
    expect(failure.failure).toEqual({
      code: 'durable/run-not-found',
      message: 'durable engine: steer targets unknown run steertext-ghost',
      details: { runId: 'steertext-ghost' },
    })
  })

  it('steerText reports a definition without a wire face', async () => {
    const { engine } = await boot()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef('nowire', async () => { await gate; return 'ok' })
    await engine.register(def)
    const held = await engine.run(def, null, { runId: 'steertext-1' })
    await until(async () => (await engine.runLineage('steertext-1')).run?.status === 'running')
    const failure = await failureOf(() => engine.steerText('steertext-1', 'follow up'))
    expect(failure.failure).toEqual({
      code: 'durable/wire-face-missing',
      message: 'durable engine: steerText requires a wire face, and nowire@1 carries none',
      details: { defName: 'nowire', defVersion: '1' },
    })

    release()
    await held.result
  })

  it('rerun reports unknown, unfinished, child, and unregistered-definition runs', async () => {
    const { engine } = await boot()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const quick = workflowDef('quick', async () => 'ok')
    const held = workflowDef('held', async () => { await gate; return 'ok' })
    await engine.register(quick)
    await engine.register(held)
    await (await engine.run(quick, null, { runId: 'rerun-parent-1' })).result
    await (await engine.run(quick, null, {
      runId: 'rerun-child-1',
      parent: { runId: 'rerun-parent-1', stepKey: 'spawn#0' },
    })).result
    const heldHandle = await engine.run(held, null, { runId: 'rerun-running-1' })
    await until(async () => (await engine.runLineage('rerun-running-1')).run?.status === 'running')

    const unknown = await failureOf(() => engine.rerun('rerun-ghost'))
    expect(unknown.failure).toEqual({
      code: 'durable/run-not-found',
      message: 'durable engine: rerun targets unknown run rerun-ghost',
      details: { runId: 'rerun-ghost' },
    })
    const unfinished = await failureOf(() => engine.rerun('rerun-running-1'))
    expect(unfinished.failure).toEqual({
      code: 'durable/run-unfinished',
      message: 'durable engine: rerun targets unfinished run rerun-running-1 (running)',
      details: { runId: 'rerun-running-1', status: 'running' },
    })
    const child = await failureOf(() => engine.rerun('rerun-child-1'))
    expect(child.failure).toEqual({
      code: 'durable/run-is-child',
      message: 'durable engine: rerun targets child run rerun-child-1 (rerun applies to top-level runs only)',
      details: { runId: 'rerun-child-1' },
    })

    release()
    await heldHandle.result
  })

  it('rerun reports a terminal run whose definition left the registry', async () => {
    root = await mkdtemp(join(tmpdir(), 'daypaw-engine-vocab-unreg-'))
    const path = join(root, 'ledger.db')
    const first = await boot(path)
    const def = workflowDef('ephemeral', async () => 'ok')
    await first.engine.register(def)
    await (await first.engine.run(def, null, { runId: 'vocab-unreg-1' })).result
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const second = new Context()
    contexts.push(second)
    await second.plugin(DurableEngine, { path, pollMs: 20 })
    const failure = await failureOf(() => second.durable.rerun('vocab-unreg-1'))
    expect(failure.failure).toEqual({
      code: 'durable/definition-unregistered',
      message: 'durable engine: run vocab-unreg-1 belongs to workflow/ephemeral/1, which is not registered',
      details: { runId: 'vocab-unreg-1', defKind: 'workflow', defName: 'ephemeral', defVersion: '1' },
    })
  })

  it('cancel reports unknown runs', async () => {
    const { engine } = await boot()
    const failure = await failureOf(() => engine.cancel('cancel-ghost'))
    expect(failure.failure).toEqual({
      code: 'durable/run-not-found',
      message: 'durable engine: cancel targets unknown run cancel-ghost',
      details: { runId: 'cancel-ghost' },
    })
  })

  it('a ledger that fails to open fails every endpoint as ledger-unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'daypaw-engine-vocab-ledger-'))
    const notADir = join(dir, 'plain-file')
    await (await import('node:fs/promises')).writeFile(notADir, 'x')
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(DurableEngine, { path: join(notADir, 'nested', 'ledger.db') })
    const failure = await failureOf(() => ctx.durable.listRuns())
    expect(failure.failure.code).toBe('durable/ledger-unavailable')
    expect(failure.failure.message).toBe('durable engine failed to open its ledger')
    await rm(dir, { recursive: true, force: true })
  })
})
