/**
 * Walking-skeleton demo public face: a factory for the three-step durable
 * workflow the runnable host (`main.ts`) drives. Exported so the package has
 * a buildable entry and tests can reference the definition by name; the host
 * script owns the process wiring (ledger path, effects file, start-or-attach)
 * and injects the step side-effect and delay hooks.
 */
import { defineWorkflow } from '@daypaw/sdk'
import { z } from 'zod'

/** One step's recorded side-effect name (the SIGKILL suite asserts against the effects file). */
export type SkeletonStepName = 'first' | 'second' | 'third'

/** Step hooks the host process supplies (side-effect recording + pacing). */
export interface SkeletonStepHooks {
  /** Record one completed step's side effect. */
  record(name: SkeletonStepName): Promise<void>
  /** Optional pacing delay between steps (the host's --step-delay-ms). */
  delay(): Promise<void>
}

/**
 * Build the walking-skeleton workflow: three chained durable steps, each
 * recording its side effect before returning. Survives SIGKILL between steps
 * (ADR 0008 §1 proof line).
 * @param hooks - side-effect recording and pacing supplied by the host.
 * @returns the workflow definition.
 */
export function createSkeletonWorkflow(hooks: SkeletonStepHooks): ReturnType<typeof defineWorkflow> {
  return defineWorkflow({
    name: 'skeleton-demo',
    version: '0.0.1',
    input: z.object({ seed: z.number() }),
    output: z.object({ total: z.number() }),
    body: async (ctx, input) => {
      const first = await ctx.step('first', async () => {
        await hooks.delay()
        await hooks.record('first')
        return input.seed + 1
      })
      const second = await ctx.step('second', async () => {
        await hooks.delay()
        await hooks.record('second')
        return first + 1
      })
      const third = await ctx.step('third', async () => {
        await hooks.delay()
        await hooks.record('third')
        return second + 1
      })
      return { total: third }
    },
  })
}
