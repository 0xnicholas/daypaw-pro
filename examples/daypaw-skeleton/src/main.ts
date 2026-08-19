/**
 * Walking-skeleton host (ADR 0008 §1): a three-step workflow over the real
 * engine. Two modes:
 * - with --run-id: start-or-attach one run, print its typed result, exit;
 * - without: revival mode — boot-scan unfinished runs, drive them to
 *   completion (no caller needed), print a summary, exit.
 * The effects file records step side effects across kills, which is what the
 * SIGKILL suite asserts against.
 */
import { appendFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import DurableEngine from '@daypaw/engine'
import { bind, defineWorkflow } from '@daypaw/sdk'
import { z } from 'zod'

function argOf(name: string): string | undefined {
  const argv = process.argv.slice(2)
  const at = argv.indexOf(`--${name}`)
  return at >= 0 ? argv[at + 1] : undefined
}

const dbPath = argOf('db')
const effectsPath = argOf('effects')
const runId = argOf('run-id')
const stepDelayMs = Number(argOf('step-delay-ms') ?? 0)
if (dbPath === undefined || effectsPath === undefined) {
  console.error('usage: main.ts --db <ledger.db> --effects <file> [--run-id <id>] [--step-delay-ms <n>]')
  process.exit(2)
}

const record = async (name: string): Promise<void> => {
  await appendFile(effectsPath, `${name}\n`)
}

const delay = async (): Promise<void> => {
  if (stepDelayMs > 0) await new Promise(resolve => setTimeout(resolve, stepDelayMs))
}

const skeleton = defineWorkflow({
  name: 'skeleton-demo',
  version: '0.0.1',
  input: z.object({ seed: z.number() }),
  output: z.object({ total: z.number() }),
  body: async (ctx, input) => {
    const first = await ctx.step('first', async () => {
      await delay()
      await record('first')
      return input.seed + 1
    })
    const second = await ctx.step('second', async () => {
      await delay()
      await record('second')
      return first + 1
    })
    const third = await ctx.step('third', async () => {
      await delay()
      await record('third')
      return second + 1
    })
    return { total: third }
  },
})

const ctx = new Context()
await ctx.plugin(DurableEngine, { path: dbPath, pollMs: 50 })
try {
  const workflow = await bind(skeleton, ctx.durable)
  if (runId === undefined) {
    await ctx.durable.idle()
    console.log(JSON.stringify({ revived: true }))
  } else {
    const handle = await workflow.run({ seed: 1 }, { runId })
    console.log(JSON.stringify(await handle.result))
  }
} finally {
  await ctx.fiber.dispose()
}
