/**
 * Run-handle machinery shared by the two bound faces (`bind` for workflows,
 * `bindAgent` for agents): idempotent start-or-attach against the engine,
 * deterministic child-run derivation inside an ambient engine step scope,
 * and the engine → SDK error mapping.
 * @module @daypaw/sdk/run-handle
 */

import type { ZodType, z } from 'zod'
import type DurableEngine from '@daypaw/engine'
import type { EngineDefinition, EngineRunOptions, Json } from '@daypaw/engine'
import { currentStepScope } from '@daypaw/engine'

/** zod schema → inferred TS type. */
type Infer<I extends ZodType> = z.output<I>

/** Options for starting (or attaching to) a run. */
export interface RunOptions {
  /** Persistent run identity; an existing id attaches instead of starting. */
  readonly runId?: string
  /** Caller cancellation; effective at the next step boundary, and agent runs also abort their in-flight turn. */
  readonly signal?: AbortSignal
  /** Caller-side metadata; in-process only, not persisted by the skeleton. */
  readonly meta?: Record<string, unknown>
}

/** Run status; `waiting` carries the gate the run suspended on. */
export type RunStatus =
  | { readonly state: 'running' }
  | { readonly state: 'waiting'; readonly gate: string }
  | { readonly state: 'done' }
  | { readonly state: 'failed'; readonly error: unknown }
  | { readonly state: 'cancelled'; readonly cause?: string }

/** Caller-side handle for one run. */
export interface RunHandle<T, I = unknown> {
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
  /**
   * Append a follow-up input to this run (issue #53): validated against the
   * definition's input contract, recorded as a journal segment, and consumed
   * by the run at its next segment boundary under the same runId. Fails loud
   * on terminal runs and on definitions that did not opt into steering.
   * @param input - follow-up input, validated against `def.input`.
   */
  steer(input: I): Promise<void>
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

/** Map an engine rejection to the SDK error face; unknown errors pass through. */
function mapEngineError(error: unknown): unknown {
  if (error instanceof Error && 'code' in error) {
    const engineError = error as unknown as { code: string; runId: string; detail?: unknown }
    if (engineError.code === 'RUN_FAILED') return new RunFailedError(engineError.runId, engineError.detail)
    if (engineError.code === 'RUN_CANCELLED') return new RunCancelledError(engineError.runId, engineError.detail)
  }
  return error
}

/** The definition facets one run start needs. */
interface RunnableDef<I extends ZodType, O extends ZodType> {
  readonly kind: EngineDefinition['kind']
  readonly name: string
  readonly version: string
  readonly input: I
  readonly output: O
}

/**
 * Resolve the engine run identity: an explicit `opts.runId` wins; otherwise,
 * inside an ambient engine step scope, derive the deterministic child runId
 * and record the parent linkage — this is what makes the bare `def.run()`
 * child idiom attach instead of restart on re-drive (spec 02 §2).
 * @param def - definition identity used in the derived child runId.
 * @param opts - caller run options.
 * @returns engine run identity options.
 */
function runIdentity(
  def: RunnableDef<ZodType, ZodType>,
  opts?: RunOptions,
): Pick<EngineRunOptions, 'runId' | 'parent'> {
  if (opts?.runId !== undefined) return { runId: opts.runId }
  const scope = currentStepScope()
  if (scope === undefined) return {}
  return {
    runId: scope.childRunId(def.kind, def.name),
    parent: { runId: scope.runId, stepKey: scope.stepKey },
  }
}

/**
 * Start (or attach to) one run of a registered definition and wrap the
 * engine handle in the typed SDK face.
 * @param engine - the bound `ctx.durable` service.
 * @param engineDef - registered opaque engine record.
 * @param def - definition carrying the IO contracts.
 * @param input - caller input, validated against `def.input` before starting.
 * @param opts - run identity, cancellation, and metadata.
 * @returns the typed run handle.
 */
export async function startRun<I extends ZodType, O extends ZodType>(
  engine: DurableEngine,
  engineDef: EngineDefinition,
  def: RunnableDef<I, O>,
  input: Infer<I>,
  opts?: RunOptions,
): Promise<RunHandle<Infer<O>, Infer<I>>> {
  const parsedInput = def.input.parse(input)
  const engineOpts: EngineRunOptions = {
    ...runIdentity(def, opts),
    ...(opts?.signal === undefined ? {} : { signal: opts.signal }),
  }
  const handle = await engine.run(engineDef, parsedInput, engineOpts)
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
    result,
    status: () => handle.status(),
    cancel: cause => handle.cancel(cause),
    // The Remote boundary constrains input to Json; the zod-validated output
    // is statically unknown (spec 02 §2 rejects a compile-time Json
    // constraint) and is JSON-serialized verbatim at segment insert.
    steer: async (followUp) => { await engine.steer(handle.id, def.input.parse(followUp) as Json) },
    meta: opts?.meta ?? {},
  }
}
