import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { openLedgerDatabase } from '@daypaw/store'
import DurableEngine from '@daypaw/engine'
import type { EngineDefinition, EngineRunError, EngineStepCtx } from '@daypaw/engine'

/** Workflow definition helper: opaque body thunk around one body function. */
function workflowDef(
  body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>,
  name = 'sleepy',
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

function readTimers(path: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM timers ORDER BY rowid').all()
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

/**
 * The injected-clock fixture: one run row left by a dead process plus the
 * timer row a previous drive recorded, so a boot scan revives the run into a
 * sleep whose deadline the test places in the past, ahead, or behind a
 * recorded wake.
 */
function stageRunWithTimer(path: string, runId: string, stepKey: string, wakeAt: number, fired: number, at: number): Promise<void> {
  return openLedgerDatabase(path).then((db) => {
    db.close()
    poke(path, [
      `INSERT INTO runs (run_id, def_kind, def_name, def_version, input_json, status, attempt, claimed_by, claimed_at, created_at, updated_at)
        VALUES ('${runId}', 'workflow', 'sleepy', '1', 'null', 'running', 1, 'dead-instance', ${at}, ${at}, ${at})`,
      `INSERT INTO timers (run_id, step_key, wake_at, fired, created_at)
        VALUES ('${runId}', '${stepKey}', ${wakeAt}, ${fired}, ${at})`,
    ])
  })
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

describe('durable timers (ctx.sleep)', () => {
  it('records a timer row, parks the run, and wakes it at the deadline', async () => {
    const path = await tmpPath('daypaw-sleep-happy-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const started = Date.now()
    const def = workflowDef(async (run) => {
      const before = await run.step('before', async () => 1)
      await run.sleep(60)
      return before + 1
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'sleep-1' })
    // A sleeping run stays `running`: a sleep is not a gate.
    expect(handle.status()).toEqual({ state: 'running' })
    await expect(handle.result).resolves.toBe(2)
    expect(Date.now() - started).toBeGreaterThanOrEqual(50)

    const [timer] = readTimers(path)
    expect(timer?.step_key).toBe('sleep:0')
    expect(timer?.fired).toBe(1)
    expect(Number(timer?.wake_at) - Number(timer?.created_at)).toBe(60)
    const [runRow] = readRuns(path)
    expect(runRow?.status).toBe('done')
    expect(runRow?.waiting_gate).toBeNull()
  })

  it('returns without parking when the recorded deadline already passed (overdue re-delivery)', async () => {
    const path = await tmpPath('daypaw-sleep-overdue-')
    const first = await boot(path)
    const effects: string[] = []
    const def = workflowDef(async (run) => {
      await run.step('before', async () => { effects.push('before'); return 1 })
      // The declared duration is irrelevant once a deadline is recorded: the
      // revived body must not wait again for a deadline that already passed.
      await run.sleep(60_000)
      await run.step('after', async () => { effects.push('after'); return 2 })
      return 'woken'
    })
    await first.engine.register(def)
    const handle = await first.engine.run(def, null, { runId: 'sleep-overdue-1' })
    await until(() => readTimers(path).length === 1)
    // The process dies while parked; the deadline passes while it is down.
    await first.ctx.fiber.dispose()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => runError(error).code === 'ENGINE_DISPOSED')
    const [parked] = readTimers(path)
    expect(parked?.fired).toBe(0)
    poke(path, [
      `UPDATE timers SET wake_at = ${Date.now() - 10} WHERE run_id = 'sleep-overdue-1' AND step_key = 'sleep:0'`,
    ])

    const second = await boot(path)
    contexts.push(second.ctx)
    await second.engine.register(def)
    const revived = await second.engine.run(def, null, { runId: 'sleep-overdue-1' })
    await expect(revived.result).resolves.toBe('woken')
    expect(effects).toEqual(['before', 'after'])
    const [timer] = readTimers(path)
    expect(timer?.fired).toBe(1)
    expect(Number(timer?.wake_at)).toBeLessThan(Date.now())
  })

  it('waits for the recorded deadline rather than a re-declared duration', async () => {
    const path = await tmpPath('daypaw-sleep-recorded-')
    const now = Date.now()
    await stageRunWithTimer(path, 'sleep-recorded-1', 'sleep:0', now + 120, 0, now)
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      await run.sleep(60_000)
      return 'woken'
    })
    await engine.register(def)
    const started = Date.now()
    const revived = await engine.run(def, null, { runId: 'sleep-recorded-1' })
    await expect(revived.result).resolves.toBe('woken')
    const elapsed = Date.now() - started
    // The recorded deadline governs: the revived body waits for the remaining
    // 120ms, not for the 60s it declares on this drive.
    expect(elapsed).toBeGreaterThanOrEqual(100)
    expect(elapsed).toBeLessThan(2_000)
    expect(readTimers(path)[0]?.fired).toBe(1)
  })

  it('returns immediately when the wake is already recorded, however far the deadline', async () => {
    const path = await tmpPath('daypaw-sleep-fired-')
    const now = Date.now()
    await stageRunWithTimer(path, 'sleep-fired-1', 'sleep:0', now + 600_000, 1, now)
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      await run.sleep(600_000)
      return 'woken'
    })
    await engine.register(def)
    const started = Date.now()
    const revived = await engine.run(def, null, { runId: 'sleep-fired-1' })
    await expect(revived.result).resolves.toBe('woken')
    expect(Date.now() - started).toBeLessThan(1_000)
    const [timer] = readTimers(path)
    expect(timer?.fired).toBe(1)
    expect(Number(timer?.wake_at)).toBe(now + 600_000)
  })

  it('boot scan records the passed deadline of a timer whose run it cannot revive', async () => {
    const path = await tmpPath('daypaw-sleep-sweep-')
    const now = Date.now()
    await stageRunWithTimer(path, 'sleep-sweep-1', 'sleep:0', now - 5, 0, now)
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    // An unrelated definition: the scan runs, but nothing revives the run.
    await engine.register(workflowDef(async () => 'other', 'other'))

    await until(() => readTimers(path)[0]?.fired === 1)
    const [runRow] = readRuns(path)
    expect(runRow?.status).toBe('running')
  })

  it('records an overdue deadline at the current time for a non-positive duration', async () => {
    const path = await tmpPath('daypaw-sleep-zero-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      await run.sleep(0)
      return 'woken'
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'sleep-zero-1' })
    await expect(handle.result).resolves.toBe('woken')
    const [timer] = readTimers(path)
    expect(timer?.fired).toBe(1)
    expect(timer?.wake_at).toBe(timer?.created_at)
  })

  it('sleeps two concurrent timers of one run on their own keys, in deadline order', async () => {
    const path = await tmpPath('daypaw-sleep-parallel-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      const wakes: string[] = []
      await Promise.all([
        run.sleep(40).then(() => { wakes.push('short') }),
        run.sleep(120).then(() => { wakes.push('long') }),
      ])
      return wakes
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'sleep-parallel-1' })
    await expect(handle.result).resolves.toEqual(['short', 'long'])
    expect(readTimers(path).map(timer => [timer.step_key, timer.fired])).toEqual([
      ['sleep:0', 1],
      ['sleep:1', 1],
    ])
  })

  it('cancels a sleeping run without recording a wake it never took', async () => {
    const path = await tmpPath('daypaw-sleep-cancel-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      await run.sleep(60_000)
      return 'unreachable'
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'sleep-cancel-1' })
    await until(() => readTimers(path).length === 1)
    await handle.cancel('user-stopped')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = runError(error)
      return run.code === 'RUN_CANCELLED' && run.detail === 'user-stopped'
    })
    const [runRow] = readRuns(path)
    expect(runRow?.status).toBe('cancelled')
    expect(readTimers(path)[0]?.fired).toBe(0)
  })

  it('discovers a cross-process cancellation while parked on a timer', async () => {
    const path = await tmpPath('daypaw-sleep-cross-cancel-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      await run.sleep(60_000)
      return 'unreachable'
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'sleep-cross-1' })
    await until(() => readTimers(path).length === 1)
    poke(path, ["UPDATE runs SET status = 'cancelled', cancel_cause = 'elsewhere', finished_at = 1 WHERE run_id = 'sleep-cross-1'"])
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = runError(error)
      return run.code === 'RUN_CANCELLED' && run.detail === 'elsewhere'
    })
  })

  it('reports a cross-process cancellation that recorded no cause', async () => {
    const path = await tmpPath('daypaw-sleep-cross-nocause-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      await run.sleep(60_000)
      return 'unreachable'
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'sleep-cross-nocause-1' })
    await until(() => readTimers(path).length === 1)
    poke(path, ["UPDATE runs SET status = 'cancelled', cancel_cause = NULL, finished_at = 1 WHERE run_id = 'sleep-cross-nocause-1'"])
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = runError(error)
      return run.code === 'RUN_CANCELLED' && run.detail === undefined
    })
  })

  it('fails the sleep when another writer settles the run while it parks', async () => {
    const path = await tmpPath('daypaw-sleep-terminal-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    const def = workflowDef(async (run) => {
      await run.sleep(60_000)
      return 'unreachable'
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'sleep-terminal-1' })
    await until(() => readTimers(path).length === 1)
    poke(path, ["UPDATE runs SET status = 'failed', error_json = '{\"message\":\"elsewhere\"}', finished_at = 1 WHERE run_id = 'sleep-terminal-1'"])
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = runError(error).detail
      return detail instanceof Error
        && detail.message.includes('reached terminal state failed while sleeping on timer sleep:0')
    })
  })

  it('leaves a sleeping run revivable when the engine is disposed mid-sleep', async () => {
    const path = await tmpPath('daypaw-sleep-dispose-')
    const first = await boot(path)
    const def = workflowDef(async (run) => {
      await run.sleep(60_000)
      return 'woken'
    })
    await first.engine.register(def)
    const handle = await first.engine.run(def, null, { runId: 'sleep-dispose-1' })
    await until(() => readTimers(path).length === 1)
    await first.ctx.fiber.dispose()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => runError(error).code === 'ENGINE_DISPOSED')
    const [parked] = readRuns(path)
    expect(parked?.status).toBe('running')
    expect(readTimers(path)[0]?.fired).toBe(0)
  })

  it('re-drives a run that died mid-sleep without doubling the effects around it', async () => {
    const path = await tmpPath('daypaw-sleep-redrive-')
    const first = await boot(path)
    const effects: string[] = []
    const def = workflowDef(async (run) => {
      await run.step('before', async () => { effects.push('before'); return 1 })
      await run.sleep(80)
      await run.step('after', async () => { effects.push('after'); return 2 })
      return 'woken'
    })
    await first.engine.register(def)
    const handle = await first.engine.run(def, null, { runId: 'sleep-redrive-1' })
    await until(() => readTimers(path).length === 1)
    // Die while parked, then come back after the deadline passed.
    await first.ctx.fiber.dispose()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => runError(error).code === 'ENGINE_DISPOSED')
    await new Promise(resolve => setTimeout(resolve, 120))

    const second = await boot(path)
    contexts.push(second.ctx)
    await second.engine.register(def)
    const revived = await second.engine.run(def, null, { runId: 'sleep-redrive-1' })
    const started = Date.now()
    await expect(revived.result).resolves.toBe('woken')
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(effects).toEqual(['before', 'after'])
    expect(readTimers(path)[0]?.fired).toBe(1)
  })

  it('fails a sleep wait the body abandoned when it settles the run without awaiting', async () => {
    const path = await tmpPath('daypaw-sleep-abandoned-')
    const { ctx, engine } = await boot(path)
    contexts.push(ctx)
    let parked: Promise<unknown> | undefined
    const def = workflowDef(async (run) => {
      parked = run.sleep(60_000)
      return 'done-anyway'
    })
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'sleep-abandoned-1' })
    await expect(handle.result).resolves.toBe('done-anyway')
    // The parked wait ends with its driver instead of outliving it.
    await expect(parked).rejects.toSatisfy((error: unknown) => {
      const detail = runError(error).detail
      return detail instanceof Error && detail.message.includes('settled while a sleep wait was still pending')
    })
    expect(readTimers(path)[0]?.fired).toBe(0)
  })
})
