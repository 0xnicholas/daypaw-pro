// PROTOTYPE — throwaway draft of the `@daypaw/sdk` type surface.
// Branch: prototype/sdk-api-surface. NOT production code; reacts via ticket #10.
//
// Grounding: ADR 0002 (durable semantics), ADR 0003 (programming model),
// dsh real types (@deepseek-ai/dsh-tools ToolDefinition / defineTool,
// @deepseek-ai/dsh-system-prompt PromptSection — shapes verified against
// upstream source, stubbed locally for this prototype).
// NOTE: this file is deliberately import-free so `declare module` stays ambient.

type ToolDefinition = import('@deepseek-ai/dsh-tools').ToolDefinition
type ZodType = import('zod').ZodType<any>

/** zod schema → inferred TS type (stub-level stand-in for z.infer). */
type Infer<I extends ZodType> = I['_output']

declare module '@daypaw/sdk' {
  // ---------------------------------------------------------------------
  // Definitions (ADR 0003 §1: two definition verbs, one run concept)
  // ---------------------------------------------------------------------

  /** Prompt segment — deliberately the same shape as dsh PromptSection, so
   *  preset-file compositions and code compositions share semantics. */
  export interface PromptSegment {
    readonly name: string
    readonly order: number
    readonly text: string
  }

  /** Model routing line. Shape sketch only — provider registry is engine-side. */
  export interface ModelRoute {
    readonly provider: string
    readonly model: string
    readonly maxTokens?: number
  }

  /** Static composition lines for an agent definition. */
  export interface AgentComposition {
    readonly prompt: readonly PromptSegment[]
    /** Tool surface: dsh ToolDefinition accepted as-is, zero adapter. */
    readonly tools: readonly ToolDefinition[]
    readonly model: ModelRoute
  }

  export interface DefineAgentOptions<I extends ZodType<any>, O extends ZodType<any>> {
    readonly name: string
    readonly version: string
    readonly input: I
    readonly output: O
    /** Composition lines: static in v1 (dynamic compose(input) left as an open edge). */
    readonly prompt: readonly PromptSegment[]
    readonly tools: readonly ToolDefinition[]
    readonly model: ModelRoute
  }

  export interface AgentDefinition<I extends ZodType<any> = ZodType<any>, O extends ZodType<any> = ZodType<any>> {
    readonly kind: 'agent'
    readonly name: string
    readonly version: string
    /** Idempotent start-or-attach (ADR 0003 §4). */
    run(input: Infer<I>, opts?: RunOptions): RunHandle<Infer<O>>
  }

  export function defineAgent<I extends ZodType<any>, O extends ZodType<any>>(
    options: DefineAgentOptions<I, O>,
  ): AgentDefinition<I, O>

  export interface DefineWorkflowOptions<I extends ZodType<any>, O extends ZodType<any>> {
    readonly name: string
    readonly version: string
    readonly input: I
    readonly output: O
    /** User async body; engine executes, dedups steps on recovery (ADR 0002 §4). */
    body(ctx: WorkflowCtx, input: Infer<I>): Promise<Infer<O>>
  }

  export interface WorkflowDefinition<I extends ZodType<any> = ZodType<any>, O extends ZodType<any> = ZodType<any>> {
    readonly kind: 'workflow'
    readonly name: string
    readonly version: string
    run(input: Infer<I>, opts?: RunOptions): RunHandle<Infer<O>>
  }

  export function defineWorkflow<I extends ZodType<any>, O extends ZodType<any>>(
    options: DefineWorkflowOptions<I, O>,
  ): WorkflowDefinition<I, O>

  export type AnyDefinition<I extends ZodType<any> = ZodType<any>, O extends ZodType<any> = ZodType<any>> =
    | AgentDefinition<I, O>
    | WorkflowDefinition<I, O>

  // ---------------------------------------------------------------------
  // Run handle (ADR 0003 §4)
  // ---------------------------------------------------------------------

  export interface RunOptions {
    /** Explicit persistent identity; same runId = attach to existing run. */
    readonly runId?: string
    readonly signal?: AbortSignal
    readonly meta?: Record<string, unknown>
  }

  /** Discriminated union — sharper than the ADR's `'waiting:<gate>'` string sketch. */
  export type RunStatus =
    | { readonly state: 'running' }
    | { readonly state: 'waiting'; readonly gate: string }
    | { readonly state: 'succeeded' }
    | { readonly state: 'failed'; readonly error: unknown }
    | { readonly state: 'cancelled'; readonly cause?: string }

  export interface RunHandle<T> {
    readonly id: string
    readonly definition: { readonly name: string; readonly version: string }
    /** Rejects with RunFailedError / RunCancelledError; resolves with the
     *  output-schema-validated typed result on success. */
    readonly result: Promise<T>
    status(): RunStatus
    cancel(cause?: string): Promise<void>
    readonly meta: Record<string, unknown>
  }

  // ---------------------------------------------------------------------
  // ctx primitives (ADR 0003 §2: exactly five)
  // ---------------------------------------------------------------------

  export interface WorkflowCtx {
    /** Idempotent execution unit. On recovery a completed step returns its
     *  recorded result without re-executing. `T` must be JSON-serializable —
     *  checked at ledger write (compile-time constraint left as open edge). */
    step<T>(name: string, fn: () => Promise<T>, opts?: StepOptions): Promise<T>
    /** Durable timer; survives process exit, fires on boot scan. */
    sleep(durationMs: number): Promise<void>
    /** HITL gate (durable promise, ADR 0002 §5). Timeout/rejection are
     *  TERMINAL STATES — returned as tagged union values, never thrown. */
    waitFor<S extends ZodType<any>>(gate: string, opts: WaitForOptions<S>): Promise<GateResolution<Infer<S>>>
    /** Awaited agent run (attaches a session, applies composition). */
    agent<I extends ZodType<any>, O extends ZodType<any>>(
      def: AgentDefinition<I, O>,
      input: Infer<I>,
    ): Promise<Infer<O>>
    /** Fire-and-forget child run; ledger records parent-child edge. */
    spawn<I extends ZodType<any>, O extends ZodType<any>>(
      def: AnyDefinition<I, O>,
      input: Infer<I>,
    ): RunHandle<Infer<O>>
  }

  export interface StepOptions {
    /** Retry as data (ADR 0002 §7): classification is policy, not code shape. */
    readonly retry?: RetryPolicy
    /** Explicit idempotency-key disambiguator for steps in loops / parallel
     *  branches. Default: engine derives `runId + name + occurrence`. */
    readonly key?: string
  }

  export interface RetryPolicy {
    readonly maxAttempts?: number
    readonly minDelayMs?: number
    readonly maxDelayMs?: number
    readonly factor?: number
  }

  export interface WaitForOptions<S extends ZodType<any>> {
    /** Payload schema — Manager UI renders the form from it. */
    readonly schema: S
    /** Omit for an unbounded (zero-compute) wait. */
    readonly timeoutMs?: number
  }

  /** Gate outcome as values — terminal states, not exceptions (ADR 0002 §5). */
  export type GateResolution<T> =
    | { readonly status: 'resolved'; readonly value: T }
    | { readonly status: 'rejected'; readonly reason?: string }
    | { readonly status: 'timedout' }

  // ---------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------

  export class DaypawError extends Error {
    readonly code: string
  }

  /** Throw inside a step body to stop retrying — the failure is final. */
  export class PermanentStepError extends DaypawError {
    readonly code: 'PERMANENT_STEP_FAILURE'
  }

  /** Retry budget exhausted; `result` of a failed run rejects with this. */
  export class StepFailedError extends DaypawError {
    readonly code: 'STEP_FAILED'
    readonly step: string
    readonly attempts: number
    readonly lastError: unknown
  }

  export class RunFailedError extends DaypawError {
    readonly code: 'RUN_FAILED'
    readonly runId: string
    readonly cause: unknown
  }

  export class RunCancelledError extends DaypawError {
    readonly code: 'RUN_CANCELLED'
    readonly cause?: string
  }

  // ---------------------------------------------------------------------
  // Engine surface (ctx.durable plugin — attach / gate resolve; sketch)
  // ---------------------------------------------------------------------

  /** Minimal sketch of the plugin face an app composes; full engine surface
   *  belongs to spec ch.1 (pillar ①). */
  export interface DurableEngine {
    /** Cross-process reconnection: type parameter is caller-asserted (erased). */
    attach<T = unknown>(runId: string): RunHandle<T> | undefined
    resolveGate<T>(runId: string, gate: string, value: T): Promise<void>
    rejectGate(runId: string, gate: string, reason?: string): Promise<void>
  }
}
