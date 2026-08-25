/**
 * The durable engine core: definition registry, run lifecycle, step dedup
 * re-drive, durable gates, single-writer claims, boot scan, and
 * cancellation — everything
 * except Cordis wiring and database ownership. The Cordis service in
 * `index.ts` is a thin adapter over this core, and the fault-injection
 * suite drives the core through wrapped {@link JournalStore} seams
 * (spec 01 §5, §9).
 * @module @daypaw/engine/core
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { JournalRow, PromiseResolutionSource, PromiseRow, RunDefKind, RunRow } from '@daypaw/store'
import type { JournalStore, RunListFilter } from './seams.ts'
import type { DefinitionDisplay, DefinitionView } from './types.ts'

export type { DefinitionDisplay, DefinitionView } from './types.ts'

/** Run status reported by handles. */
export type EngineRunStatus =
  | { readonly state: 'running' }
  | { readonly state: 'waiting'; readonly gate: string }
  | { readonly state: 'done' }
  | { readonly state: 'failed'; readonly error: unknown }
  | { readonly state: 'cancelled'; readonly cause?: string }

/** Why an engine-run result promise rejected. */
export type EngineRunErrorCode = 'RUN_FAILED' | 'RUN_CANCELLED' | 'ENGINE_DISPOSED'

/** Rejection carrier for engine-run result promises. */
export class EngineRunError extends Error {
  /** Machine-readable rejection kind. */
  readonly code: EngineRunErrorCode
  /** The run the rejection belongs to. */
  readonly runId: string
  /** Underlying failure (RUN_FAILED) or cancel cause. */
  readonly detail: unknown

  /**
   * @param code - rejection kind.
   * @param runId - run identity.
   * @param detail - underlying cause, if any.
   */
  constructor(code: EngineRunErrorCode, runId: string, detail?: unknown) {
    super(`${code} on run ${runId}`)
    this.name = 'EngineRunError'
    this.code = code
    this.runId = runId
    this.detail = detail
  }
}

/** Options for one idempotent step call. */
export interface EngineStepOptions {
  /** Explicit idempotency-key disambiguator; default derives `name#occurrence`. */
  readonly key?: string
}

/**
 * Terminal outcome of one durable gate, returned to the body as a value:
 * timeout, rejection, and cancellation are programmable branches, never
 * thrown (spec 01 §6).
 */
export type GateResolution<T = unknown> =
  | { readonly state: 'resolved'; readonly value: T }
  | { readonly state: 'rejected'; readonly reason: string }
  | { readonly state: 'timedout' }
  | { readonly state: 'cancelled' }

/**
 * Value contract of one gate. `parse` is the authoritative validation,
 * applied before a same-process settlement is recorded and again before the
 * recorded value reaches the body; `toJSONSchema` renders the projection
 * persisted for Manager/UI form rendering (never a validation basis).
 */
export interface GateSchema<T> {
  /** @param value - decoded settlement payload. @returns the validated value. */
  parse(value: unknown): T
  /** @returns the JSON Schema rendering projection. */
  toJSONSchema(): Record<string, unknown>
}

/** Options for one `ctx.waitFor` call. */
export interface WaitForOptions<T> {
  /** Value contract; an omitted schema accepts any JSON value. */
  readonly schema?: GateSchema<T>
  /**
   * Timeout in milliseconds from the gate's first registration; a re-driven
   * wait keeps the originally recorded deadline.
   */
  readonly timeout?: number
}

/** Settlement input for {@link DurableEngineCore.resolveGate}. */
export type GateSettlement =
  | { readonly state: 'resolved'; readonly value: unknown }
  | { readonly state: 'rejected'; readonly reason: string }

/** Who settled a gate; recorded on the promise row. */
export type GateResolutionSource = PromiseResolutionSource

/** The execution context handed to a workflow body. */
export interface EngineStepCtx {
  /** Identity of the run this body drives; agent-kind bodies derive their session id from it. */
  readonly runId: string
  /**
   * Driver cancellation: aborted when the run is cancelled or the engine is
   * disposed. Bodies that await external quiescence (an agent loop) must race
   * it — `step()` alone observes cancellation only at step boundaries.
   */
  readonly signal: AbortSignal
  /**
   * Idempotent execution unit. A completed step returns its recorded result
   * without re-executing; an unfinished one (re)executes and records.
   * @param name - step name; part of the derived idempotency key.
   * @param fn - effectful computation; must return a JSON-serializable value.
   * @param opts - idempotency-key override.
   * @returns the step result (recorded value on re-drive).
   */
  step<T>(name: string, fn: () => Promise<T>, opts?: EngineStepOptions): Promise<T>
  /**
   * Durable gate (HITL suspension): registers a pending promise keyed by
   * `(runId, gate)`, moves the run to `waiting`, and yields the driver —
   * waiting costs nothing, and a dead process revives through the boot scan.
   * A gate already settled in the ledger returns its recorded outcome
   * without waiting again. Throws `RUN_CANCELLED` only when the run was
   * already cancelled at entry, mirroring `step`.
   * @param gate - gate name; unique within the run.
   * @param opts - value contract and timeout.
   * @returns the terminal gate outcome as a value.
   */
  waitFor<T = unknown>(gate: string, opts?: WaitForOptions<T>): Promise<GateResolution<T>>
  /**
   * Read every recorded steer segment input in record order (issue #53).
   * Segment 0 is the run input on the `runs` row and is not listed; segment
   * `i` of this list is journal row `steer:<i + 1>`. A plain read — a
   * re-driven body re-reads all segments, so consumption dedup across drives
   * is the body's business (the SDK agent body dedups via the session log).
   * @returns the recorded segment inputs, oldest first.
   */
  steers(): readonly unknown[]
  /**
   * Park until a segment beyond `known` is recorded, the driver aborts
   * (cancellation / disposal), or the run row leaves an unfinished state
   * under another writer. Returns immediately when `steers()` already holds
   * more than `known` entries, so the check-then-wait pair cannot race.
   * @param known - count of segments the body already consumed.
   */
  awaitSteer(known: number): Promise<void>
}

/**
 * The ambient scope of the step whose `fn` is currently executing. Child
 * runs started inside the step derive their persistent identity from it, so
 * a re-driven step re-derives the same child runIds and attaches instead of
 * restarting (spec 02 §2).
 */
export interface EngineStepScope {
  /** Run driving the step. */
  readonly runId: string
  /** Idempotency key of the step. */
  readonly stepKey: string
  /**
   * Derive the persistent identity of one child run started inside this
   * step. A per-scope occurrence counter makes successive calls distinct;
   * replaying the step in the same call order re-derives the same ids.
   * @param kind - child definition family.
   * @param name - child definition name; readability only, not uniqueness.
   * @returns the deterministic child runId.
   */
  childRunId(kind: RunDefKind, name: string): string
}

/** Publishes the executing step's scope to anything its `fn` awaits into. */
const stepScopeStorage = new AsyncLocalStorage<EngineStepScope>()

/**
 * Return the ambient step scope while a step's `fn` executes.
 * @returns the scope, or `undefined` outside any step (top-level `run()` callers derive nothing).
 */
export function currentStepScope(): EngineStepScope | undefined {
  return stepScopeStorage.getStore()
}

/** Opaque definition record the engine can execute and revive (ADR 0006 §2). */
export interface EngineDefinition {
  /** Definition family; the engine stays blind to what a kind's body does (ADR 0010: agent bodies are SDK-compiled closures). */
  readonly kind: RunDefKind
  /** Definition name; with version, the registry identity. */
  readonly name: string
  /** Definition version; with name, the registry identity. */
  readonly version: string
  /**
   * Display metadata for host catalog views (spec 05 §5): a business-facing
   * name and description. Metadata only — never execution semantics.
   */
  readonly display?: DefinitionDisplay
  /**
   * Steer channel opt-in (issue #53): `steer()` accepts follow-up input for
   * runs of this definition, whose body is expected to consume recorded
   * segments through `EngineStepCtx.steers`/`awaitSteer`. Undefined or false
   * means steering a run of this definition fails loud.
   */
  readonly steerable?: boolean
  /** Opaque body thunk; the engine calls it with a step ctx and the run input. */
  readonly body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>
}

/** Parent/child lineage of one run (spec 05 §5). Wire-safe: absent members are `null`, never `undefined` (JSON drops undefined). */
export interface RunLineage {
  /** The run's own row; `null` when the runId is unknown. */
  readonly run: RunRow | null
  /** The parent run row; `null` for a top-level run or an absent parent row. */
  readonly parent: RunRow | null
  /** Direct children, oldest first. */
  readonly children: readonly RunRow[]
}

/** Options for starting (or attaching to) a run. */
export interface EngineRunOptions {
  /** Persistent run identity; an existing id attaches instead of starting. */
  readonly runId?: string
  /**
   * Parent linkage of a child run, recorded on the inserted row
   * (`parent_run_id` / `parent_step_key`). Ignored when the runId already
   * exists — attach never rewrites lineage.
   */
  readonly parent?: { readonly runId: string; readonly stepKey: string }
  /** Caller cancellation; forwards into the driver's abort signal. */
  readonly signal?: AbortSignal
}

/** Caller-side handle for one run. */
export interface EngineRunHandle {
  /** Persistent run identity. */
  readonly id: string
  /** Resolves with the run output; rejects with {@link EngineRunError}. */
  readonly result: Promise<unknown>
  /** @returns the current status, read from the ledger. */
  status(): EngineRunStatus
  /**
   * Request cancellation: writes the terminal row, then aborts the driver.
   * Effective at the next step boundary (spec 01 §5).
   * @param cause - human-readable cancel cause.
   */
  cancel(cause?: string): Promise<void>
}

/** Constructor options for {@link DurableEngineCore}. */
export interface DurableEngineCoreOptions {
  /** Claim identity; one per process service instance. */
  readonly instanceId: string
  /** Attach-poll interval for runs driven elsewhere (ms). */
  readonly pollMs: number
  /** Warning sink for boot-scan and finalize-degradation notices. */
  readonly logger: { warn(message: string): void }
}

/** One in-process driver. */
interface DriverEntry {
  readonly handle: EngineRunHandle
  onSettled: Promise<void>
  abort(cause?: unknown): void
}

/** One cross-process attach poll. */
interface PollEntry {
  readonly handle: EngineRunHandle
  stop(error: EngineRunError): void
}

/** One in-process gate waiter, keyed by `runId` + gate name. */
interface GateWaiterEntry {
  /** Live value contract held while this process waits; enables write-side validation of same-process settlements. */
  readonly schema: GateSchema<unknown> | undefined
  /** Deliver a terminal outcome to the waiting body. */
  deliver(resolution: GateResolution): void
  /** Reject the body's wait (engine disposal, ledger loss). */
  fail(error: unknown): void
}

/** One in-process parked steer wait, keyed by `runId`. */
interface SteerWaiterEntry {
  /** Segments the body already consumed; wake only when the recorded count exceeds it. */
  readonly known: number
  /** Wake the parked body. */
  deliver(): void
  /** Reject the body's wait (cancellation, engine disposal, ledger loss). */
  fail(error: unknown): void
}

function gateWaiterKey(runId: string, gate: string): string {
  return `${runId}\u0000${gate}`
}

function definitionKey(kind: RunDefKind, name: string, version: string): string {
  return `${kind}\u0000${name}\u0000${version}`
}

function isTerminal(status: RunRow['status']): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

/** JSON-encoded failure description for `error_json` columns. */
function errorJsonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return JSON.stringify({ message })
}

/**
 * The durable engine core. Owns the definition registry, the in-process
 * driver table, and every ledger state transition; owns no database handle
 * (the caller supplies a {@link JournalStore}) and no Cordis context.
 */
export class DurableEngineCore {
  private readonly definitions = new Map<string, EngineDefinition>()
  private readonly drivers = new Map<string, DriverEntry>()
  private readonly polls = new Map<string, PollEntry>()
  private readonly gateWaiters = new Map<string, GateWaiterEntry>()
  private readonly steerWaiters = new Map<string, SteerWaiterEntry>()
  private disposed = false

  /**
   * @param store - journal storage seam implementation.
   * @param options - identity, poll interval, and warning sink.
   */
  constructor(
    private readonly store: JournalStore,
    private readonly options: DurableEngineCoreOptions,
  ) {}

  /**
   * Register a definition for execution and boot-time revival. Registering
   * the same object again is a no-op; the same identity with a different
   * object rejects (two live bodies for one identity is unresolvable).
   * Registration also runs the boot scan: a freshly registered definition
   * may revive unfinished runs left by a previous process.
   * @param def - opaque definition record.
   */
  register(def: EngineDefinition): void {
    this.assertNotDisposed()
    const key = definitionKey(def.kind, def.name, def.version)
    const existing = this.definitions.get(key)
    if (existing !== undefined && existing !== def) {
      throw new Error(`durable engine: definition ${def.kind}/${def.name}/${def.version} is already registered with a different body`)
    }
    this.definitions.set(key, def)
    this.bootScan()
  }

  /**
   * Start a run, or attach to an existing one (idempotent start-or-attach):
   * an unknown runId inserts and drives; a terminal run settles from its
   * row; a run this process drives returns its live handle; a run driven
   * elsewhere (or awaiting revival) is polled at `pollMs` — reviving is the
   * boot scan's job, never the attach path's (spec 01 §5).
   * @param def - registered definition to run (identity must match any existing row).
   * @param input - JSON-serializable run input.
   * @param opts - run identity and caller cancellation.
   * @returns the run handle.
   */
  run(def: EngineDefinition, input: unknown, opts?: EngineRunOptions): EngineRunHandle {
    this.assertNotDisposed()
    this.assertRegistered(def)
    const runId = opts?.runId ?? randomUUID()
    const existing = this.store.selectRun(runId)
    if (existing === undefined) {
      return this.insertAndDrive(def, input, {
        runId,
        inputJson: JSON.stringify(input),
        parentRunId: opts?.parent?.runId,
        parentStepKey: opts?.parent?.stepKey,
      }, opts?.signal).handle
    }
    this.assertSameDefinition(existing, def)
    const driving = this.drivers.get(runId)
    if (driving !== undefined) return driving.handle
    if (isTerminal(existing.status)) return this.settledHandle(existing)
    return this.pollUntilSettled(runId)
  }

  /**
   * Settle a gate (first-wins): the one resolve seam for SDK direct calls,
   * Manager UI, and (deferred) webhooks. When this process holds the
   * waiter, the value contract validates before the write — an invalid
   * settlement throws here and records nothing. A second settler is a
   * no-op. A waiting driver in this process resumes immediately; elsewhere
   * it observes the row through its poll or the next boot scan.
   * @param runId - run identity.
   * @param gate - gate name.
   * @param settlement - resolved value or rejection reason.
   * @param source - who settled, recorded on the row.
   * @returns whether this call won the settlement.
   */
  resolveGate(runId: string, gate: string, settlement: GateSettlement, source: GateResolutionSource): boolean {
    this.assertNotDisposed()
    const waiter = this.gateWaiters.get(gateWaiterKey(runId, gate))
    const payloadJson = settlement.state === 'resolved'
      ? JSON.stringify(waiter?.schema === undefined ? settlement.value : waiter.schema.parse(settlement.value))
      : JSON.stringify(settlement.reason)
    const won = this.store.settlePromise(runId, gate, {
      state: settlement.state,
      payloadJson,
      source,
      resolvedAt: Date.now(),
    })
    if (waiter !== undefined) this.deliverRecordedResolution(runId, gate, waiter)
    return won
  }

  /**
   * Append a steer segment to an unfinished steerable run (issue #53): the
   * segment row is recorded first (durable before delivery), then a body
   * parked in this process wakes immediately; elsewhere the parked poll or
   * the next boot scan observes the row. A parked run stays `running` — a
   * steer never resolves a gate nor wakes a `waiting` run early.
   * @param runId - run identity.
   * @param input - JSON-serializable follow-up input; validated by the SDK face.
   * @returns the assigned segment sequence (1-based).
   */
  steer(runId: string, input: unknown): number {
    this.assertNotDisposed()
    const row = this.store.selectRun(runId)
    if (row === undefined) throw new Error(`durable engine: steer targets unknown run ${runId}`)
    if (isTerminal(row.status)) {
      throw new Error(`durable engine: steer targets terminal run ${runId} (${row.status})`)
    }
    const def = this.definitions.get(definitionKey(row.def_kind, row.def_name, row.def_version))
    if (def !== undefined && def.steerable !== true) {
      throw new Error(
        `durable engine: run ${runId} belongs to ${row.def_kind}/${row.def_name}/${row.def_version}, which is not steerable`,
      )
    }
    const seq = this.store.selectJournalSegments(runId).length + 1
    this.store.insertJournalSegment({ runId, seq, inputJson: JSON.stringify(input), createdAt: Date.now() })
    const waiter = this.steerWaiters.get(runId)
    if (waiter !== undefined && seq > waiter.known) waiter.deliver()
    return seq
  }

  /**
   * Rerun a terminal top-level run (issue #57): inserts a fresh row with the
   * same definition identity and input, chained to its source by
   * `attempt = source.attempt + 1` and `retried_from_run_id = source.run_id`,
   * then drives it. Child runs reject — a child rerun would detach the
   * attempt chain from the parent's step journal; retry the top-level run
   * instead.
   * @param runId - source run identity.
   * @returns the new run's handle, already driving.
   */
  rerun(runId: string): EngineRunHandle {
    this.assertNotDisposed()
    const row = this.store.selectRun(runId)
    if (row === undefined) throw new Error(`durable engine: rerun targets unknown run ${runId}`)
    if (!isTerminal(row.status)) {
      throw new Error(`durable engine: rerun targets unfinished run ${runId} (${row.status})`)
    }
    if (row.parent_run_id !== null) {
      throw new Error(`durable engine: rerun targets child run ${runId} (rerun applies to top-level runs only)`)
    }
    const def = this.definitions.get(definitionKey(row.def_kind, row.def_name, row.def_version))
    if (def === undefined) {
      throw new Error(
        `durable engine: run ${runId} belongs to ${row.def_kind}/${row.def_name}/${row.def_version}, which is not registered`,
      )
    }
    return this.insertAndDrive(def, JSON.parse(row.input_json), {
      runId: randomUUID(),
      inputJson: row.input_json,
      parentRunId: undefined,
      parentStepKey: undefined,
      attempt: row.attempt + 1,
      retriedFromRunId: row.run_id,
    }, undefined).handle
  }

  /**
   * Revive unfinished runs: sweep overdue gates to `timedout` (first-wins),
   * then claim each unclaimed (or foreign-claimed) run and re-drive it from
   * its recorded steps; runs this instance already claimed (an earlier scan
   * that lacked the definition) drive once their definition registers. Runs
   * whose definitions are not registered stay unfinished and are retried on
   * a later scan.
   */
  bootScan(): void {
    this.assertNotDisposed()
    // Missed deadlines first: a process that died before its timeout fired
    // leaves the gate pending; settle it so the revived wait reads `timedout`.
    for (const promise of this.store.selectOverduePromises(Date.now())) {
      this.store.settlePromise(promise.run_id, promise.gate, {
        state: 'timedout',
        payloadJson: undefined,
        source: undefined,
        resolvedAt: Date.now(),
      })
      const waiter = this.gateWaiters.get(gateWaiterKey(promise.run_id, promise.gate))
      if (waiter !== undefined) this.deliverRecordedResolution(promise.run_id, promise.gate, waiter)
    }
    for (const runId of this.store.selectUnfinishedRunIds()) {
      const row = this.store.selectRun(runId)
      if (row === undefined) {
        this.options.logger.warn(`durable engine: boot scan saw run ${runId} but its row vanished`)
        continue
      }
      const selfClaimed = row.claimed_by === this.options.instanceId && !this.drivers.has(runId)
      if (!selfClaimed && !this.store.claimRun(runId, this.options.instanceId, Date.now())) continue
      const def = this.definitions.get(definitionKey(row.def_kind, row.def_name, row.def_version))
      if (def === undefined) {
        this.options.logger.warn(
          `durable engine: boot scan could not revive run ${runId}: definition ${row.def_kind}/${row.def_name}/${row.def_version} is not registered`,
        )
        continue
      }
      this.drive(runId, def, JSON.parse(row.input_json), undefined)
    }
  }

  /**
   * Resolve when no run is being driven in this process.
   * Runs polled from elsewhere do not count as activity.
   */
  async idle(): Promise<void> {
    while (this.drivers.size > 0) {
      await Promise.all([...this.drivers.values()].map(entry => entry.onSettled))
    }
  }

  /**
   * List run rows from the ledger, newest first.
   * Like {@link EngineRunHandle.status}, reads stay available after disposal.
   * @param filter - optional status restriction.
   * @returns matching run rows.
   */
  listRuns(filter?: RunListFilter): RunRow[] {
    return this.store.selectRuns(filter)
  }

  /**
   * Read one run's parent/child lineage in one call.
   * @param runId - run identity.
   * @returns the run's own row, its parent, and its direct children.
   */
  runLineage(runId: string): RunLineage {
    const run = this.store.selectRun(runId)
    if (run === undefined) return { run: null, parent: null, children: [] }
    const parent = run.parent_run_id === null ? null : this.store.selectRun(run.parent_run_id) ?? null
    return { run, parent, children: this.store.selectChildRuns(runId) }
  }

  /**
   * Enumerate one run's journal steps in start order.
   * @param runId - run identity.
   * @returns the run's journal steps in start order.
   */
  journalTimeline(runId: string): JournalRow[] {
    return this.store.selectJournalSteps(runId)
  }

  /**
   * Enumerate the registered definitions in registration order (spec 05 §5):
   * identity and display metadata, never the body. Each call returns fresh
   * copies, so a caller cannot reach the registry through the result. Like
   * {@link EngineRunHandle.status}, reads stay available after disposal. The
   * `display` key is omitted (not undefined-valued) when undeclared: the
   * gateway's Remote channel serves this method and rejects non-JSON values.
   * @returns the registry entries in registration order.
   */
  listDefinitions(): DefinitionView[] {
    return [...this.definitions.values()].map(def => ({
      kind: def.kind,
      name: def.name,
      version: def.version,
      ...def.display === undefined ? {} : { display: { ...def.display } },
    }))
  }

  /**
   * Stop driving: abort in-process drivers and attach polls without writing
   * terminal run states — unfinished runs stay revivable by the next boot.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.drivers.values()) entry.abort()
    for (const poll of this.polls.values()) poll.stop(new EngineRunError('ENGINE_DISPOSED', 'unknown'))
    this.drivers.clear()
    this.polls.clear()
  }

  /** Whether a driver must stop without recording: aborted or disposed. */
  private driverStopped(signal: AbortSignal): boolean {
    if (this.disposed) return true
    return signal.aborted
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new EngineRunError('ENGINE_DISPOSED', 'unknown')
  }

  private assertRegistered(def: EngineDefinition): void {
    const key = definitionKey(def.kind, def.name, def.version)
    if (this.definitions.get(key) !== def) {
      throw new Error(`durable engine: definition ${def.kind}/${def.name}/${def.version} must be registered before run()`)
    }
  }

  private assertSameDefinition(row: RunRow, def: EngineDefinition): void {
    if (row.def_kind !== def.kind || row.def_name !== def.name || row.def_version !== def.version) {
      throw new Error(
        `durable engine: run ${row.run_id} belongs to ${row.def_kind}/${row.def_name}/${row.def_version}, not ${def.kind}/${def.name}/${def.version}`,
      )
    }
  }

  /**
   * Insert a fresh run row claimed by this instance and drive it. Shared by
   * run()'s start branch and rerun()'s attempt-chain insert.
   * @param def - registered definition to execute.
   * @param input - decoded run input handed to the body.
   * @param insert - run-row fields beyond the definition identity and claim.
   * @param callerSignal - caller cancellation, forwarded into the driver.
   * @returns the new run's driver entry.
   */
  private insertAndDrive(
    def: EngineDefinition,
    input: unknown,
    insert: {
      readonly runId: string
      readonly inputJson: string
      readonly parentRunId: string | undefined
      readonly parentStepKey: string | undefined
      readonly attempt?: number
      readonly retriedFromRunId?: string
    },
    callerSignal: AbortSignal | undefined,
  ): DriverEntry {
    const now = Date.now()
    this.store.insertRun({
      ...insert,
      defKind: def.kind,
      defName: def.name,
      defVersion: def.version,
      claimedBy: this.options.instanceId,
      claimedAt: now,
      createdAt: now,
    })
    return this.drive(insert.runId, def, input, callerSignal)
  }

  private drive(runId: string, def: EngineDefinition, input: unknown, callerSignal: AbortSignal | undefined): DriverEntry {
    const controller = new AbortController()
    let settle!: (value: unknown) => void
    let reject!: (error: EngineRunError) => void
    const result = new Promise<unknown>((resolve, thrown) => {
      settle = resolve
      reject = thrown
    })
    // Boot-revived runs settle with no caller holding this promise; mark it
    // handled so a terminal rejection never crashes the process. Real
    // consumers still receive the settlement.
    result.catch(() => {})
    let abortCause: string | undefined
    const entry: DriverEntry = {
      handle: {
        id: runId,
        result,
        status: () => this.statusOf(runId),
        cancel: cause => this.cancelRun(runId, cause),
      },
      // Replaced with the real driving promise below, after registration:
      // the body's synchronous prefix must only ever observe a registered,
      // fully-built driver.
      onSettled: Promise.resolve(),
      abort: (cause?: unknown) => {
        abortCause = cause === undefined ? undefined : (typeof cause === 'string' ? cause : JSON.stringify(cause))
        controller.abort()
      },
    }
    this.drivers.set(runId, entry)
    const forward = () =>{  entry.abort(callerSignal?.reason) }
    callerSignal?.addEventListener('abort', forward, { once: true })
    if (callerSignal?.aborted === true) entry.abort(callerSignal.reason)
    entry.onSettled = (async () => {
      try {
        const output = await def.body(this.stepCtxFor(entry, controller.signal), input)
        if (this.disposed) {
          // The body raced disposal: its output is real, but the ledger must
          // not be touched once the engine is disposed — the run stays
          // unfinished and the next boot decides it anew.
          reject(new EngineRunError('ENGINE_DISPOSED', runId))
          return
        }
        const finalized = this.store.finalizeRun(runId, {
          status: 'done',
          outputJson: JSON.stringify(output),
          errorJson: undefined,
          cancelCause: undefined,
          finishedAt: Date.now(),
        })
        if (finalized) {
          settle(output)
        } else {
          // The row left `running` while the body's last step was in flight
          // (cancellation is effective at step boundaries): the first
          // terminal write wins, so report that outcome instead.
          reject(this.terminalRejection(runId))
        }
      } catch (error) {
        if (this.disposed) {
          reject(new EngineRunError('ENGINE_DISPOSED', runId))
        } else if (controller.signal.aborted) {
          this.finalizeCancelledFromDriver(runId, abortCause)
          reject(new EngineRunError('RUN_CANCELLED', runId, abortCause))
        } else {
          this.finalizeFailedFromDriver(runId, error)
          reject(new EngineRunError('RUN_FAILED', runId, error))
        }
      } finally {
        callerSignal?.removeEventListener('abort', forward)
        this.drivers.delete(runId)
        // A body that died mid-wait (or returned with a gate still pending)
        // leaves its waiter registered; fail it so no timer or poll outlives
        // the driver.
        this.abandonGateWaiters(runId)
      }
    })()
    return entry
  }

  /** Fail every gate waiter one run still has registered. */
  private abandonGateWaiters(runId: string): void {
    for (const [key, waiter] of this.gateWaiters) {
      if (key.startsWith(gateWaiterKey(runId, ''))) {
        waiter.fail(new EngineRunError('RUN_FAILED', runId,
          new Error(`run ${runId} settled while a gate wait was still pending`)))
      }
    }
    // A body that died mid-park (or returned with a steer wait still pending)
    // leaves its waiter registered; fail it so no poll outlives the driver.
    this.steerWaiters.get(runId)?.fail(new EngineRunError('RUN_FAILED', runId,
      new Error(`run ${runId} settled while a steer wait was still pending`)))
  }

  private stepCtxFor(entry: DriverEntry, signal: AbortSignal): EngineStepCtx {
    const runId = entry.handle.id
    const occurrences = new Map<string, number>()
    /** Reject a step/gate action whose run is disposed, aborted, lost, or cancelled. */
    const assertDrivable = (): void => {
      this.assertNotDisposed()
      if (signal.aborted) throw new EngineRunError('RUN_CANCELLED', runId)
      const row = this.store.selectRun(runId)
      if (row === undefined) throw new Error(`durable engine: ledger lost run ${runId}`)
      if (row.status === 'cancelled') {
        entry.abort(row.cancel_cause ?? undefined)
        throw new EngineRunError('RUN_CANCELLED', runId, row.cancel_cause ?? undefined)
      }
    }
    return {
      runId,
      signal,
      step: async <T>(name: string, fn: () => Promise<T>, opts?: EngineStepOptions): Promise<T> => {
        assertDrivable()
        const occurrence = occurrences.get(name) ?? 0
        occurrences.set(name, occurrence + 1)
        const stepKey = opts?.key ?? `${name}#${occurrence}`
        const existing = this.store.selectJournalStep(runId, stepKey)
        if (existing?.status === 'completed') return JSON.parse(existing.value_json ?? 'null') as T
        if (existing === undefined) {
          this.store.insertJournalStep({ runId, stepKey, name, occurrence, startedAt: Date.now() })
        }
        const childOccurrences = new Map<string, number>()
        const scope: EngineStepScope = {
          runId,
          stepKey,
          childRunId: (kind, childName) => {
            const key = `${kind}${childName}`
            const childOccurrence = childOccurrences.get(key) ?? 0
            childOccurrences.set(key, childOccurrence + 1)
            return `${runId}/${stepKey}/${kind}:${childName}#${childOccurrence}`
          },
        }
        try {
          const value = await stepScopeStorage.run(scope, fn)
          this.store.completeJournalStep(runId, stepKey, JSON.stringify(value), Date.now())
          return value
        } catch (error) {
          if (this.driverStopped(signal)) throw error
          try {
            this.store.failJournalStep(runId, stepKey, errorJsonOf(error), Date.now())
          } catch (recordError) {
            // The step's own failure is the outcome to report; a store
            // outage while recording it only degrades the ledger copy.
            this.options.logger.warn(
              `durable engine: recording failure of step ${runId}/${stepKey} failed: ${String(recordError)}`,
            )
          }
          throw error
        }
      },
      waitFor: <T = unknown>(gate: string, opts?: WaitForOptions<T>): Promise<GateResolution<T>> => {
        assertDrivable()
        const schema = opts?.schema as GateSchema<unknown> | undefined
        const existing = this.store.selectPromise(runId, gate)
        if (existing !== undefined && existing.state !== 'pending') {
          // Re-drive after the gate settled: the recorded outcome returns
          // without waiting again; a run left `waiting` by a crash between
          // settlement and resume now moves on.
          this.store.resumeRun(runId, Date.now())
          return Promise.resolve(this.resolutionFromRow(existing, schema) as GateResolution<T>)
        }
        let timeoutAt: number | undefined
        if (existing === undefined) {
          const now = Date.now()
          timeoutAt = opts?.timeout === undefined ? undefined : now + opts.timeout
          this.store.insertPromise({
            runId,
            gate,
            schemaJson: schema === undefined ? undefined : JSON.stringify(schema.toJSONSchema()),
            timeoutAt,
            createdAt: now,
          })
        } else {
          timeoutAt = existing.timeout_at ?? undefined
        }
        this.store.setRunWaiting(runId, gate, Date.now())
        return this.suspendOnGate(entry, signal, gate, schema, timeoutAt) as Promise<GateResolution<T>>
      },
      steers: (): readonly unknown[] =>
        this.store.selectJournalSegments(runId).map(row => JSON.parse(row.value_json ?? 'null') as unknown),
      awaitSteer: (known: number): Promise<void> => {
        assertDrivable()
        if (this.store.selectJournalSegments(runId).length > known) return Promise.resolve()
        return this.suspendOnSteer(entry, signal, known)
      },
    }
  }

  /**
   * Suspend the driver on a pending gate: register the in-process waiter and
   * wake on the first of a same-process resolve push, the cross-process poll
   * fallback, the timeout, or driver abort (cancellation / disposal).
   * @param entry - the driver waiting.
   * @param signal - driver abort signal.
   * @param gate - gate name.
   * @param schema - live value contract held for delivery-time validation.
   * @param timeoutAt - recorded deadline (epoch ms), when the gate has one.
   * @returns the terminal gate outcome.
   */
  private suspendOnGate(
    entry: DriverEntry,
    signal: AbortSignal,
    gate: string,
    schema: GateSchema<unknown> | undefined,
    timeoutAt: number | undefined,
  ): Promise<GateResolution> {
    const runId = entry.handle.id
    const key = gateWaiterKey(runId, gate)
    if (this.gateWaiters.has(key)) {
      throw new Error(`durable engine: run ${runId} already waits on gate ${gate} in this process`)
    }
    let deliver!: (resolution: GateResolution) => void
    let fail!: (error: unknown) => void
    const waiting = new Promise<GateResolution>((resolve, reject) => {
      deliver = resolve
      fail = reject
    })
    // A body that abandons its wait (floating call, or death by a sibling
    // branch) holds no consumer; mark handled so the abandonment rejection
    // never crashes the process. Real awaiters still receive it.
    waiting.catch(() => {})
    let timeoutTimer: NodeJS.Timeout | undefined
    // Settling a promise is idempotent, so repeated deliver/fail after the
    // first outcome is a no-op; cleanup is idempotent too.
    const waiter: GateWaiterEntry = {
      schema,
      deliver: (resolution) => {
        cleanup()
        // A no-op unless the row still reads `waiting` (cancelled runs are
        // terminal already), so every outcome can take the same path.
        this.store.resumeRun(runId, Date.now())
        deliver(resolution)
      },
      fail: (error) => {
        cleanup()
        fail(error)
      },
    }
    const cleanup = () => {
      this.gateWaiters.delete(key)
      clearInterval(pollTimer)
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      if (this.disposed) {
        waiter.fail(new EngineRunError('ENGINE_DISPOSED', runId))
      } else {
        waiter.deliver({ state: 'cancelled' })
      }
    }
    const pollTimer = setInterval(() => {
      try {
        const row = this.store.selectPromise(runId, gate)
        if (row === undefined) {
          waiter.fail(new Error(`durable engine: ledger lost promise ${runId}/${gate}`))
          return
        }
        if (row.state !== 'pending') this.deliverRecordedResolution(runId, gate, waiter)
      } catch (error) {
        waiter.fail(error)
      }
    }, this.options.pollMs)
    signal.addEventListener('abort', onAbort, { once: true })
    if (timeoutAt !== undefined) {
      // A past deadline arms an immediate timeout; setTimeout clamps negatives.
      timeoutTimer = setTimeout(() => {
        try {
          // First-wins against a concurrent resolver: the recorded row decides.
          this.store.settlePromise(runId, gate, {
            state: 'timedout',
            payloadJson: undefined,
            source: undefined,
            resolvedAt: Date.now(),
          })
          this.deliverRecordedResolution(runId, gate, waiter)
        } catch (error) {
          waiter.fail(error)
        }
      }, timeoutAt - Date.now())
    }
    this.gateWaiters.set(key, waiter)
    return waiting
  }

  /**
   * Park the driver until a steer segment beyond `known` is recorded: wake on
   * the first of a same-process steer push, the cross-process poll fallback,
   * or driver abort (cancellation / disposal). The poll also observes a row
   * settled by another writer, so a cross-process cancel cannot strand the
   * wait. Mirrors {@link suspendOnGate} minus schema and timeout — a parked
   * steer wait has neither.
   * @param entry - the driver parking.
   * @param signal - driver abort signal.
   * @param known - count of segments the body already consumed.
   */
  private suspendOnSteer(entry: DriverEntry, signal: AbortSignal, known: number): Promise<void> {
    const runId = entry.handle.id
    if (this.steerWaiters.has(runId)) {
      throw new Error(`durable engine: run ${runId} already parks for steer in this process`)
    }
    let deliver!: () => void
    let fail!: (error: unknown) => void
    const waiting = new Promise<void>((resolve, reject) => {
      deliver = resolve
      fail = reject
    })
    // A body that abandons its wait (floating call, or death by a sibling
    // branch) holds no consumer; mark handled so the abandonment rejection
    // never crashes the process. Real awaiters still receive it.
    waiting.catch(() => {})
    // Delivery is idempotent, so repeated deliver/fail after the first
    // outcome is a no-op; cleanup is idempotent too.
    const waiter: SteerWaiterEntry = {
      known,
      deliver: () => {
        cleanup()
        deliver()
      },
      fail: (error) => {
        cleanup()
        fail(error)
      },
    }
    const cleanup = () => {
      this.steerWaiters.delete(runId)
      clearInterval(pollTimer)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      if (this.disposed) {
        waiter.fail(new EngineRunError('ENGINE_DISPOSED', runId))
      } else {
        waiter.fail(new EngineRunError('RUN_CANCELLED', runId))
      }
    }
    const pollTimer = setInterval(() => {
      try {
        const row = this.store.selectRun(runId)
        if (row === undefined) {
          waiter.fail(new Error(`durable engine: ledger lost run ${runId}`))
          return
        }
        if (row.status === 'cancelled') {
          // Mirror assertDrivable: abort first so the driver codes the
          // rejection RUN_CANCELLED instead of wrapping it as a failure.
          entry.abort(row.cancel_cause ?? undefined)
          waiter.fail(new EngineRunError('RUN_CANCELLED', runId, row.cancel_cause ?? undefined))
          return
        }
        if (isTerminal(row.status)) {
          waiter.fail(new Error(`durable engine: run ${runId} reached terminal state ${row.status} while parked for steer`))
          return
        }
        if (this.store.selectJournalSegments(runId).length > known) waiter.deliver()
      } catch (error) {
        waiter.fail(error)
      }
    }, this.options.pollMs)
    signal.addEventListener('abort', onAbort, { once: true })
    this.steerWaiters.set(runId, waiter)
    return waiting
  }

  /**
   * Decode a settled promise row into the body-facing union, validating a
   * resolved payload against the live contract (delivery side: covers
   * settlements written cross-process, where no live schema was available).
   * @param row - the settled promise row.
   * @param schema - the gate's value contract, when declared.
   * @returns the terminal gate outcome.
   */
  private resolutionFromRow(row: PromiseRow, schema: GateSchema<unknown> | undefined): GateResolution {
    switch (row.state) {
      case 'resolved': {
        const raw: unknown = JSON.parse(row.payload_json ?? 'null')
        return { state: 'resolved', value: schema === undefined ? raw : schema.parse(raw) }
      }
      case 'rejected': {
        const reason: unknown = JSON.parse(row.payload_json ?? 'null')
        return { state: 'rejected', reason: typeof reason === 'string' ? reason : JSON.stringify(reason) }
      }
      case 'timedout': return { state: 'timedout' }
      case 'cancelled': return { state: 'cancelled' }
      case 'pending': throw new Error(`durable engine: promise ${row.run_id}/${row.gate} is still pending`)
    }
  }

  /**
   * Read the promise row and hand its outcome to the waiter; a settled row
   * whose payload fails validation rejects the wait instead (the body's step
   * fails loud rather than consuming an unchecked value).
   */
  private deliverRecordedResolution(runId: string, gate: string, waiter: GateWaiterEntry): void {
    const row = this.store.selectPromise(runId, gate)
    if (row === undefined) {
      waiter.fail(new Error(`durable engine: ledger lost promise ${runId}/${gate}`))
      return
    }
    try {
      waiter.deliver(this.resolutionFromRow(row, waiter.schema))
    } catch (error) {
      waiter.fail(error)
    }
  }

  /** Build the rejection for a driver whose run reached a terminal row before its own completion write. */
  private terminalRejection(runId: string): EngineRunError {
    const row = this.store.selectRun(runId)
    if (row?.status === 'cancelled') {
      return new EngineRunError('RUN_CANCELLED', runId, row.cancel_cause ?? undefined)
    }
    return new EngineRunError('RUN_FAILED', runId,
      new Error(`run ${runId} reached terminal state ${row?.status ?? 'unknown'} before completion`))
  }

  // oxlint-disable-next-line typescript/require-await -- async keeps a store throw a rejection, not a synchronous throw
  private async cancelRun(runId: string, cause?: string): Promise<void> {
    this.store.finalizeRun(runId, {
      status: 'cancelled',
      outputJson: undefined,
      errorJson: undefined,
      cancelCause: cause,
      finishedAt: Date.now(),
    })
    this.store.cancelPendingPromises(runId, Date.now())
    this.drivers.get(runId)?.abort(cause)
  }

  private finalizeCancelledFromDriver(runId: string, cause: string | undefined): void {
    const row = this.store.selectRun(runId)
    // A same-process cancel already wrote the terminal row; a row cancelled
    // through another process needs no second write. Anything else means the
    // row vanished mid-run — nothing to finalize.
    if (row === undefined || isTerminal(row.status)) return
    this.store.finalizeRun(runId, {
      status: 'cancelled',
      outputJson: undefined,
      errorJson: undefined,
      cancelCause: cause,
      finishedAt: Date.now(),
    })
    this.store.cancelPendingPromises(runId, Date.now())
  }

  private finalizeFailedFromDriver(runId: string, error: unknown): void {
    try {
      this.store.finalizeRun(runId, {
        status: 'failed',
        outputJson: undefined,
        errorJson: errorJsonOf(error),
        cancelCause: undefined,
        finishedAt: Date.now(),
      })
    } catch (finalizeError) {
      // The run's failure is the outcome to report; a store outage while
      // recording it only degrades the ledger copy, so it is logged and
      // swallowed (the fault-injection suite exercises this window).
      this.options.logger.warn(
        `durable engine: recording failure of run ${runId} failed: ${String(finalizeError)}`,
      )
    }
  }

  private statusOf(runId: string): EngineRunStatus {
    const row = this.store.selectRun(runId)
    if (row === undefined) throw new Error(`durable engine: ledger lost run ${runId}`)
    return this.statusFromRow(row)
  }

  private statusFromRow(row: RunRow): EngineRunStatus {
    switch (row.status) {
      case 'running': return { state: 'running' }
      case 'done': return { state: 'done' }
      case 'failed': return { state: 'failed', error: row.error_json === null ? undefined : JSON.parse(row.error_json) }
      case 'cancelled': return row.cancel_cause === null
        ? { state: 'cancelled' }
        : { state: 'cancelled', cause: row.cancel_cause }
      case 'waiting': {
        if (row.waiting_gate === null) {
          throw new Error(`durable engine: run ${row.run_id} is waiting with no gate recorded`)
        }
        return { state: 'waiting', gate: row.waiting_gate }
      }
    }
  }

  private settledHandle(row: RunRow): EngineRunHandle {
    const settledStatus = this.statusFromRow(row)
    return {
      id: row.run_id,
      result: this.settledResult(row),
      status: () => settledStatus,
      cancel: () => Promise.resolve(),
    }
  }

  private settledResult(row: RunRow): Promise<unknown> {
    if (row.status === 'done') return Promise.resolve(JSON.parse(row.output_json ?? 'null'))
    // Marked handled: an attach caller may take only status() and drop the
    // result; the promise itself still delivers to real consumers.
    if (row.status === 'failed') {
      const failed = Promise.reject(new EngineRunError('RUN_FAILED', row.run_id,
        row.error_json === null ? undefined : JSON.parse(row.error_json)))
      failed.catch(() => {})
      return failed
    }
    const cancelled = Promise.reject(new EngineRunError('RUN_CANCELLED', row.run_id, row.cancel_cause ?? undefined))
    cancelled.catch(() => {})
    return cancelled
  }

  private pollUntilSettled(runId: string): EngineRunHandle {
    const existing = this.polls.get(runId)
    if (existing !== undefined) return existing.handle
    let settle!: (value: unknown) => void
    let reject!: (error: EngineRunError) => void
    const result = new Promise<unknown>((resolve, thrown) => {
      settle = resolve
      reject = thrown
    })
    // The poll handle may outlive its consumer; see drive()'s marker note.
    result.catch(() => {})
    const entry: PollEntry = {
      handle: {
        id: runId,
        result,
        status: () => this.statusOf(runId),
        cancel: cause => this.cancelRun(runId, cause),
      },
      stop: (error: EngineRunError) => {
        clearInterval(timer)
        this.polls.delete(runId)
        reject(error)
      },
    }
    const timer = setInterval(() => {
      const row = this.store.selectRun(runId)
      if (row === undefined) {
        entry.stop(new EngineRunError('RUN_FAILED', runId, new Error(`durable engine: ledger lost run ${runId}`)))
        return
      }
      if (!isTerminal(row.status)) return
      clearInterval(timer)
      this.polls.delete(runId)
      if (row.status === 'done') settle(JSON.parse(row.output_json ?? 'null'))
      else if (row.status === 'failed') {
        reject(new EngineRunError('RUN_FAILED', runId, row.error_json === null ? undefined : JSON.parse(row.error_json)))
      } else {
        reject(new EngineRunError('RUN_CANCELLED', runId, row.cancel_cause ?? undefined))
      }
    }, this.options.pollMs)
    this.polls.set(runId, entry)
    return entry.handle
  }
}
