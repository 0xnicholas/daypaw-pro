import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import DurableEngine from '@daypaw/engine'
import { bind, defineWorkflow } from '@daypaw/sdk'
import type { RunHandle, RunStatus } from '@daypaw/sdk'
import { z } from 'zod'

let root: string | undefined
let contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts = []
  if (root !== undefined) {
    // SQLite WAL sidecars can linger one tick past close; retry the cleanup.
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

const counterWorkflow = defineWorkflow({
  name: 'counter',
  version: '1',
  input: z.object({ seed: z.number() }),
  output: z.object({ total: z.number() }),
  body: async (ctx, input) => {
    const a = await ctx.step('bump-one', async () => input.seed + 1)
    const b = await ctx.step('bump-two', async () => a + 1)
    return { total: b }
  },
})

async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function bootEngine(path: string): Promise<DurableEngine> {
  const ctx = new Context()
  await ctx.plugin(DurableEngine, { path, pollMs: 10 })
  contexts.push(ctx)
  return ctx.durable
}

describe('defineWorkflow + bind', () => {
  it('runs a typed round trip: zod input in, zod output out', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-happy-'))
    const workflow = await bind(counterWorkflow, engine)
    const handle = await workflow.run({ seed: 40 })
    expectTypeOf(handle).toEqualTypeOf<RunHandle<{ total: number }>>()
    expectTypeOf(handle.result).toEqualTypeOf<Promise<{ total: number }>>()
    expectTypeOf(handle.status().state).toEqualTypeOf<RunStatus['state']>()
    await expect(handle.result).resolves.toEqual({ total: 42 })
    expect(handle.definition).toEqual({ name: 'counter', version: '1' })
    expect(handle.meta).toEqual({})
    expect(handle.status()).toEqual({ state: 'done' })
  })

  it('rejects input that violates the input contract before starting', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-input-'))
    const workflow = await bind(counterWorkflow, engine)
    await expect(workflow.run({ seed: 'not-a-number' } as unknown as { seed: number })).rejects.toThrow()
    // @ts-expect-error - deliberately wrong shape for the runtime check
    await expect(workflow.run(null)).rejects.toThrow()
  })

  it('rejects with RunFailedError when the run fails, cause attached', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-failed-'))
    const failing = defineWorkflow({
      name: 'failing',
      version: '1',
      input: z.object({ seed: z.number() }),
      output: z.object({ total: z.number() }),
      body: async (ctx) => {
        await ctx.step('explode', async () => { throw new Error('sdk-boom') })
        return { total: 0 }
      },
    })
    const workflow = await bind(failing, engine)
    const handle = await workflow.run({ seed: 1 }, { runId: 'sdk-fail-1' })
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof Error) || error.name !== 'RunFailedError') return false
      const failed = error as unknown as { runId: string; cause?: unknown }
      return failed.runId === 'sdk-fail-1' && (failed.cause as Error).message === 'sdk-boom'
    })
  })

  it('cancels through the SDK handle with RunCancelledError', async () => {
    const path = await tmpPath('daypaw-sdk-cancel-')
    const engine = await bootEngine(path)
    const gated = defineWorkflow({
      name: 'gated',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async (ctx) => {
        await ctx.step('hold', async () => new Promise(resolve => setTimeout(() =>{  resolve('late') }, 250)))
        return 'done'
      },
    })
    const workflow = await bind(gated, engine)
    const handle = await workflow.run({}, { runId: 'sdk-cancel-1', meta: { origin: 'test' } })
    expect(handle.meta).toEqual({ origin: 'test' })
    await handle.cancel('enough')
    await expect(handle.result).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof Error) || error.name !== 'RunCancelledError') return false
      return (error as { cause?: unknown }).cause === 'enough'
    })
    expect(handle.status()).toEqual({ state: 'cancelled', cause: 'enough' })
  })

  it('settles an attach on an existing runId with the same typed result', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-attach-'))
    const workflow = await bind(counterWorkflow, engine)
    const first = await workflow.run({ seed: 1 }, { runId: 'sdk-attach-1' })
    await expect(first.result).resolves.toEqual({ total: 3 })
    const second = await workflow.run({ seed: 999 }, { runId: 'sdk-attach-1' })
    await expect(second.result).resolves.toEqual({ total: 3 })
  })

  it('rebinding the same definition object is a no-op', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-rebind-'))
    await bind(counterWorkflow, engine)
    const again = await bind(counterWorkflow, engine)
    const handle = await again.run({ seed: 10 })
    await expect(handle.result).resolves.toEqual({ total: 12 })
  })

  it('rejects output that violates the output contract', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-output-'))
    const lying = defineWorkflow({
      name: 'lying',
      version: '1',
      input: z.object({}),
      output: z.object({ total: z.number() }),
      body: async () => 'not-the-declared-shape' as unknown as { total: number },
    })
    const workflow = await bind(lying, engine)
    const handle = await workflow.run({})
    await expect(handle.result).rejects.toThrow()
  })

  it('revives through a fresh engine after the first is disposed (bind is revival-ready)', async () => {
    const path = await tmpPath('daypaw-sdk-revive-')
    const first = await bootEngine(path)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const gated = defineWorkflow({
      name: 'revive-me',
      version: '1',
      input: z.object({ seed: z.number() }),
      output: z.object({ total: z.number() }),
      body: async (ctx, input) => {
        const a = await ctx.step('quick', async () => input.seed + 1)
        const b = await ctx.step('slow', async () => { await gate; return a + 1 })
        return { total: b }
      },
    })
    const workflowOne = await bind(gated, first)
    const handle = await workflowOne.run({ seed: 5 }, { runId: 'sdk-revive-1' })
    await new Promise(resolve => setImmediate(resolve))
    const disposedCtx = contexts.shift()
    if (disposedCtx === undefined) throw new Error('no engine context to dispose')
    await disposedCtx.fiber.dispose()
    release()

    const second = await bootEngine(path)
    const workflowTwo = await bind(gated, second)
    await second.idle()
    const settled = await workflowTwo.run({ seed: 5 }, { runId: 'sdk-revive-1' })
    await expect(settled.result).resolves.toEqual({ total: 7 })
    await expect(handle.result).rejects.toThrow('ENGINE_DISPOSED')
  })

  it('honors a mid-run caller signal cancellation', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-signal-'))
    const effects: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const gated = defineWorkflow({
      name: 'signaled',
      version: '1',
      input: z.object({}),
      output: z.number(),
      body: async (ctx) => {
        await ctx.step('one', async () => { effects.push('one'); return 1 })
        await ctx.step('two', async () => { await gate; effects.push('two'); return 2 })
        await ctx.step('three', async () => { effects.push('three'); return 3 })
        return 0
      },
    })
    const workflow = await bind(gated, engine)
    const controller = new AbortController()
    const handle = await workflow.run({}, { runId: 'sdk-signal-1', signal: controller.signal })
    await until(() => effects.includes('one'))
    controller.abort('sdk-stop')
    release()
    await expect(handle.result).rejects.toSatisfy((error: unknown) =>
      error instanceof Error && error.name === 'RunCancelledError')
    expect(effects).toEqual(['one', 'two'])
  })

  it('passes non-engine rejections through unchanged', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-passthrough-'))
    const plain = new Error('plain-rejection')
    const fakeEngine = {
      register: async () => {},
      run: async () => ({
        id: 'fake-1',
        result: Promise.reject(plain),
        status: () => ({ state: 'running' as const }),
        cancel: async () => {},
      }),
      idle: async () => {},
    }
    const workflow = await bind(counterWorkflow, fakeEngine as unknown as typeof engine)
    const handle = await workflow.run({ seed: 1 })
    await expect(handle.result).rejects.toBe(plain)
  })

  it('maps a settled failed attach to RunFailedError', async () => {
    const path = await tmpPath('daypaw-sdk-failedattach-')
    const engine = await bootEngine(path)
    const failing = defineWorkflow({
      name: 'attach-fail',
      version: '1',
      input: z.object({}),
      output: z.number(),
      body: async (ctx) => {
        await ctx.step('boom', async () => { throw new Error('attach-boom') })
        return 0
      },
    })
    const workflow = await bind(failing, engine)
    const first = await workflow.run({}, { runId: 'sdk-attach-fail-1' })
    await expect(first.result).rejects.toThrow()
    const second = await workflow.run({}, { runId: 'sdk-attach-fail-1' })
    await expect(second.result).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof Error) || error.name !== 'RunFailedError') return false
      return (error as { cause?: { message?: string } }).cause?.message === 'attach-boom'
    })
  })
})

describe('ctx.waitFor through the SDK face', () => {
  const approvalWorkflow = defineWorkflow({
    name: 'approval-flow',
    version: '1',
    input: z.object({ amount: z.number() }),
    output: z.object({ approved: z.boolean(), note: z.string() }),
    body: async (ctx, input) => {
      const resolution = await ctx.waitFor('approval', {
        schema: z.object({ approved: z.boolean() }),
        timeout: 60_000,
      })
      if (resolution.state !== 'resolved') return { approved: false, note: resolution.state }
      return { approved: resolution.value.approved, note: `amount:${input.amount}` }
    },
  })

  it('suspends with a typed waiting status and resumes with a validated value', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-gate-'))
    const workflow = await bind(approvalWorkflow, engine)
    const handle = await workflow.run({ amount: 12 }, { runId: 'sdk-gate-1' })
    await until(() => handle.status().state === 'waiting')
    expect(handle.status()).toEqual({ state: 'waiting', gate: 'approval' })
    const won = await engine.resolveGate('sdk-gate-1', 'approval', { state: 'resolved', value: { approved: true } }, 'sdk')
    expect(won).toBe(true)
    await expect(handle.result).resolves.toEqual({ approved: true, note: 'amount:12' })
  })

  it('types the gate outcome as a GateResolution union', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-gate-types-'))
    const workflow = await bind(approvalWorkflow, engine)
    const handle = await workflow.run({ amount: 1 }, { runId: 'sdk-gate-2' })
    await until(() => handle.status().state === 'waiting')
    await engine.resolveGate('sdk-gate-2', 'approval', { state: 'rejected', reason: 'nope' }, 'manager')
    await expect(handle.result).resolves.toEqual({ approved: false, note: 'rejected' })
  })

  it('rejects an invalid settlement before it records', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-gate-invalid-'))
    const workflow = await bind(approvalWorkflow, engine)
    const handle = await workflow.run({ amount: 1 }, { runId: 'sdk-gate-3' })
    await until(() => handle.status().state === 'waiting')
    await expect(engine.resolveGate('sdk-gate-3', 'approval', { state: 'resolved', value: { approved: 'yes' } }, 'sdk'))
      .rejects.toThrow()
    expect(handle.status()).toEqual({ state: 'waiting', gate: 'approval' })
    await engine.resolveGate('sdk-gate-3', 'approval', { state: 'resolved', value: { approved: false } }, 'sdk')
    await expect(handle.result).resolves.toEqual({ approved: false, note: 'amount:1' })
  })

  it('times out a gate as a programmable branch', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-gate-timeout-'))
    const impatient = defineWorkflow({
      name: 'impatient-flow',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async (ctx) => {
        const resolution = await ctx.waitFor('approval', { timeout: 30 })
        return resolution.state
      },
    })
    const workflow = await bind(impatient, engine)
    const handle = await workflow.run({})
    await expect(handle.result).resolves.toBe('timedout')
  })

  it('waits without options and resolves an unvalidated value', async () => {
    const engine = await bootEngine(await tmpPath('daypaw-sdk-gate-bare-'))
    const bare = defineWorkflow({
      name: 'bare-flow',
      version: '1',
      input: z.object({}),
      output: z.string(),
      body: async (ctx) => {
        const resolution = await ctx.waitFor('ping')
        return resolution.state === 'resolved' ? String(resolution.value) : resolution.state
      },
    })
    const workflow = await bind(bare, engine)
    const handle = await workflow.run({}, { runId: 'sdk-gate-4' })
    await until(() => handle.status().state === 'waiting')
    await engine.resolveGate('sdk-gate-4', 'ping', { state: 'resolved', value: 'pong' }, 'sdk')
    await expect(handle.result).resolves.toBe('pong')
  })
})
