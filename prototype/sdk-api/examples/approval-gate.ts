// PROTOTYPE example — approval flow with a human gate. Ticket #10 react surface.
// Shows: waitFor union typing (terminal states as VALUES), step retry,
// PermanentStepError, gate timeout without exception noise.

import { defineWorkflow, PermanentStepError } from '@daypaw/sdk'
import { z } from 'zod'

const deployFlow = defineWorkflow({
  name: 'deploy-with-approval',
  version: '1.0.0',
  input: z.object({ release: z.string(), env: z.string() }),
  output: z.object({ deployed: z.boolean(), reason: z.optional(z.string()) }),
  body: async (ctx, input) => {
    const plan = await ctx.step('plan', async () => {
      const steps = [`migrate ${input.release}`, `deploy ${input.env}`]
      if (steps.length === 0) throw new PermanentStepError('empty plan — do not retry, fix upstream')
      return { steps }
    })

    // Zero-compute HITL wait: process may exit here; Manager resolves the gate.
    // Timeout/rejection come back as VALUES, never thrown (ADR 0002 §5).
    const gate = await ctx.waitFor('deploy-approval', {
      schema: z.object({ approved: z.boolean(), note: z.optional(z.string()) }),
      timeoutMs: 7 * 24 * 60 * 60_000,
    })

    if (gate.status !== 'resolved' || !gate.value.approved) {
      const reason = gate.status === 'rejected' ? gate.reason : gate.status === 'timedout' ? 'window expired' : 'denied'
      return { deployed: false, reason }
    }

    await ctx.step('deploy', () => applyPlan(plan), { retry: { maxAttempts: 5, minDelayMs: 1_000, factor: 2 } })
    // stub 注：真 zod 的 optional 会使键可选；stub 仅并类型，需显式 undefined
    return { deployed: true, reason: undefined }
  },
})

async function applyPlan(plan: { steps: string[] }) {
  return plan.steps.length
}

const handle = deployFlow.run({ release: 'v1.2.0', env: 'prod' })
console.log(await handle.result)
