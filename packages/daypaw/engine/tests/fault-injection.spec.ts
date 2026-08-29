import { describe, expect, it } from 'vitest'
import { openLedgerDatabase } from '@daypaw/store'
import { DurableEngineCore, SqliteJournalStore } from '@daypaw/engine'
import type { EngineDefinition, EngineStepCtx, JournalStore } from '@daypaw/engine'

/** Fault points: every JournalStore method, as the injectable surface. */
type Faults = Partial<Record<keyof JournalStore, Error>>

/**
 * Proxy a real store with named faults: a faulted method throws before
 * delegating; clearing the entry restores the pass-through.
 */
type Overrides = Partial<Record<keyof JournalStore, (...args: never[]) => unknown>>

function wrapStore(inner: JournalStore, faults: Faults, overrides: Overrides): JournalStore {
  return new Proxy(inner, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'string') {
        const fault = faults[prop as keyof JournalStore]
        if (fault !== undefined) throw fault
        const override = overrides[prop as keyof JournalStore]
        if (override !== undefined) return override
      }
      const value = Reflect.get(target, prop, inner) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(inner) : value
    },
  })
}

function workflowDef(
  body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>,
  name = 'faulted',
): EngineDefinition {
  return { kind: 'workflow', name, version: '1', body }
}

interface Fixture {
  store: JournalStore
  faults: Faults
  overrides: Partial<Record<keyof JournalStore, (...args: never[]) => unknown>>
  warnings: string[]
  makeCore(): DurableEngineCore
}

async function fixture(): Promise<Fixture> {
  const db = await openLedgerDatabase(':memory:')
  const inner = new SqliteJournalStore(db)
  const faults: Faults = {}
  const overrides: Partial<Record<keyof JournalStore, (...args: never[]) => unknown>> = {}
  const warnings: string[] = []
  const store = wrapStore(inner, faults, overrides)
  let counter = 0
  return {
    store,
    faults,
    overrides,
    warnings,
    makeCore: () => new DurableEngineCore(store, {
      instanceId: `core-${counter += 1}`,
      pollMs: 5,
      logger: { warn: message => warnings.push(message) },
    }),
  }
}

describe('fault injection at journal append points', () => {
  it('propagates a selectRun failure out of run()', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = workflowDef(async () => 1)
    core.register(def)
    f.faults.selectRun = new Error('inject: selectRun')
    expect(() => core.run(def, null, { runId: 'f1' })).toThrow('inject: selectRun')
  })

  it('propagates an insertRun failure out of run()', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = workflowDef(async () => 1)
    core.register(def)
    f.faults.insertRun = new Error('inject: insertRun')
    expect(() => core.run(def, null, { runId: 'f2' })).toThrow('inject: insertRun')
  })

  it('fails the run when the step lookup faults', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = workflowDef(async run => (await run.step('a', async () => 1)))
    core.register(def)
    f.faults.selectJournalStep = new Error('inject: selectJournalStep')
    const handle = core.run(def, null)
    await expect(handle.result).rejects.toThrow('RUN_FAILED')
    delete f.faults.selectJournalStep
  })

  it('fails the run before the effect when the started-row insert faults', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const effects: number[] = []
    const def = workflowDef(async run => (await run.step('a', async () => { effects.push(1); return 1 })))
    core.register(def)
    f.faults.insertJournalStep = new Error('inject: insertJournalStep')
    const handle = core.run(def, null)
    await expect(handle.result).rejects.toThrow('RUN_FAILED')
    expect(effects).toEqual([])
    expect(f.store.selectJournalStep(handle.id, 'a#0')).toBeUndefined()
  })

  it('records a failed step when the completion write faults, and the effect did run', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const effects: number[] = []
    const def = workflowDef(async run => (await run.step('a', async () => { effects.push(1); return 'value' })))
    core.register(def)
    f.faults.completeJournalStep = new Error('inject: completeJournalStep')
    const handle = core.run(def, null)
    await expect(handle.result).rejects.toThrow('RUN_FAILED')
    expect(effects).toEqual([1])
    const step = f.store.selectJournalStep(handle.id, 'a#0')
    expect(step?.status).toBe('failed')
    delete f.faults.completeJournalStep
  })

  it('prefers the original step error and warns when the failure write also faults', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = workflowDef(async run => (await run.step('a', async () => { throw new Error('original-boom') })))
    core.register(def)
    f.faults.failJournalStep = new Error('inject: failJournalStep')
    const handle = core.run(def, null)
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message === 'original-boom'
    })
    expect(f.warnings.some(message => message.includes('recording failure of step'))).toBe(true)
    delete f.faults.failJournalStep
  })

  it('reports a failed run and warns when both finalize writes fault', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = workflowDef(async () => 'never-recorded')
    core.register(def)
    f.faults.finalizeRun = new Error('inject: finalizeRun')
    const handle = core.run(def, null)
    await expect(handle.result).rejects.toThrow('RUN_FAILED')
    expect(f.warnings.some(message => message.includes('recording failure'))).toBe(true)
    delete f.faults.finalizeRun
  })

  it('propagates an unfinished-scan failure out of bootScan()', async () => {
    const f = await fixture()
    const core = f.makeCore()
    f.faults.selectUnfinishedRunIds = new Error('inject: selectUnfinishedRunIds')
    expect(() =>{  core.bootScan() }).toThrow('inject: selectUnfinishedRunIds')
  })

  it('warns and leaves the run unfinished when the boot scan lacks the definition', async () => {
    const f = await fixture()
    const now = Date.now()
    f.store.insertRun({
      runId: 'orphan-1',
      defKind: 'workflow',
      defName: 'faulted',
      defVersion: '1',
      inputJson: 'null',
      parentRunId: undefined,
      parentStepKey: undefined,
      claimedBy: 'dead-instance',
      claimedAt: now,
      createdAt: now,
    })
    const second = f.makeCore()
    second.bootScan()
    expect(f.warnings.some(message => message.includes('not registered'))).toBe(true)
    expect(f.store.selectRun('orphan-1')?.status).toBe('running')
    // Registering the definition later revives on the registration scan
    // (the run is already claimed by this instance).
    const def = workflowDef(async () => 'revived')
    second.register(def)
    await second.idle()
    expect(f.store.selectRun('orphan-1')?.status).toBe('done')
  })

  it('re-claims and re-drives a run claimed by another instance (dead-claim reassignment)', async () => {
    const f = await fixture()
    const first = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 1 })))
    first.register(def)
    first.run(def, null, { runId: 'held-1' })
    const second = f.makeCore()
    second.register(def)
    release()
    await first.idle()
    await second.idle()
    expect(f.store.selectRun('held-1')?.status).toBe('done')
    expect(f.store.selectRun('held-1')?.claimed_by).toBe('core-2')
  })

  it('skips a run this instance is already driving during a re-scan', async () => {
    const f = await fixture()
    const core = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 'driving' })))
    core.register(def)
    const handle = core.run(def, null, { runId: 'driving-1' })
    // Registering an unrelated definition triggers a scan while driving.
    core.register(workflowDef(async () => 'other', 'other'))
    release()
    await expect(handle.result).resolves.toBe('driving')
    await core.idle()
    expect(f.store.selectRun('driving-1')?.claimed_by).toBe('core-1')
  })

  it('revives a run left by a disposed core through the registration scan', async () => {
    const f = await fixture()
    const first = f.makeCore()
    const effects: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async (run) => {
      const a = await run.step('one', async () => { effects.push('one'); return 1 })
      const b = await run.step('two', async () => { await gate; effects.push('two'); return a + 1 })
      return b
    })
    first.register(def)
    const handle = first.run(def, null, { runId: 'crash-1' })
    await new Promise(resolve => setImmediate(resolve))
    first.dispose()
    release()
    await expect(handle.result).rejects.toThrow('ENGINE_DISPOSED')
    const second = f.makeCore()
    second.register(def)
    await second.idle()
    expect(f.store.selectRun('crash-1')?.status).toBe('done')
    expect(effects.filter(effect => effect === 'one').length).toBe(1)
    expect(effects.filter(effect => effect === 'two').length).toBeGreaterThanOrEqual(1)
  })

  it('reports the terminal row when a body completes after its run was settled elsewhere', async () => {
    const f = await fixture()
    const core = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 'late' })))
    core.register(def)
    const handle = core.run(def, null, { runId: 'settled-elsewhere' })
    // Another writer settles the run while this driver's step is in flight.
    f.store.finalizeRun('settled-elsewhere', {
      status: 'done',
      outputJson: JSON.stringify('early'),
      errorJson: undefined,
      cancelCause: undefined,
      finishedAt: Date.now(),
    })
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) =>
      (error as { detail?: { message?: string } }).detail instanceof Error
      && (error as { detail: Error }).detail.message.includes('terminal state done before completion'))
  })

  it('rejects use after dispose', async () => {
    const f = await fixture()
    const core = f.makeCore()
    core.dispose()
    const def = workflowDef(async () => 1)
    expect(() =>{  core.register(def) }).toThrow('ENGINE_DISPOSED')
    expect(() =>{  core.bootScan() }).toThrow('ENGINE_DISPOSED')
  })

  it('warns when the boot scan sees a run whose row vanished', async () => {
    const f = await fixture()
    f.overrides.selectUnfinishedRunIds = () => ['ghost']
    const core = f.makeCore()
    core.bootScan()
    expect(f.warnings.some(message => message.includes('row vanished'))).toBe(true)
  })

  it('fails a step whose run row vanished underneath it', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = workflowDef(async run => (await run.step('a', async () => 1)))
    core.register(def)
    f.overrides.selectRun = () => undefined
    const handle = core.run(def, null, { runId: 'lost-1' })
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message.includes('ledger lost run lost-1')
    })
    delete f.overrides.selectRun
  })

  it('throws on status() when the ledger loses the run row', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = workflowDef(async () => 'quick')
    core.register(def)
    const handle = core.run(def, null)
    await handle.result
    f.overrides.selectRun = () => undefined
    expect(() => handle.status()).toThrow('ledger lost')
    delete f.overrides.selectRun
  })

  it('settles attaches from crafted terminal rows, including null and crafted payloads', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = workflowDef(async () => 'x')
    core.register(def)
    const base = { run_id: 'crafted-1', def_kind: 'workflow', def_name: 'faulted', def_version: '1', input_json: 'null', status: 'done', waiting_gate: null, parent_run_id: null, parent_step_key: null, attempt: 1, retried_from_run_id: null, output_json: null, error_json: null, cancel_cause: null, claimed_by: null, claimed_at: null, created_at: 0, updated_at: 0, finished_at: 0 } as const
    f.overrides.selectRun = (() => base)
    await expect(core.run(def, null, { runId: 'crafted-1' }).result).resolves.toBeNull()
    f.overrides.selectRun = (() => ({ ...base, status: 'failed' }))
    const failed = core.run(def, null, { runId: 'crafted-1' })
    await expect(failed.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'RUN_FAILED')
    expect(failed.status()).toEqual({ state: 'failed', error: undefined })
    f.overrides.selectRun = (() => ({ ...base, status: 'failed', error_json: JSON.stringify({ code: 'APP_BOOM', message: 'crafted failure' }) }))
    const detailed = core.run(def, null, { runId: 'crafted-1' })
    await expect(detailed.result).rejects.toSatisfy((error: unknown) => {
      const run = error as { code?: string; detail?: unknown }
      return run.code === 'RUN_FAILED' && (run.detail as { code?: string }).code === 'APP_BOOM'
    })
    expect(detailed.status()).toEqual({ state: 'failed', error: { code: 'APP_BOOM', message: 'crafted failure' } })
    f.overrides.selectRun = (() => ({ ...base, status: 'cancelled' }))
    const cancelled = core.run(def, null, { runId: 'crafted-1' })
    await expect(cancelled.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'RUN_CANCELLED')
    expect(cancelled.status()).toEqual({ state: 'cancelled' })
    delete f.overrides.selectRun
  })

  it('treats a second dispose as a no-op', async () => {
    const f = await fixture()
    const core = f.makeCore()
    core.dispose()
    expect(() => { core.dispose() }).not.toThrow()
  })

  it('stops attach polls with ENGINE_DISPOSED on dispose', async () => {
    const f = await fixture()
    const first = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 1 })))
    const second = f.makeCore()
    second.register(def)
    first.register(def)
    first.run(def, null, { runId: 'poll-dispose-1' })
    const attached = second.run(def, null, { runId: 'poll-dispose-1' })
    second.dispose()
    await expect(attached.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'ENGINE_DISPOSED')
    release()
    await first.idle()
  })

  it('stringifies a non-string abort cause into cancel_cause', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = workflowDef(async run => (await run.step('a', async () => 1)))
    core.register(def)
    const controller = new AbortController()
    controller.abort({ code: 'caller-object' })
    const handle = core.run(def, null, { runId: 'reason-1', signal: controller.signal })
    await expect(handle.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'RUN_CANCELLED')
    expect(f.store.selectRun('reason-1')?.cancel_cause).toBe('{"code":"caller-object"}')
  })

  it('forwards a mid-run caller abort at the next step boundary', async () => {
    const f = await fixture()
    const core = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const effects: string[] = []
    const def = workflowDef(async (run) => {
      await run.step('one', async () => { effects.push('one'); return 1 })
      await run.step('two', async () => { await gate; effects.push('two'); return 2 })
      await run.step('three', async () => { effects.push('three'); return 3 })
      return 0
    })
    core.register(def)
    const controller = new AbortController()
    const handle = core.run(def, null, { runId: 'mid-abort-1', signal: controller.signal })
    await new Promise(resolve => setImmediate(resolve))
    controller.abort('mid-run-stop')
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'RUN_CANCELLED')
    expect(effects).toEqual(['one', 'two'])
    expect(f.store.selectRun('mid-abort-1')?.cancel_cause).toBe('mid-run-stop')
  })

  it('rejects DISPOSED when a step throws after engine disposal', async () => {
    const f = await fixture()
    const core = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('late-boom', async () => {
      await gate
      throw new Error('late-boom')
    })))
    core.register(def)
    const handle = core.run(def, null, { runId: 'late-throw-1' })
    await new Promise(resolve => setImmediate(resolve))
    core.dispose()
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'ENGINE_DISPOSED')
    expect(f.store.selectRun('late-throw-1')?.status).toBe('running')
  })

  it('settles an attach poll on a run failed by another writer', async () => {
    const f = await fixture()
    const first = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 1 })))
    const second = f.makeCore()
    second.register(def)
    first.register(def)
    first.run(def, null, { runId: 'poll-fail-1' })
    const attached = second.run(def, null, { runId: 'poll-fail-1' })
    await new Promise(resolve => setTimeout(resolve, 15))
    f.store.finalizeRun('poll-fail-1', {
      status: 'failed',
      outputJson: undefined,
      errorJson: JSON.stringify({ message: 'external' }),
      cancelCause: undefined,
      finishedAt: Date.now(),
    })
    await expect(attached.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'RUN_FAILED')
    release()
    await first.idle()
  })

  it('settles an attach poll on a run cancelled by another writer', async () => {
    const f = await fixture()
    const first = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 1 })))
    const second = f.makeCore()
    second.register(def)
    first.register(def)
    first.run(def, null, { runId: 'poll-cancel-1' })
    const attached = second.run(def, null, { runId: 'poll-cancel-1' })
    await new Promise(resolve => setTimeout(resolve, 15))
    f.store.finalizeRun('poll-cancel-1', {
      status: 'cancelled',
      outputJson: undefined,
      errorJson: undefined,
      cancelCause: 'external-stop',
      finishedAt: Date.now(),
    })
    await expect(attached.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'RUN_CANCELLED')
    release()
    await first.idle()
  })

  it('records a non-Error step throw as its message', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = workflowDef(async run => (await run.step('raw', async () => { throw 'plain-string-boom' })))
    core.register(def)
    const handle = core.run(def, null)
    await expect(handle.result).rejects.toSatisfy((error: unknown) =>
      (error as { detail?: unknown }).detail === 'plain-string-boom')
    const step = f.store.selectJournalStep(handle.id, 'raw#0')
    expect(JSON.parse(step?.error_json ?? '{}')).toEqual({ message: 'plain-string-boom' })
  })

  it('observes a cancelled row without a cause at the next step boundary', async () => {
    const f = await fixture()
    const core = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async (run) => {
      await run.step('one', async () => 1)
      await run.step('two', async () => { await gate; return 2 })
      await run.step('three', async () => 3)
      return 0
    })
    core.register(def)
    const handle = core.run(def, null, { runId: 'nocause-1' })
    await new Promise(resolve => setImmediate(resolve))
    f.store.finalizeRun('nocause-1', {
      status: 'cancelled',
      outputJson: undefined,
      errorJson: undefined,
      cancelCause: undefined,
      finishedAt: Date.now(),
    })
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string; detail?: unknown }).code === 'RUN_CANCELLED'
      && (error as { detail?: unknown }).detail === undefined)
  })

  it('routes a throwing in-flight step through the aborted path', async () => {
    const f = await fixture()
    const core = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('late-throw', async () => {
      await gate
      throw new Error('after-abort-boom')
    })))
    core.register(def)
    const controller = new AbortController()
    const handle = core.run(def, null, { runId: 'abort-throw-1', signal: controller.signal })
    await new Promise(resolve => setImmediate(resolve))
    controller.abort()
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'RUN_CANCELLED')
  })

  it('reports the row state as unknown when it vanishes before a late completion', async () => {
    const f = await fixture()
    const core = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 'late' })))
    core.register(def)
    const handle = core.run(def, null, { runId: 'vanish-1' })
    await new Promise(resolve => setImmediate(resolve))
    f.store.finalizeRun('vanish-1', {
      status: 'done',
      outputJson: JSON.stringify('early'),
      errorJson: undefined,
      cancelCause: undefined,
      finishedAt: Date.now(),
    })
    f.overrides.selectRun = () => undefined
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message.includes('terminal state unknown')
    })
    delete f.overrides.selectRun
  })

  it('settles a cancelled-without-cause row through the terminal race', async () => {
    const f = await fixture()
    const core = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 'late' })))
    core.register(def)
    const handle = core.run(def, null, { runId: 'race-nocause-1' })
    await new Promise(resolve => setImmediate(resolve))
    f.store.finalizeRun('race-nocause-1', {
      status: 'cancelled',
      outputJson: undefined,
      errorJson: undefined,
      cancelCause: undefined,
      finishedAt: Date.now(),
    })
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string; detail?: unknown }).code === 'RUN_CANCELLED'
      && (error as { detail?: unknown }).detail === undefined)
  })

  it('dedupes concurrent attach polls onto one handle', async () => {
    const f = await fixture()
    const first = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 'polled' })))
    const second = f.makeCore()
    second.register(def)
    first.register(def)
    first.run(def, null, { runId: 'dedupe-1' })
    const attached = second.run(def, null, { runId: 'dedupe-1' })
    expect(second.run(def, null, { runId: 'dedupe-1' })).toBe(attached)
    expect(attached.status()).toEqual({ state: 'running' })
    await attached.cancel()
    await expect(attached.result).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string; detail?: unknown }).code === 'RUN_CANCELLED'
      && (error as { detail?: unknown }).detail === undefined)
    release()
    await first.idle()
  })

  it('fails an attach poll when the row vanishes mid-poll', async () => {
    const f = await fixture()
    const first = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 1 })))
    const second = f.makeCore()
    second.register(def)
    first.register(def)
    first.run(def, null, { runId: 'poll-vanish-1' })
    const attached = second.run(def, null, { runId: 'poll-vanish-1' })
    await new Promise(resolve => setTimeout(resolve, 15))
    f.overrides.selectRun = () => undefined
    await expect(attached.result).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string }).code === 'RUN_FAILED')
    delete f.overrides.selectRun
    release()
    await first.idle()
  })

  it('resolves an attach poll with null when a done row has no output', async () => {
    const f = await fixture()
    const first = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 1 })))
    const second = f.makeCore()
    second.register(def)
    first.register(def)
    first.run(def, null, { runId: 'poll-nullout-1' })
    const attached = second.run(def, null, { runId: 'poll-nullout-1' })
    await new Promise(resolve => setTimeout(resolve, 15))
    f.store.finalizeRun('poll-nullout-1', {
      status: 'done',
      outputJson: undefined,
      errorJson: undefined,
      cancelCause: undefined,
      finishedAt: Date.now(),
    })
    await expect(attached.result).resolves.toBeNull()
    release()
    await first.idle()
  })

  it('rejects an attach poll without detail when a failed row has no error', async () => {
    const f = await fixture()
    const first = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async run => (await run.step('held', async () => { await gate; return 1 })))
    const second = f.makeCore()
    second.register(def)
    first.register(def)
    first.run(def, null, { runId: 'poll-nullerr-1' })
    const attached = second.run(def, null, { runId: 'poll-nullerr-1' })
    await new Promise(resolve => setTimeout(resolve, 15))
    f.store.finalizeRun('poll-nullerr-1', {
      status: 'failed',
      outputJson: undefined,
      errorJson: undefined,
      cancelCause: undefined,
      finishedAt: Date.now(),
    })
    await expect(attached.result).rejects.toSatisfy((error: unknown) =>
      (error as { code?: string; detail?: unknown }).code === 'RUN_FAILED'
      && (error as { detail?: unknown }).detail === undefined)
    release()
    await first.idle()
  })

  it('returns null for a completed step row whose value column is null', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const seen: unknown[] = []
    const def = workflowDef(async (run) => {
      seen.push(await run.step('hollow', async () => 'never-returned'))
      return 'done'
    })
    core.register(def)
    f.overrides.selectJournalStep = ((runId: string, stepKey: string) => {
      if (runId === 'hollow-1' && stepKey === 'hollow#0') {
        return {
          run_id: runId, step_key: stepKey, name: 'hollow', occurrence: 0, kind: 'step',
          status: 'completed', value_json: null, error_json: null, attempt: 1,
          session_id: null, session_seq: null, started_at: 0, finished_at: 0,
        }
      }
      return undefined
    })
    const handle = core.run(def, null, { runId: 'hollow-1' })
    await expect(handle.result).resolves.toBe('done')
    expect(seen).toEqual([null])
    delete f.overrides.selectJournalStep
  })
})

describe('fault injection at gate append points', () => {
  /** Start a run parked on one gate; resolves once the pending row exists. */
  async function startWaiting(
    f: Fixture,
    runId: string,
    body: (ctx: EngineStepCtx) => Promise<unknown> = async run => (await run.waitFor('approval')),
  ) {
    const core = f.makeCore()
    const def = workflowDef(body)
    core.register(def)
    const handle = core.run(def, null, { runId })
    await new Promise(resolve => setTimeout(resolve, 15))
    return { core, handle }
  }

  it('fails the run when the gate lookup faults at waitFor entry', async () => {
    const f = await fixture()
    f.faults.selectPromise = new Error('inject: selectPromise')
    const { handle } = await startWaiting(f, 'gf-1')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message === 'inject: selectPromise'
    })
    delete f.faults.selectPromise
  })

  it('fails the run when the pending-row insert faults', async () => {
    const f = await fixture()
    f.faults.insertPromise = new Error('inject: insertPromise')
    const { handle } = await startWaiting(f, 'gf-2')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message === 'inject: insertPromise'
    })
    expect(f.store.selectPromise('gf-2', 'approval')).toBeUndefined()
    delete f.faults.insertPromise
  })

  it('fails the run when the waiting transition faults', async () => {
    const f = await fixture()
    f.faults.setRunWaiting = new Error('inject: setRunWaiting')
    const { handle } = await startWaiting(f, 'gf-3')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message === 'inject: setRunWaiting'
    })
    expect(f.store.selectRun('gf-3')?.status).toBe('failed')
    delete f.faults.setRunWaiting
  })

  it('fails the run when the wait starts after the run row vanished', async () => {
    const f = await fixture()
    f.overrides.selectRun = () => undefined
    const { handle } = await startWaiting(f, 'gf-4')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message.includes('ledger lost run gf-4')
    })
    delete f.overrides.selectRun
  })

  it('propagates a settle fault out of resolveGate and keeps the gate pending', async () => {
    const f = await fixture()
    const { core, handle } = await startWaiting(f, 'gf-5')
    f.faults.settlePromise = new Error('inject: settlePromise')
    expect(() =>{  core.resolveGate('gf-5', 'approval', { state: 'resolved', value: 1 }, 'sdk') })
      .toThrow('inject: settlePromise')
    expect(f.store.selectPromise('gf-5', 'approval')?.state).toBe('pending')
    delete f.faults.settlePromise
    expect(core.resolveGate('gf-5', 'approval', { state: 'resolved', value: 1 }, 'sdk')).toBe(true)
    await expect(handle.result).resolves.toEqual({ state: 'resolved', value: 1 })
  })

  it('fails the run when the timeout write faults', async () => {
    const f = await fixture()
    f.faults.settlePromise = new Error('inject: settlePromise')
    const { handle } = await startWaiting(f, 'gf-6', async run => (await run.waitFor('approval', { timeout: 10 })))
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message === 'inject: settlePromise'
    })
    delete f.faults.settlePromise
  })

  it('fails the run when the poll-tick lookup faults', async () => {
    const f = await fixture()
    const { handle } = await startWaiting(f, 'gf-7')
    f.faults.selectPromise = new Error('inject: selectPromise')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message === 'inject: selectPromise'
    })
    delete f.faults.selectPromise
  })

  it('fails the run when the poll tick finds the promise row vanished', async () => {
    const f = await fixture()
    const { handle } = await startWaiting(f, 'gf-8')
    f.overrides.selectPromise = () => undefined
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message.includes('ledger lost promise gf-8/approval')
    })
    delete f.overrides.selectPromise
  })

  it('fails the wait when delivery reads a still-pending row', async () => {
    const f = await fixture()
    const { core, handle } = await startWaiting(f, 'gf-9')
    const pending = f.store.selectPromise('gf-9', 'approval')
    f.overrides.selectPromise = () => pending
    core.resolveGate('gf-9', 'approval', { state: 'resolved', value: 1 }, 'sdk')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message.includes('still pending')
    })
    delete f.overrides.selectPromise
  })

  it('fails the wait when delivery reads a vanished row', async () => {
    const f = await fixture()
    const { core, handle } = await startWaiting(f, 'gf-10')
    f.overrides.selectPromise = () => undefined
    core.resolveGate('gf-10', 'approval', { state: 'resolved', value: 1 }, 'sdk')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message.includes('ledger lost promise gf-10/approval')
    })
    delete f.overrides.selectPromise
  })

  it('fails the wait when the resume write faults during delivery', async () => {
    const f = await fixture()
    const { core, handle } = await startWaiting(f, 'gf-11')
    f.faults.resumeRun = new Error('inject: resumeRun')
    core.resolveGate('gf-11', 'approval', { state: 'resolved', value: 1 }, 'sdk')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message === 'inject: resumeRun'
    })
    delete f.faults.resumeRun
  })

  it('rejects cancel() when the promise-cancellation write faults', async () => {
    const f = await fixture()
    const { handle } = await startWaiting(f, 'gf-12')
    f.faults.cancelPendingPromises = new Error('inject: cancelPendingPromises')
    await expect(handle.cancel('stop')).rejects.toThrow('inject: cancelPendingPromises')
    delete f.faults.cancelPendingPromises
    await handle.cancel('stop')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'RUN_CANCELLED')
  })

  it('propagates an overdue-scan failure out of the boot scan', async () => {
    const f = await fixture()
    f.faults.selectOverduePromises = new Error('inject: selectOverduePromises')
    const core = f.makeCore()
    expect(() =>{  core.bootScan() }).toThrow('inject: selectOverduePromises')
    delete f.faults.selectOverduePromises
  })

  it('rejects a wait entered after disposal', async () => {
    const f = await fixture()
    const core = f.makeCore()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const def = workflowDef(async (run) => {
      await run.step('held', async () => { await gate; return 1 })
      await run.waitFor('approval')
      return 'unreachable'
    })
    core.register(def)
    const handle = core.run(def, null, { runId: 'gf-13' })
    await new Promise(resolve => setImmediate(resolve))
    core.dispose()
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) => (error as { code?: string }).code === 'ENGINE_DISPOSED')
  })

  it('rejects resolveGate after disposal', async () => {
    const f = await fixture()
    const core = f.makeCore()
    core.dispose()
    expect(() =>{  core.resolveGate('gf-14', 'approval', { state: 'resolved', value: 1 }, 'sdk') })
      .toThrow('ENGINE_DISPOSED')
  })
})

describe('fault injection at steer append points (issue #53)', () => {
  /** Steerable definition helper: the engine gate is the `steerable` flag, not the kind. */
  function steerableDef(body: (ctx: EngineStepCtx) => Promise<unknown>): EngineDefinition {
    return { kind: 'workflow', name: 'steerable', version: '1', steerable: true, body }
  }

  /** Start a run parked for its first steer; resolves once the body reached the park. */
  async function startParked(
    f: Fixture,
    runId: string,
    body: (ctx: EngineStepCtx) => Promise<unknown> = async (run) => { await run.awaitSteer(0); return 'steered' },
  ) {
    const core = f.makeCore()
    const def = steerableDef(body)
    core.register(def)
    const handle = core.run(def, null, { runId })
    await new Promise(resolve => setTimeout(resolve, 15))
    return { core, handle }
  }

  it('propagates a segment-listing failure out of steer()', async () => {
    const f = await fixture()
    const { core } = await startParked(f, 'sf-1')
    f.faults.selectJournalSegments = new Error('inject: selectJournalSegments')
    expect(() =>{  core.steer('sf-1', 'x') }).toThrow('inject: selectJournalSegments')
    delete f.faults.selectJournalSegments
    expect(core.steer('sf-1', 'x')).toBe(1)
  })

  it('propagates a segment-insert failure out of steer() and records nothing', async () => {
    const f = await fixture()
    const { core } = await startParked(f, 'sf-2')
    f.faults.insertJournalSegment = new Error('inject: insertJournalSegment')
    expect(() =>{  core.steer('sf-2', 'x') }).toThrow('inject: insertJournalSegment')
    expect(f.store.selectJournalSegments('sf-2')).toEqual([])
    delete f.faults.insertJournalSegment
  })

  it('fails the run when the segment listing faults at awaitSteer entry', async () => {
    const f = await fixture()
    f.faults.selectJournalSegments = new Error('inject: selectJournalSegments')
    const { handle } = await startParked(f, 'sf-3')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message === 'inject: selectJournalSegments'
    })
    delete f.faults.selectJournalSegments
  })

  it('fails the parked wait when the poll tick finds the run row vanished', async () => {
    const f = await fixture()
    const { handle } = await startParked(f, 'sf-4')
    f.overrides.selectRun = () => undefined
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message.includes('ledger lost run sf-4')
    })
    delete f.overrides.selectRun
  })

  it('fails the parked wait when the poll tick finds the run failed elsewhere', async () => {
    const f = await fixture()
    const { handle } = await startParked(f, 'sf-5')
    f.store.finalizeRun('sf-5', {
      status: 'failed', outputJson: undefined, errorJson: JSON.stringify({ message: 'elsewhere' }),
      cancelCause: undefined, finishedAt: Date.now(),
    })
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message.includes('terminal state failed while parked for steer')
    })
  })

  it('cancels the parked wait when the poll tick finds the run cancelled elsewhere', async () => {
    const f = await fixture()
    const { handle } = await startParked(f, 'sf-6')
    f.store.finalizeRun('sf-6', {
      status: 'cancelled', outputJson: undefined, errorJson: undefined,
      cancelCause: undefined, finishedAt: Date.now(),
    })
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const run = error as { code?: string; detail?: unknown }
      return run.code === 'RUN_CANCELLED' && run.detail === undefined
    })
  })

  it('fails the parked wait when the poll-tick segment listing faults', async () => {
    const f = await fixture()
    const { handle } = await startParked(f, 'sf-7')
    f.faults.selectJournalSegments = new Error('inject: selectJournalSegments')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message === 'inject: selectJournalSegments'
    })
    delete f.faults.selectJournalSegments
  })

  it('rejects a second concurrent park on one run', async () => {
    const f = await fixture()
    const { handle } = await startParked(f, 'sf-8', async (run) => {
      await Promise.all([run.awaitSteer(0), run.awaitSteer(0)])
      return 'unreachable'
    })
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: unknown }).detail
      return detail instanceof Error && detail.message.includes('already parks for steer')
    })
  })

  it('does not wake a park whose known count the new segment does not exceed', async () => {
    const f = await fixture()
    const wakes: number[] = []
    const { core, handle } = await startParked(f, 'sf-9', async (run) => {
      await run.awaitSteer(0)
      wakes.push(1)
      // Skip ahead: park for a third segment while only one exists.
      await run.awaitSteer(2)
      wakes.push(2)
      return run.steers().length
    })
    expect(core.steer('sf-9', 'one')).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(wakes).toEqual([1])
    expect(core.steer('sf-9', 'two')).toBe(2)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(wakes).toEqual([1])
    expect(core.steer('sf-9', 'three')).toBe(3)
    await expect(handle.result).resolves.toBe(3)
  })

  it('fails an abandoned parked wait when the body settles without awaiting it', async () => {
    const f = await fixture()
    const { handle } = await startParked(f, 'sf-10', async (run) => {
      void run.awaitSteer(0)
      return 'done-anyway'
    })
    await expect(handle.result).resolves.toBe('done-anyway')
  })

  it('revives a run that died parked with an unconsumed segment through the boot scan', async () => {
    const f = await fixture()
    const first = f.makeCore()
    const deliveries: unknown[][] = []
    const makeDef = () => {
      const mine: unknown[] = []
      deliveries.push(mine)
      return steerableDef(async (run) => {
        let seen = 0
        for (;;) {
          const segments = run.steers()
          while (seen < segments.length) {
            mine.push(segments[seen])
            seen += 1
            if (seen === 2) return seen
          }
          await run.awaitSteer(seen)
        }
      })
    }
    const firstDef = makeDef()
    first.register(firstDef)
    const handle = first.run(firstDef, null, { runId: 'sf-11' })
    expect(first.steer('sf-11', 'one')).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 30))
    // Crash while parked for the second segment; the steer was recorded
    // before the crash, so the record is the re-drive's input.
    expect(first.steer('sf-11', 'two')).toBe(2)
    first.dispose()
    await expect(handle.result).rejects.toThrow('ENGINE_DISPOSED')

    const second = f.makeCore()
    second.register(makeDef())
    second.bootScan()
    await second.idle()
    expect(f.store.selectRun('sf-11')?.status).toBe('done')
    expect(deliveries[1]).toEqual(['one', 'two'])
  })

  it('records a steer on a gate-waiting run without waking the gate', async () => {
    const f = await fixture()
    const core = f.makeCore()
    const def = steerableDef(async (run) => {
      const resolution = await run.waitFor('approval')
      return { resolution, segments: run.steers() }
    })
    core.register(def)
    const handle = core.run(def, null, { runId: 'sf-12' })
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(core.steer('sf-12', 'while-waiting')).toBe(1)
    expect(f.store.selectRun('sf-12')?.status).toBe('waiting')
    expect(core.resolveGate('sf-12', 'approval', { state: 'resolved', value: 'yes' }, 'sdk')).toBe(true)
    await expect(handle.result).resolves.toEqual({
      resolution: { state: 'resolved', value: 'yes' },
      segments: ['while-waiting'],
    })
  })

  it('rejects steer after disposal', async () => {
    const f = await fixture()
    const core = f.makeCore()
    core.dispose()
    expect(() =>{  core.steer('sf-13', null) }).toThrow('ENGINE_DISPOSED')
  })
})
