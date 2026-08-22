/**
 * The `@daypaw/sdk` typed facade over the durable engine: `defineWorkflow`
 * declares a code-orchestrated run (zod input/output, step body), and
 * `bind(def, engine)` attaches it to a `ctx.durable` service, returning the
 * runnable face (`run()` idempotent start-or-attach + typed
 * {@link RunHandle}). v1 ships the workflow face; `defineAgent` lands with
 * pillar ②'s milestone (spec: docs/spec/02-agent-engine-sdk.md).
 * @module @daypaw/sdk
 */

import type { ZodType, z } from 'zod'
import type DurableEngine from '@daypaw/engine'
import type { EngineDefinition, EngineRunHandle, EngineStepCtx } from '@daypaw/engine'

// Consumers mount the engine through the SDK face so the vendored
// `@daypaw/engine` copy inside the published tarball stays an implementation
// detail; the class contract lives at its declaration in `@daypaw/engine`.
export { default as DurableEngine } from '@daypaw/engine'

/** zod schema → inferred TS type. */
type Infer<I extends ZodType> = z.output<I>

/** Execution context handed to a workflow body; grows with the ctx primitives. */
export type WorkflowCtx = EngineStepCtx

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

/** Options for starting (or attaching to) a run. */
export interface RunOptions {
  /** Persistent run identity; an existing id attaches instead of starting. */
  readonly runId?: string
  /** Caller cancellation; effective at the next step boundary. */
  readonly signal?: AbortSignal
  /** Caller-side metadata; in-process only, not persisted by the skeleton. */
  readonly meta?: Record<string, unknown>
}

/** Run status; `waiting` appears once `ctx.waitFor` lands. */
export type RunStatus =
  | { readonly state: 'running' }
  | { readonly state: 'waiting'; readonly gate: string }
  | { readonly state: 'done' }
  | { readonly state: 'failed'; readonly error: unknown }
  | { readonly state: 'cancelled'; readonly cause?: string }

/** Caller-side handle for one run. */
export interface RunHandle<T> {
  /** Persistent run identity. */
  readonly id: string
  /** Identity of the definition this run belongs to. */
  readonly definition: { readonly name: string; readonly version: string }
  /** Resolves with the output-validated typed result; rejects on failure or cancellation. */
  readonly result: Promise<T>
  /** @returns the current status, read from the ledger. */
  status(): RunStatus
  /**
   * Request cancellation (effective at the next step boundary).
   * @param cause - human-readable cancel cause.
   */
  cancel(cause?: string): Promise<void>
  /** Caller-side metadata passed via {@link RunOptions}. */
  readonly meta: Record<string, unknown>
}

/** A run ended in the `failed` state. */
export class RunFailedError extends Error {
  /** The failed run. */
  readonly runId: string
  /** Underlying failure. */
  override readonly cause?: unknown

  /**
   * @param runId - failed run identity.
   * @param cause - underlying failure.
   */
  constructor(runId: string, cause?: unknown) {
    super(`run ${runId} failed`, { cause })
    this.name = 'RunFailedError'
    this.runId = runId
    this.cause = cause
  }
}

/** A run ended in the `cancelled` state. */
export class RunCancelledError extends Error {
  /** The cancelled run. */
  readonly runId: string
  /** Cancel cause, when one was given. */
  override readonly cause?: unknown

  /**
   * @param runId - cancelled run identity.
   * @param cause - cancel cause.
   */
  constructor(runId: string, cause?: unknown) {
    super(`run ${runId} cancelled`, { cause })
    this.name = 'RunCancelledError'
    this.runId = runId
    this.cause = cause
  }
}

/** The bound, runnable face of one definition on one engine. */
export interface BoundWorkflow<I extends ZodType = ZodType, O extends ZodType = ZodType> {
  /**
   * Start a run (input validated against the definition's contract), or
   * attach to an existing runId.
   * @param input - workflow input, validated before starting.
   * @param opts - run identity, cancellation, and metadata.
   * @returns the typed run handle.
   */
  run(input: Infer<I>, opts?: RunOptions): Promise<RunHandle<Infer<O>>>
}

/** Map an engine rejection to the SDK error face; unknown errors pass through. */
function mapEngineError(error: unknown): unknown {
  if (error instanceof Error && 'code' in error) {
    const engineError = error as unknown as { code: string; runId: string; detail?: unknown }
    if (engineError.code === 'RUN_FAILED') return new RunFailedError(engineError.runId, engineError.detail)
    if (engineError.code === 'RUN_CANCELLED') return new RunCancelledError(engineError.runId, engineError.detail)
  }
  return error
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
      body: def.body as EngineDefinition['body'],
    }
    engineDefs.set(def, engineDef)
  }
  await engine.register(engineDef)
  return {
    run: async (input: Infer<I>, opts?: RunOptions) => {
      const parsedInput = def.input.parse(input)
      const engineOpts: { runId?: string; signal?: AbortSignal } = {}
      if (opts?.runId !== undefined) engineOpts.runId = opts.runId
      if (opts?.signal !== undefined) engineOpts.signal = opts.signal
      const handle: EngineRunHandle = await engine.run(engineDef, parsedInput, engineOpts)
      const result = handle.result.then(
        raw => def.output.parse(raw),
        (error: unknown) => { throw mapEngineError(error) },
      )
      // Handles whose result is never awaited (a caller taking only status)
      // must not crash the process on rejection; real consumers still get it.
      result.catch(() => {})
      return {
        id: handle.id,
        definition: { name: def.name, version: def.version },
        result: result,
        status: () => handle.status(),
        cancel: cause => handle.cancel(cause),
        meta: opts?.meta ?? {},
      }
    },
  }
}
