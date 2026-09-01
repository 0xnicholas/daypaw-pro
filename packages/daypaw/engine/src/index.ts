/**
 * The durable engine Cordis service (`ctx.durable`): definition registry,
 * run lifecycle, step-dedup re-drive, durable gates (`ctx.waitFor`),
 * single-writer claims, and boot-scan revival over the SQLite ledger
 * (spec: docs/spec/01-durable-execution.md,
 * programming face docs/spec/02-agent-engine-sdk.md). Load this plugin in a
 * Cordis composition; `@daypaw/sdk` is the typed facade applications call.
 * @module @daypaw/engine
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type { JournalRow, RunRow } from '@daypaw/store'
import { openLedgerDatabase } from '@daypaw/store'
import type { DatabaseSync } from 'node:sqlite'
import { DurableEngineCore } from './core.ts'
import type { DefinitionView, EngineDefinition, EngineRunHandle, EngineRunOptions, GateResolutionSource, GateSettlement, RunLineage } from './core.ts'
import type { Json } from './types.ts'
import type { StartRunRequest } from './types.ts'
import type { RunListFilter } from './seams.ts'
import { SqliteJournalStore } from './sqlite-journal-store.ts'

export { DurableEngineCore, EngineRunError, currentStepScope } from './core.ts'
export type { Json } from './types.ts'
export type {
  DefinitionDisplay, DefinitionView, EngineDefinition, EngineRunErrorCode, EngineRunHandle, EngineRunOptions,
  EngineRunStatus, EngineStepCtx, EngineStepOptions, EngineStepScope, EngineWireFace,
  GateResolution, GateResolutionSource, GateSchema, GateSettlement, RunLineage, WaitForOptions,
} from './core.ts'
export type { StartRunRequest } from './types.ts'
export { SqliteJournalStore } from './sqlite-journal-store.ts'
export type {
  JournalSegmentInsert, JournalStepInsert, JournalStore, PromiseInsert, PromiseSettle, RunFinalize, RunInsert, RunListFilter,
} from './seams.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    durable: DurableEngine
  }
}

/** Service configuration. */
export interface Config {
  /**
   * Ledger database file path, or `:memory:`. Missing parent directories and
   * files are created owner-only; the schema is migrated on open and a
   * database stamped newer than this build rejects.
   */
  path: string
  /** Poll interval for attach calls that find the run driven elsewhere (ms). */
  pollMs?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  pollMs: z.number().default(1_000),
})

/**
 * The `ctx.durable` service. Opens the ledger on construction (methods await
 * readiness), runs the boot scan once the database is open, and on context
 * disposal stops driving without writing terminal run states — unfinished
 * runs stay revivable by the next process. `listDefinitions` doubles as the
 * browser catalog's wire face: the TypertRemoteService binding lets the API
 * gateway claim `durable/listDefinitions` (spec 05 §5; the GoalService
 * precedent) without any upstream apiproxy edit.
 */
export default class DurableEngine extends TypertRemoteService {
  private readonly instanceId = randomUUID()
  private db: DatabaseSync | undefined
  private core: DurableEngineCore | undefined
  private readonly ready: Promise<DurableEngineCore>

  /**
   * @param ctx - owning Cordis context.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'durable')
    const pollMs = config.pollMs ?? 1_000
    this.ready = openLedgerDatabase(config.path).then((db) => {
      this.db = db
      this.core = new DurableEngineCore(new SqliteJournalStore(db), {
        instanceId: this.instanceId,
        pollMs,
        logger: { warn: (message) =>{  ctx.logger.warn(message) } },
      })
      return this.core
    })
    // A rejection with no caller yet must not crash the process; every
    // public method re-awaits `ready` and maps the failure itself.
    this.ready.catch(() => {})
    ctx.effect(() => () =>{  this.shutdown() })
  }

  /**
   * Register a definition for execution and boot-time revival.
   * @param def - opaque definition record (see `@daypaw/sdk`).
   */
  async register(def: EngineDefinition): Promise<void> {
    (await this.coreOrFail()).register(def)
  }

  /**
   * Start a run, or attach to an existing one (idempotent start-or-attach).
   * @param def - registered definition to run.
   * @param input - JSON-serializable run input.
   * @param opts - run identity and caller cancellation.
   * @returns the run handle.
   */
  async run(def: EngineDefinition, input: unknown, opts?: EngineRunOptions): Promise<EngineRunHandle> {
    return (await this.coreOrFail()).run(def, input, opts)
  }

  /**
   * Resolve when this process drives no run (boot scan included).
   */
  async idle(): Promise<void> {
    await (await this.coreOrFail()).idle()
  }

  /**
   * List run rows from the ledger, newest first (spec 05 §5).
   * @param filter - optional status restriction.
   * @returns matching run rows.
   */
  @Remote('listRuns')
  async listRuns(filter?: RunListFilter): Promise<RunRow[]> {
    return (await this.coreOrFail()).listRuns(filter)
  }

  /**
   * Read one run's parent/child lineage in one call: its own row, its
   * parent, and its direct children.
   * @param runId - run identity.
   * @returns the lineage; every field is empty when the runId is unknown.
   */
  @Remote('runLineage')
  async runLineage(runId: string): Promise<RunLineage> {
    return (await this.coreOrFail()).runLineage(runId)
  }

  /**
   * Enumerate one run's journal steps in start order (spec 05 §5).
   * @param runId - run identity.
   * @returns the run's journal steps in start order.
   */
  @Remote('journalTimeline')
  async journalTimeline(runId: string): Promise<JournalRow[]> {
    return (await this.coreOrFail()).journalTimeline(runId)
  }

  /**
   * Enumerate the registered definitions in registration order (spec 05 §5):
   * identity and display metadata, never the body — the definition registry's
   * one read face, so hosts never reach into the core's private Map. Served
   * to the browser as the Remote endpoint `durable/listDefinitions`.
   * @returns the registry entries in registration order.
   */
  @Remote('listDefinitions')
  async listDefinitions(): Promise<DefinitionView[]> {
    return (await this.coreOrFail()).listDefinitions()
  }

  /**
   * Start a run of a registered definition over the wire, or attach to an
   * existing runId (idempotent start-or-attach, ruling #65): resolve the
   * registry identity, validate the input through the definition's wire face
   * when present, then run. The handle's result is deliberately not awaited
   * or returned — browsers observe runs through `listRuns` and
   * `journalTimeline` (spec 05 §5's polling model), so a failed run must not
   * surface as an unhandled rejection on the host.
   * @param request - definition identity, input, and optional run identity.
   * @returns the run id.
   */
  @Remote('startRun')
  async startRun(request: StartRunRequest): Promise<{ runId: string }> {
    const core = await this.coreOrFail()
    const def = core.resolveDefinition(request.defName, request.defVersion)
    const input = def.wire === undefined ? request.input : def.wire.parseInput(request.input)
    const handle = core.run(def, input, request.runId === undefined ? {} : { runId: request.runId })
    handle.result.catch(() => {})
    return { runId: handle.id }
  }

  /**
   * Settle a gate (first-wins): the one resolve seam for SDK direct calls,
   * Manager UI, and (deferred) webhooks. See {@link DurableEngineCore.resolveGate}.
   * @param runId - run identity.
   * @param gate - gate name.
   * @param settlement - resolved value or rejection reason.
   * @param source - who settled, recorded on the row.
   * @returns whether this call won the settlement.
   */
  async resolveGate(runId: string, gate: string, settlement: GateSettlement, source: GateResolutionSource): Promise<boolean> {
    return (await this.coreOrFail()).resolveGate(runId, gate, settlement, source)
  }

  /**
   * Append a steer segment to an unfinished steerable run (issue #53):
   * durable before delivery — a body parked in this process wakes
   * immediately, elsewhere the parked poll or the next boot scan observes the
   * segment row. Served to the browser as the Remote endpoint
   * `durable/steer` (the `listDefinitions` precedent). See
   * {@link DurableEngineCore.steer}.
   * @param runId - run identity.
   * @param input - JSON-serializable follow-up input; validated by the SDK face.
   * @returns the assigned segment sequence (1-based).
   */
  @Remote('steer')
  async steer(runId: string, input: Json): Promise<number> {
    return (await this.coreOrFail()).steer(runId, input)
  }

  /**
   * Rerun a terminal top-level run (issue #57): a fresh row with the same
   * definition identity and input, chained to its source by attempt number
   * and `retried_from_run_id`, driven immediately. Served to the browser as
   * the Remote endpoint `durable/rerun` (the `listDefinitions` precedent).
   * See {@link DurableEngineCore.rerun}.
   * @param runId - source run identity.
   * @returns the new run's id.
   */
  @Remote('rerun')
  async rerun(runId: string): Promise<string> {
    return (await this.coreOrFail()).rerun(runId).id
  }

  /**
   * Request cancellation of an unfinished run (ticket #74): the terminal
   * `cancelled` row with the cause is written first, pending gates settle
   * cancelled, and a driver in this process aborts. Served to the browser as
   * the Remote endpoint `durable/cancel` (the `steer` precedent). Idempotent
   * on terminal runs — a run that already ended satisfies the request, and a
   * lingering driver still aborts — and loud on unknown runs. See
   * {@link DurableEngineCore.cancel}.
   * @param runId - run identity.
   * @param cause - human-readable cancel cause.
   */
  @Remote('cancel')
  async cancel(runId: string, cause?: string): Promise<void> {
    await (await this.coreOrFail()).cancel(runId, cause)
  }

  private async coreOrFail(): Promise<DurableEngineCore> {
    try {
      return await this.ready
    } catch (error) {
      throw new Error('durable engine failed to open its ledger', { cause: error })
    }
  }

  private shutdown(): void {
    this.core?.dispose()
    this.db?.close()
    this.core = undefined
    this.db = undefined
  }
}
