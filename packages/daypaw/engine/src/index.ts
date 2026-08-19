/**
 * The durable engine Cordis service (`ctx.durable`): definition registry,
 * run lifecycle, step-dedup re-drive, single-writer claims, and boot-scan
 * revival over the SQLite ledger (spec: docs/spec/01-durable-execution.md,
 * programming face docs/spec/02-agent-engine-sdk.md). Load this plugin in a
 * Cordis composition; `@daypaw/sdk` is the typed facade applications call.
 * @module @daypaw/engine
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { openLedgerDatabase } from '@daypaw/store'
import type { DatabaseSync } from 'node:sqlite'
import { DurableEngineCore } from './core.ts'
import type { EngineDefinition, EngineRunHandle, EngineRunOptions } from './core.ts'
import { SqliteJournalStore } from './sqlite-journal-store.ts'

export { DurableEngineCore, EngineRunError } from './core.ts'
export type {
  EngineDefinition, EngineRunErrorCode, EngineRunHandle, EngineRunOptions,
  EngineRunStatus, EngineStepCtx, EngineStepOptions,
} from './core.ts'
export { SqliteJournalStore } from './sqlite-journal-store.ts'
export type {
  JournalStepInsert, JournalStore, RunFinalize, RunInsert,
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
 * runs stay revivable by the next process.
 */
export default class DurableEngine extends Service {
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
