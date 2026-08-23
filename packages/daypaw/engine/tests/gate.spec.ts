import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import DurableEngine from '@daypaw/engine'
import type { EngineDefinition, EngineRunError, EngineStepCtx, GateSchema } from '@daypaw/engine'

/** Workflow definition helper: opaque body thunk around one body function. */
function workflowDef(
  body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>,
  name = 'gated',
): EngineDefinition {
  return { kind: 'workflow', name, version: '1', body }
}

/** A numeric gate contract with a JSON Schema projection. */
const numberGate: GateSchema<number> = {
  parse: (value) => {
    if (typeof value !== 'number') throw new Error('expected a number')
    return value
  },
  toJSONSchema: () => ({ type: 'number' }),
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

function readPromises(path: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM promises').all()
  } finally {
    db.close()
  }
}

/** Write directly into the ledger, simulating another process. */
function poke(path: string, statements: string[]): void {
  const poker = new DatabaseSync(path)
  try {
    for (const statement of statements) poker.exec(statement)
  } finally {
    poker.close()
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

describe('durable gates (ctx.waitFor)', () => {
  it('suspends on a gate, records the pending rows, and resumes with the resolved value', async () => {
    const path = await tmpPath('daypaw-gate-happy-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      const before = await run.step('one', async () => 1)
      const resolution = await run.waitFor('approval', { schema: numberGate })
      if (resolution.state !== 'resolved') return 'not-resolved'
      return before + resolution.value
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'gate-1' })
    await until(() => handle.status().state === 'waiting')
    expect(handle.status()).toEqual({ state: 'waiting', gate: 'approval' })
    const [runRow] = readRuns(path)
    expect(runRow?.status).toBe('waiting')
    expect(runRow?.waiting_gate).toBe('approval')
    const [pending] = readPromises(path)
    expect(pending?.state).toBe('pending')
    expect(JSON.parse(pending?.schema_json as string)).toEqual({ type: 'number' })

    const won = await engine.resolveGate('gate-1', 'approval', { state: 'resolved', value: 41 }, 'sdk')
    expect(won).toBe(true)
    await expect(handle.result).resolves.toBe(42)
    const [settled] = readPromises(path)
    expect(settled?.state).toBe('resolved')
    expect(JSON.parse(settled?.payload_json as string)).toBe(41)
    expect(settled?.resolution_source).toBe('sdk')
    expect(settled?.resolved_at).not.toBeNull()
    const [doneRow] = readRuns(path)
    expect(doneRow?.status).toBe('done')
    expect(doneRow?.waiting_gate).toBeNull()
  })

  it('settles first-wins: a later resolve is a no-op and the body sees the first value', async () => {
    const path = await tmpPath('daypaw-gate-firstwins-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async run => (await run.waitFor('approval')))
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'gate-2' })
    await until(() => handle.status().state === 'waiting')
    await expect(engine.resolveGate('gate-2', 'approval', { state: 'resolved', value: 'first' }, 'sdk')).resolves.toBe(true)
    await expect(engine.resolveGate('gate-2', 'approval', { state: 'resolved', value: 'second' }, 'manager')).resolves.toBe(false)
    await expect(handle.result).resolves.toEqual({ state: 'resolved', value: 'first' })
    const [row] = readPromises(path)
    expect(JSON.parse(row?.payload_json as string)).toBe('first')
    expect(row?.resolution_source).toBe('sdk')
  })

  it('returns a rejected resolution as a programmable value', async () => {
    const path = await tmpPath('daypaw-gate-reject-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      const resolution = await run.waitFor('approval')
      return resolution.state === 'rejected' ? `rejected:${resolution.reason}` : 'other'
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'gate-3' })
    await until(() => handle.status().state === 'waiting')
    await engine.resolveGate('gate-3', 'approval', { state: 'rejected', reason: 'denied-by-user' }, 'manager')
    await expect(handle.result).resolves.toBe('rejected:denied-by-user')
    const [row] = readPromises(path)
    expect(row?.state).toBe('rejected')
    expect(JSON.parse(row?.payload_json as string)).toBe('denied-by-user')
  })

  it('times out a gate with no settlement', async () => {
    const path = await tmpPath('daypaw-gate-timeout-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      const resolution = await run.waitFor('approval', { timeout: 30 })
      return resolution.state
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'gate-4' })
    await expect(handle.result).resolves.toBe('timedout')
    const [row] = readPromises(path)
    expect(row?.state).toBe('timedout')
    expect(row?.timeout_at).not.toBeNull()
    expect(handle.status()).toEqual({ state: 'done' })
  })

  it('cancels a waiting run: the gate resolves cancelled and the run settles cancelled', async () => {
    const path = await tmpPath('daypaw-gate-cancel-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      const resolution = await run.waitFor('approval')
      expect(resolution).toEqual({ state: 'cancelled' })
      // A further primitive observes the driver abort and throws.
      await run.waitFor('later')
      return 'unreachable'
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'gate-5' })
    await until(() => handle.status().state === 'waiting')
    await handle.cancel('user-stopped')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = runError(error)
      return run.code === 'RUN_CANCELLED' && run.detail === 'user-stopped'
    })
    const [runRow] = readRuns(path)
    expect(runRow?.status).toBe('cancelled')
    const [promise] = readPromises(path)
    expect(promise?.state).toBe('cancelled')
  })

  it('discovers a cross-process cancellation when the body reaches the gate', async () => {
    const path = await tmpPath('daypaw-gate-cross-cancel-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    let release!: () => void
    const blocker = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async (run) => {
      await run.step('slow', async () => { await blocker; return 1 })
      await run.waitFor('approval')
      return 'unreachable'
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'gate-6' })
    await until(() => readRuns(path).length === 1)
    poke(path, ["UPDATE runs SET status = 'cancelled', cancel_cause = 'elsewhere', finished_at = 1 WHERE run_id = 'gate-6'"])
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = runError(error)
      return run.code === 'RUN_CANCELLED' && run.detail === 'elsewhere'
    })
  })

  it('revives a waiting run through the boot scan and resolves it after revival', async () => {
    const path = await tmpPath('daypaw-gate-revive-')
    const first = await boot(path)
    const effects: string[] = []
    const def = workflowDef(async (run) => {
      await run.step('one', async () => { effects.push('one'); return 1 })
      const resolution = await run.waitFor('approval', { schema: numberGate, timeout: 60_000 })
      if (resolution.state !== 'resolved') return -1
      // A second gate without a timeout re-suspends on the recorded row too.
      const extra = await run.waitFor('extra')
      return extra.state === 'resolved' ? resolution.value * 2 : -1
    })
    await first.engine.register(def)
    const handle = await first.engine.run(def, null, { runId: 'gate-7' })
    await until(() => handle.status().state === 'waiting')
    await first.ctx.fiber.dispose()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => runError(error).code === 'ENGINE_DISPOSED')
    const [midRun] = readRuns(path)
    expect(midRun?.status).toBe('waiting')
    const [midPromise] = readPromises(path)
    expect(midPromise?.state).toBe('pending')

    const second = await boot(path)
    contexts.push(second.ctx)
    await second.engine.register(def)
    const revived = await second.engine.run(def, null, { runId: 'gate-7' })
    await until(() => revived.status().state === 'waiting')
    expect(effects.filter(effect => effect === 'one')).toHaveLength(1)
    await second.engine.resolveGate('gate-7', 'approval', { state: 'resolved', value: 21 }, 'sdk')
    await until(() => {
      const status = revived.status()
      return status.state === 'waiting' && status.gate === 'extra'
    })
    await second.engine.resolveGate('gate-7', 'extra', { state: 'resolved', value: 'go' }, 'sdk')
    await expect(revived.result).resolves.toBe(42)
  })

  it('sweeps an overdue gate to timedout at boot before re-driving', async () => {
    const path = await tmpPath('daypaw-gate-overdue-')
    const first = await boot(path)
    const def = workflowDef(async (run) => {
      const resolution = await run.waitFor('approval', { timeout: 50 })
      return resolution.state
    })
    await first.engine.register(def)
    const handle = await first.engine.run(def, null, { runId: 'gate-8' })
    await until(() => handle.status().state === 'waiting')
    // The process dies before the in-process timeout fires.
    await first.ctx.fiber.dispose()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => runError(error).code === 'ENGINE_DISPOSED')
    await new Promise(resolve => setTimeout(resolve, 80))

    const second = await boot(path)
    contexts.push(second.ctx)
    await second.engine.register(def)
    const revived = await second.engine.run(def, null, { runId: 'gate-8' })
    await expect(revived.result).resolves.toBe('timedout')
    const [row] = readPromises(path)
    expect(row?.state).toBe('timedout')
  })

  it('resumes through the poll fallback when another process settles the gate', async () => {
    const path = await tmpPath('daypaw-gate-cross-')
    const driver = await boot(path, 10)
    const settler = await boot(path, 10)
    contexts.push(driver.ctx, settler.ctx)
    const def = workflowDef(async (run) => {
      const resolution = await run.waitFor('approval', { schema: numberGate })
      return resolution.state === 'resolved' ? resolution.value + 1 : -1
    })
    await driver.engine.register(def)
    const handle = await driver.engine.run(def, null, { runId: 'gate-9' })
    await until(() => handle.status().state === 'waiting')
    // The settling process holds no waiter, so no live schema validates the write.
    await expect(settler.engine.resolveGate('gate-9', 'approval', { state: 'resolved', value: 7 }, 'manager')).resolves.toBe(true)
    await expect(handle.result).resolves.toBe(8)
  })

  it('fails the run when a cross-process settlement fails delivery validation', async () => {
    const path = await tmpPath('daypaw-gate-badvalue-')
    const driver = await boot(path, 10)
    const settler = await boot(path, 10)
    contexts.push(driver.ctx, settler.ctx)
    const def = workflowDef(async run => (await run.waitFor('approval', { schema: numberGate })))
    await driver.engine.register(def)
    const handle = await driver.engine.run(def, null, { runId: 'gate-10' })
    await until(() => handle.status().state === 'waiting')
    await settler.engine.resolveGate('gate-10', 'approval', { state: 'resolved', value: 'not-a-number' }, 'manager')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = runError(error)
      return run.code === 'RUN_FAILED' && (run.detail as Error).message === 'expected a number'
    })
  })

  it('validates a same-process settlement before writing it', async () => {
    const path = await tmpPath('daypaw-gate-validate-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async run => (await run.waitFor('approval', { schema: numberGate })))
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'gate-11' })
    await until(() => handle.status().state === 'waiting')
    await expect(engine.resolveGate('gate-11', 'approval', { state: 'resolved', value: 'bad' }, 'sdk'))
      .rejects.toThrow('expected a number')
    expect(readPromises(path)[0]?.state).toBe('pending')
    await engine.resolveGate('gate-11', 'approval', { state: 'resolved', value: 5 }, 'sdk')
    await expect(handle.result).resolves.toEqual({ state: 'resolved', value: 5 })
  })

  it('rejects a second in-process wait on the same gate', async () => {
    const path = await tmpPath('daypaw-gate-dupwait-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async run => await Promise.all([run.waitFor('dup'), run.waitFor('dup')]))
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'gate-12' })
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = runError(error)
      return run.code === 'RUN_FAILED' && /already waits on gate dup/.test((run.detail as Error).message)
    })
  })

  it('returns the recorded outcome to a revived run without waiting again', async () => {
    const path = await tmpPath('daypaw-gate-dedup-')
    const first = await boot(path)
    const effects: string[] = []
    const def = workflowDef(async (run) => {
      const resolution = await run.waitFor('approval')
      effects.push(`wait:${resolution.state}`)
      return resolution.state
    })
    await first.engine.register(def)
    const handle = await first.engine.run(def, null, { runId: 'gate-13' })
    await until(() => handle.status().state === 'waiting')
    await first.engine.resolveGate('gate-13', 'approval', { state: 'rejected', reason: 'no' }, 'sdk')
    await expect(handle.result).resolves.toBe('rejected')
    contexts.push(first.ctx)
    // Crash between settlement and any further step leaves the run done here;
    // hand-craft the crash window instead: a waiting run whose gate settled.
    poke(path, [
      "INSERT INTO runs (run_id, def_kind, def_name, def_version, input_json, status, waiting_gate, attempt, created_at, updated_at) VALUES ('gate-14', 'workflow', 'gated', '1', 'null', 'waiting', 'approval', 1, 0, 0)",
      "INSERT INTO promises (run_id, gate, state, payload_json, resolution_source, created_at, resolved_at) VALUES ('gate-14', 'approval', 'rejected', '123', 'manager', 0, 1)",
    ])
    const second = await boot(path)
    contexts.push(second.ctx)
    await second.engine.register(def)
    const revived = await second.engine.run(def, null, { runId: 'gate-14' })
    // The rejection payload is a non-string; the reason surfaces defensively stringified.
    await expect(revived.result).resolves.toBe('rejected')
    expect(effects).toEqual(['wait:rejected', 'wait:rejected'])
  })

  it('delivers a recorded cancelled gate to a revived run', async () => {    const path = await tmpPath('daypaw-gate-cancelled-row-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      const resolution = await run.waitFor('approval')
      return resolution.state === 'cancelled' ? 'gate-cancelled' : 'other'
    })
    await engine.idle() // wait for the ledger to open before poking rows in
    poke(path, [
      "INSERT INTO runs (run_id, def_kind, def_name, def_version, input_json, status, waiting_gate, attempt, created_at, updated_at) VALUES ('gate-15', 'workflow', 'gated', '1', 'null', 'waiting', 'approval', 1, 0, 0)",
      "INSERT INTO promises (run_id, gate, state, created_at, resolved_at) VALUES ('gate-15', 'approval', 'cancelled', 0, 1)",
    ])
    await engine.register(def)
    const revived = await engine.run(def, null, { runId: 'gate-15' })
    await expect(revived.result).resolves.toBe('gate-cancelled')
  })

  it('keeps another run’s waiter untouched when a run settles', async () => {    const path = await tmpPath('daypaw-gate-neighbor-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const waiting = workflowDef(async run => (await run.waitFor('approval')), 'waiter')
    const quick = workflowDef(async () => 'quick-done', 'quick')
    await engine.register(waiting)
    await engine.register(quick)
    const parked = await engine.run(waiting, null, { runId: 'gate-16' })
    await until(() => parked.status().state === 'waiting')
    const done = await engine.run(quick, null, { runId: 'gate-17' })
    await expect(done.result).resolves.toBe('quick-done')
    expect(parked.status()).toEqual({ state: 'waiting', gate: 'approval' })
    await engine.resolveGate('gate-16', 'approval', { state: 'resolved', value: 'ok' }, 'sdk')
    await expect(parked.result).resolves.toEqual({ state: 'resolved', value: 'ok' })
  })

  it('sweeps an overdue gate for a live waiter in this process', async () => {
    const path = await tmpPath('daypaw-gate-live-sweep-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async run => (await run.waitFor('approval', { timeout: 60_000 })))
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'gate-18' })
    await until(() => handle.status().state === 'waiting')
    // Another writer rewinds the deadline into the past; the next registration
    // scan sweeps it and notifies the live waiter.
    poke(path, ['UPDATE promises SET timeout_at = 1 WHERE run_id = \'gate-18\''])
    await engine.register(workflowDef(async () => 'unrelated', 'unrelated'))
    await expect(handle.result).resolves.toEqual({ state: 'timedout' })
    const [row] = readPromises(path)
    expect(row?.state).toBe('timedout')
  })

  it('observes a cross-process cancellation without a cause at the gate', async () => {
    const path = await tmpPath('daypaw-gate-cross-cancel-nocause-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    let release!: () => void
    const blocker = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async (run) => {
      await run.step('slow', async () => { await blocker; return 1 })
      await run.waitFor('approval')
      return 'unreachable'
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'gate-19' })
    await until(() => readRuns(path).length === 1)
    poke(path, ["UPDATE runs SET status = 'cancelled', finished_at = 1 WHERE run_id = 'gate-19'"])
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = runError(error)
      return run.code === 'RUN_CANCELLED' && run.detail === undefined
    })
  })

  it('reads null settlement payloads defensively on revival', async () => {
    const path = await tmpPath('daypaw-gate-nullpayload-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async run => (await run.waitFor('approval')))
    await engine.idle()
    poke(path, [
      "INSERT INTO runs (run_id, def_kind, def_name, def_version, input_json, status, waiting_gate, attempt, created_at, updated_at) VALUES ('gate-20', 'workflow', 'gated', '1', 'null', 'waiting', 'approval', 1, 0, 0)",
      "INSERT INTO promises (run_id, gate, state, payload_json, created_at, resolved_at) VALUES ('gate-20', 'approval', 'resolved', NULL, 0, 1)",
      "INSERT INTO runs (run_id, def_kind, def_name, def_version, input_json, status, waiting_gate, attempt, created_at, updated_at) VALUES ('gate-21', 'workflow', 'gated', '1', 'null', 'waiting', 'approval', 1, 0, 0)",
      "INSERT INTO promises (run_id, gate, state, payload_json, created_at, resolved_at) VALUES ('gate-21', 'approval', 'rejected', NULL, 0, 1)",
    ])
    await engine.register(def)
    const resolved = await engine.run(def, null, { runId: 'gate-20' })
    await expect(resolved.result).resolves.toEqual({ state: 'resolved', value: null })
    const rejected = await engine.run(def, null, { runId: 'gate-21' })
    await expect(rejected.result).resolves.toEqual({ state: 'rejected', reason: 'null' })
  })
})
