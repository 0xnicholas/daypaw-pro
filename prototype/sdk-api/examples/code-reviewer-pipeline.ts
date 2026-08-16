// PROTOTYPE example — code-reviewer pipeline. Ticket #10 react surface.
// Shows: step dataflow typing, Promise.all as plain control flow, ctx.agent
// typing, tool reuse from dsh, RunHandle + start-or-attach.

import { defineAgent, defineWorkflow } from '@daypaw/sdk'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'

// --- dsh tool, reused as-is (zero adapter) ---------------------------------

const readFile = defineTool({
  name: 'read_file',
  description: 'Read a file from the repo under review.',
  parameters: { path: { type: 'string' } },
  async execute(args) {
    return { content: `<contents of ${args.path}>` }
  },
})

// --- reviewer agent: declarative spec ---------------------------------------

const Finding = z.object({
  severity: z.union([z.literal('blocker'), z.literal('major'), z.literal('minor')]),
  title: z.string(),
  detail: z.string(),
})

const reviewer = defineAgent({
  name: 'code-reviewer',
  version: '1.0.0',
  input: z.object({ diff: z.string(), path: z.string() }),
  output: z.object({ verdict: z.union([z.literal('approve'), z.literal('request-changes')]), findings: z.array(Finding) }),
  prompt: [
    { name: 'persona', order: 0, text: 'You are a meticulous security reviewer.' },
    { name: 'policy', order: 100, text: 'Flag injection, unsafe eval, secret leakage. Cite line numbers.' },
  ],
  tools: [readFile],
  model: { provider: 'deepseek', model: 'deepseek-chat' },
})

// --- pipeline workflow: code orchestration ----------------------------------

const partition = (diff: string) => [{ path: 'src/a.ts', diff }, { path: 'src/b.ts', diff }]

const reviewPipeline = defineWorkflow({
  name: 'review-pipeline',
  version: '1.0.0',
  input: z.object({ pr: z.number() }),
  output: z.object({ verdict: z.string(), total: z.number() }),
  body: async (ctx, input) => {
    // step<T>: T is the recorded ledger result type; on recovery this returns
    // the recorded value without re-executing the fetch.
    const diff = await ctx.step('fetch-diff', () => Promise.resolve(`diff for PR ${input.pr}`))

    // Plain TypeScript is control flow (ADR 0003 §2) — Promise.all over scopes.
    // NOTE (sharp edge #2): two ctx.agent calls with the same name land in one
    // parallel scope; engine derives distinct idempotency keys per occurrence.
    const scopes = partition(diff)
    const reviews = await Promise.all(scopes.map((s) => ctx.agent(reviewer, { diff: s.diff, path: s.path })))

    const total = await ctx.step(
      'aggregate',
      () => Promise.resolve(reviews.reduce((n, r) => n + r.findings.length, 0)),
      { retry: { maxAttempts: 3, minDelayMs: 500, factor: 2 } },
    )

    const verdict = reviews.some((r) => r.verdict === 'request-changes') ? 'request-changes' : 'approve'
    return { verdict, total }
  },
})

// --- run: idempotent start-or-attach ----------------------------------------

const handle = reviewPipeline.run({ pr: 42 }, { runId: 'review-42' })
const status = handle.status()
if (status.state === 'waiting') console.log('blocked on gate:', status.gate)
const result = await handle.result // typed: { verdict: string; total: number }
console.log(result)
