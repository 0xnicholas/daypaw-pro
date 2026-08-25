/**
 * The `@daypaw/sdk` typed facade over the durable engine. `defineWorkflow`
 * declares a code-orchestrated run and `bind(def, engine)` attaches it to a
 * `ctx.durable` service; `defineAgent` declares a declarative LLM-loop spec
 * and `bindAgent(def, ctx)` compiles it into an opaque engine body over the
 * host's dsh agent stack (ADR 0010). Both faces return the runnable
 * `run()` — idempotent start-or-attach with a typed {@link RunHandle}
 * (spec: docs/spec/02-agent-engine-sdk.md).
 * @module @daypaw/sdk
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import type DurableEngine from '@daypaw/engine'
import type { EngineDefinition, EngineStepCtx, GateResolution, GateSchema } from '@daypaw/engine'
import type { AgentDefinition, BoundAgent } from './agent.ts'
import { boundAgentFor } from './agent.ts'
import type { RunHandle, RunOptions } from './run-handle.ts'
import { startRun } from './run-handle.ts'

// Consumers mount the engine through the SDK face so the vendored
// `@daypaw/engine` copy inside the published tarball stays an implementation
// detail; the class contract lives at its declaration in `@daypaw/engine`.
export { default as DurableEngine } from '@daypaw/engine'

export { defineAgent, bindAgent } from './agent.ts'
export type {
  AgentDefinition, BoundAgent, DefineAgentOptions, ModelRoute, PromptSegment,
} from './agent.ts'
export { RunCancelledError, RunFailedError } from './run-handle.ts'
export type { RunHandle, RunOptions, RunStatus } from './run-handle.ts'
export type { GateResolution } from '@daypaw/engine'

/** zod schema → inferred TS type. */
type Infer<I extends ZodType> = z.output<I>

/** Options for one `ctx.waitFor` call. */
export interface WaitForOptions<T> {
  /** Value contract: validated before the settlement records and again before the value reaches the body. */
  readonly schema?: ZodType<T>
  /** Timeout in milliseconds from the gate's first registration. */
  readonly timeout?: number
}

/** Adapt a zod contract to the engine's structural gate schema (projection via zod's own JSON Schema renderer). */
function adaptGateSchema<T>(schema: ZodType<T>): GateSchema<T> {
  return {
    parse: value => schema.parse(value),
    toJSONSchema: () => z.toJSONSchema(schema),
  }
}

/** Execution context handed to a workflow body; grows with the ctx primitives. */
export interface WorkflowCtx extends EngineStepCtx {
  /**
   * Awaited child agent run (ADR 0010 §4): sugar for one parent step
   * (`agent:<name>`) that starts the child on its deterministic derived
   * runId — recording the parent linkage — and awaits its typed result. The
   * parent step's dedup attaches to the child's terminal state on re-drive;
   * a half-dead child revives through the boot scan. The definition must be
   * bound with `bindAgent` first; an unbound definition throws.
   * @param def - bound agent definition.
   * @param input - child run input.
   * @returns the child's output-validated result.
   */
  agent<I extends ZodType, O extends ZodType>(def: AgentDefinition<I, O>, input: Infer<I>): Promise<Infer<O>>
  /**
   * Durable gate (HITL suspension, spec 01 §6): register a pending promise
   * keyed by `(runId, gate)`, move the run to `waiting`, and yield — waiting
   * costs nothing, and a dead process revives through the boot scan. The
   * terminal outcome returns as a {@link GateResolution} value; timeout,
   * rejection, and cancellation are programmable branches, never thrown.
   * @param gate - gate name; unique within the run.
   * @param opts - zod value contract and timeout.
   * @returns the terminal gate outcome.
   */
  waitFor<T = unknown>(gate: string, opts?: WaitForOptions<T>): Promise<GateResolution<T>>
}

/** Options declaring one workflow definition. */
export interface DefineWorkflowOptions<I extends ZodType, O extends ZodType> {
  /** Definition name; with version, the registry identity. */
  readonly name: string
  /** Definition version; with name, the registry identity. */
  readonly version: string
  /** Input contract; validated before the run starts. */
  readonly input: I
  /** Output contract; validated before the result resolves. */
  readonly output: O
  /** User async body; the engine executes it, deduping steps on recovery. */
  readonly body: (ctx: WorkflowCtx, input: Infer<I>) => Promise<Infer<O>>
}

/** A declared (not yet bound) workflow definition. */
export interface WorkflowDefinition<I extends ZodType = ZodType, O extends ZodType = ZodType> {
  /** Definition family discriminator. */
  readonly kind: 'workflow'
  /** Definition name. */
  readonly name: string
  /** Definition version. */
  readonly version: string
  /** Input contract. */
  readonly input: I
  /** Output contract. */
  readonly output: O
  /** User async body. */
  readonly body: (ctx: WorkflowCtx, input: Infer<I>) => Promise<Infer<O>>
}

/**
 * Declare a workflow definition.
 * @param options - identity, contracts, and body.
 * @returns the unbound definition; pass to {@link bind}.
 */
export function defineWorkflow<I extends ZodType, O extends ZodType>(
  options: DefineWorkflowOptions<I, O>,
): WorkflowDefinition<I, O> {
  return { kind: 'workflow', ...options }
}

/** The bound, runnable face of one definition on one engine. */
export interface BoundWorkflow<I extends ZodType = ZodType, O extends ZodType = ZodType> {
  /**
   * Start a run (input validated against the definition's contract), or
   * attach to an existing runId. Inside a step of another run the runId
   * derives deterministically from the ambient step scope (spec 02 §2).
   * @param input - workflow input, validated before starting.
   * @param opts - run identity, cancellation, and metadata.
   * @returns the typed run handle.
   */
  run(input: Infer<I>, opts?: RunOptions): Promise<RunHandle<Infer<O>, Infer<I>>>
}

/** Wrap the engine's step ctx with the SDK's `ctx.agent` primitive. */
function enrichStepCtx(ctx: EngineStepCtx): WorkflowCtx {
  return {
    runId: ctx.runId,
    signal: ctx.signal,
    step: (name, fn, opts) => ctx.step(name, fn, opts),
    steers: () => ctx.steers(),
    awaitSteer: known => ctx.awaitSteer(known),
    waitFor: (gate, opts) => ctx.waitFor(gate, {
      ...(opts?.schema === undefined ? {} : { schema: adaptGateSchema(opts.schema) }),
      ...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }),
    }),
    agent: async (def, input) => {
      const bound = boundAgentFor(def) as BoundAgent<typeof def.input, typeof def.output> | undefined
      if (bound === undefined) {
        throw new Error(`agent definition "${def.name}@${def.version}" is not bound; call bindAgent(def, ctx) before ctx.agent`)
      }
      return ctx.step(`agent:${def.name}`, async () => {
        const handle = await bound.run(input)
        return handle.result
      })
    },
  }
}

/** Engine-side definition record per definition object; reuse keeps re-binding idempotent. */
const engineDefs = new WeakMap<WorkflowDefinition, EngineDefinition>()

/**
 * Bind a definition to a durable engine: registers it for execution and
 * boot-time revival and returns the runnable face. Binding the same
 * definition object twice is a no-op.
 * @param def - definition from {@link defineWorkflow}.
 * @param engine - the `ctx.durable` service of the app's Cordis composition.
 * @returns the bound workflow.
 */
export async function bind<I extends ZodType, O extends ZodType>(
  def: WorkflowDefinition<I, O>,
  engine: DurableEngine,
): Promise<BoundWorkflow<I, O>> {
  let engineDef = engineDefs.get(def)
  if (engineDef === undefined) {
    engineDef = {
      kind: 'workflow',
      name: def.name,
      version: def.version,
      // The body boundary is `unknown`; run-start validated the stored input
      // against `def.input` before the engine serialized it.
      body: (ctx, input) => def.body(enrichStepCtx(ctx), input as Infer<I>),
    }
    engineDefs.set(def, engineDef)
  }
  await engine.register(engineDef)
  return {
    run: (input: Infer<I>, opts?: RunOptions) => startRun(engine, engineDef, def, input, opts),
  }
}
