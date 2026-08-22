/**
 * The durable engine core: definition registry, run lifecycle, step dedup
 * re-drive, single-writer claims, boot scan, and cancellation — everything
 * except Cordis wiring and database ownership. The Cordis service in
 * `index.ts` is a thin adapter over this core, and the fault-injection
 * suite drives the core through wrapped {@link JournalStore} seams
 * (spec 01 §5, §9).
 * @module @daypaw/engine/core
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { RunDefKind, RunRow } from '@daypaw/store'
import type { JournalStore } from './seams.ts'

/** Run status reported by handles. `waiting` lands with `ctx.waitFor`. */
export type EngineRunStatus =
  | { readonly state: 'running' }
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
  /** Opaque body thunk; the engine calls it with a step ctx and the run input. */
  readonly body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>
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
      const now = Date.now()
      this.store.insertRun({
        runId,
        defKind: def.kind,
        defName: def.name,
        defVersion: def.version,
        inputJson: JSON.stringify(input),
        parentRunId: opts?.parent?.runId,
        parentStepKey: opts?.parent?.stepKey,
        claimedBy: this.options.instanceId,
        claimedAt: now,
        createdAt: now,
      })
      return this.drive(runId, def, input, opts?.signal).handle
    }
    this.assertSameDefinition(existing, def)
    const driving = this.drivers.get(runId)
    if (driving !== undefined) return driving.handle
    if (isTerminal(existing.status)) return this.settledHandle(existing)
    return this.pollUntilSettled(runId)
  }

  /**
   * Revive unfinished runs: claim each unclaimed (or foreign-claimed) run
   * and re-drive it from its recorded steps; runs this instance already
   * claimed (an earlier scan that lacked the definition) drive once their
   * definition registers. Runs whose definitions are not registered stay
   * unfinished and are retried on a later scan.
   */
  bootScan(): void {
    this.assertNotDisposed()
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
      }
    })()
    return entry
  }

  private stepCtxFor(entry: DriverEntry, signal: AbortSignal): EngineStepCtx {
    const runId = entry.handle.id
    const occurrences = new Map<string, number>()
    return {
      runId,
      signal,
      step: async <T>(name: string, fn: () => Promise<T>, opts?: EngineStepOptions): Promise<T> => {
        this.assertNotDisposed()
        if (signal.aborted) throw new EngineRunError('RUN_CANCELLED', runId)
        const row = this.store.selectRun(runId)
        if (row === undefined) throw new Error(`durable engine: ledger lost run ${runId}`)
        if (row.status === 'cancelled') {
          entry.abort(row.cancel_cause ?? undefined)
          throw new EngineRunError('RUN_CANCELLED', runId, row.cancel_cause ?? undefined)
        }
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

  private cancelRun(runId: string, cause?: string): Promise<void> {
    this.store.finalizeRun(runId, {
      status: 'cancelled',
      outputJson: undefined,
      errorJson: undefined,
      cancelCause: cause,
      finishedAt: Date.now(),
    })
    this.drivers.get(runId)?.abort(cause)
    return Promise.resolve()
  }

  private finalizeCancelledFromDriver(runId: string, cause: string | undefined): void {
    const row = this.store.selectRun(runId)
    // A same-process cancel already wrote the terminal row; a row cancelled
    // through another process needs no second write. Anything else means the
    // row vanished mid-run — nothing to finalize.
    if (row === undefined || row.status !== 'running') return
    this.store.finalizeRun(runId, {
      status: 'cancelled',
      outputJson: undefined,
      errorJson: undefined,
      cancelCause: cause,
      finishedAt: Date.now(),
    })
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
      case 'waiting': throw new Error('durable engine: waiting status lands with ctx.waitFor (spec 01 §6)')
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
