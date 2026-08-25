/**
 * The inbox run stores: RunsBoardStore polls the engine ledger's run list for
 * the board columns, TaskDetailStore loads the selected run's lineage and
 * journal timeline for the right column. Both are apply-closure snapshot
 * stores handed to the registrations through the inject hooks compartments
 * (the CatalogStore precedent in ui-agents); the host stays the single fact
 * source and any wire failure lands in the store's error status.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { RunsApi, WireJournalEntry, WireRun, WireRunLineage } from './runs-api.ts'

/**
 * Board refresh cadence (ms). The browser boot graph (WebBootEntry) carries
 * no per-plugin config channel, so this cadence is a product constant, not a
 * deployment tunable.
 */
export const RUNS_BOARD_POLL_MS = 2_000

/** Injectable interval driver so unit tests own the poll clock. */
export interface RunsBoardTimers {
  /** Defaults to the platform `setInterval`. */
  readonly setIntervalFn?: (fn: () => void, ms: number) => unknown
  /** Defaults to the platform `clearInterval`. */
  readonly clearIntervalFn?: (timer: unknown) => void
}

/** RunsBoardStore construction share. */
export interface RunsBoardStoreDeps extends RunsBoardTimers {
  /** The wire face (durable/listRuns). */
  readonly api: RunsApi
  /** Poll cadence; defaults to {@link RUNS_BOARD_POLL_MS}. */
  readonly intervalMs?: number
}

/** Board snapshot. */
export interface RunsBoardState {
  /** Board load lifecycle; idle until start(), error after a failed fetch (the poll keeps running). */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Every ledger run from the latest successful fetch. */
  runs: readonly WireRun[]
}

/** The inbox board poll controller (one per apply). */
export class RunsBoardStore {
  /** The snapshot the nav and workspace render from (uSES-safe store). */
  readonly store: SnapshotStore<RunsBoardState> = createSnapshotStore<RunsBoardState>({ status: 'idle', runs: [] })

  /** Latest fetch wins; an older response never overwrites a newer one. */
  private generation = 0
  /** The live interval timer; undefined while stopped. */
  private timer: unknown

  private readonly intervalMs: number
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown
  private readonly clearIntervalFn: (timer: unknown) => void

  /**
   * @param deps - the wire face plus the optional cadence and interval driver.
   */
  constructor(private readonly deps: RunsBoardStoreDeps) {
    this.intervalMs = deps.intervalMs ?? RUNS_BOARD_POLL_MS
    this.setIntervalFn = deps.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms))
    this.clearIntervalFn = deps.clearIntervalFn ?? ((timer) => { clearInterval(timer as never) })
  }

  /** Start the board: an immediate fetch, then the poll. */
  start(): void {
    void this.fetch()
    this.timer = this.setIntervalFn(() => { void this.fetch() }, this.intervalMs)
  }

  /** Stop the poll (teardown). */
  stop(): void {
    this.clearIntervalFn(this.timer)
    this.timer = undefined
  }

  /**
   * Force an out-of-band refetch (the retry dispatcher's board kick); safe
   * without start().
   * @returns nothing; the snapshot carries the outcome.
   */
  async refresh(): Promise<void> {
    await this.fetch()
  }

  /** One generation-guarded fetch. */
  private async fetch(): Promise<void> {
    const generation = ++this.generation
    if (this.store.getSnapshot().status !== 'ready') this.store.update((s) => { s.status = 'loading' })
    try {
      const runs = await this.deps.api.listRuns()
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.runs = runs
      })
    } catch {
      if (generation !== this.generation) return
      // Any wire or payload failure reads as the same generic inline failure;
      // raw host wording never reaches the page, and the poll keeps running.
      this.store.update((s) => { s.status = 'error' })
    }
  }
}

/** TaskDetailStore construction share. */
export interface TaskDetailStoreDeps {
  /** The wire face (durable/runLineage + durable/journalTimeline). */
  readonly api: RunsApi
}

/** Detail-column snapshot. */
export interface TaskDetailState {
  /** The run the detail column is bound to; undefined renders the empty state. */
  runId: string | undefined
  /** Detail load lifecycle; idle with no selection, error after a failed fetch. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** The selected run's lineage (present on ready). */
  lineage: WireRunLineage | undefined
  /** The selected run's journal timeline (present on ready). */
  timeline: readonly WireJournalEntry[] | undefined
}

const IDLE_DETAIL: TaskDetailState = { runId: undefined, status: 'idle', lineage: undefined, timeline: undefined }

/** The task-detail controller (one per apply). */
export class TaskDetailStore {
  /** The snapshot the detail column renders from (uSES-safe store). */
  readonly store: SnapshotStore<TaskDetailState> = createSnapshotStore<TaskDetailState>(IDLE_DETAIL)

  /** Latest selection wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param deps - the wire face.
   */
  constructor(private readonly deps: TaskDetailStoreDeps) {}

  /**
   * Bind the detail column to a run (or clear it). Selection changes drive
   * this from the apply closure, never from inside the store. A same-run
   * refresh keeps the ready data on screen (no loading flicker); a run switch
   * clears the previous run's lineage/timeline immediately so the column
   * never shows one run's data under another's identity.
   * @param runId - the run to load, or undefined to clear.
   * @returns nothing; the snapshot carries the outcome.
   */
  async select(runId: string | undefined): Promise<void> {
    const generation = ++this.generation
    if (runId === undefined) {
      this.store.set(IDLE_DETAIL)
      return
    }
    const sameRun = this.store.getSnapshot().runId === runId
    this.store.update((s) => {
      s.runId = runId
      if (!(sameRun && s.status === 'ready')) s.status = 'loading'
      if (!sameRun) {
        s.lineage = undefined
        s.timeline = undefined
      }
    })
    try {
      const [lineage, timeline] = await Promise.all([
        this.deps.api.runLineage(runId),
        this.deps.api.journalTimeline(runId),
      ])
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.lineage = lineage
        s.timeline = timeline
      })
    } catch {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.lineage = undefined
        s.timeline = undefined
      })
    }
  }

  /**
   * Re-fetch the current selection (wired to board ticks in apply); a no-op
   * with no selection.
   * @returns nothing; the snapshot carries the outcome.
   */
  async refresh(): Promise<void> {
    const runId = this.store.getSnapshot().runId
    if (runId === undefined) return
    await this.select(runId)
  }
}
