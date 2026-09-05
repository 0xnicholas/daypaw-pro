/**
 * The inbox board's wire face: `durable/listRuns`, `durable/runLineage`,
 * `durable/journalTimeline`, and `durable/rerun` — the Remote endpoints the
 * engine serves through the API gateway (the `durable/listDefinitions`
 * precedent in ui-agents). The engine ledger stays the single fact source;
 * this module only carries its read view across the wire and validates every
 * field it reads at that boundary — a malformed answer (wrong build,
 * hand-rolled impostor endpoint) fails loud into the board's error state
 * rather than painting a broken inbox. Wire rows are the engine's snake_case
 * `RunRow`/`JournalRow` JSON; this module owns the camelCase projection.
 */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'

/** Durable run status as it crosses the wire (`runs.status`). */
export type WireRunStatus = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled'

/**
 * Whether a wire run status is unfinished — the one partition every
 * client-side plane agrees on (the board's running/done grouping, the
 * conversation seat's follow-up liveness).
 * @param status - the wire run status to test.
 * @returns whether the run may still consume a steer segment.
 */
export function isUnfinishedWireRun(status: WireRunStatus): boolean {
  return status === 'running' || status === 'waiting'
}

/** Durable run kind as it crosses the wire (`runs.def_kind`). */
export type WireRunDefKind = 'workflow' | 'agent'

/** One run as the board reads it (the engine's RunRow projected to camelCase). */
export interface WireRun {
  /** Run identity; for an agent run this IS the session identity. */
  readonly runId: string
  /** Definition family: workflow runs have no session, agent runs do. */
  readonly defKind: WireRunDefKind
  /** Definition name (the run row's fallback title). */
  readonly defName: string
  /** Durable run status. */
  readonly status: WireRunStatus
  /** Parent run identity; null for a top-level run (only top-level runs list on the board). */
  readonly parentRunId: string | null
  /** Serialized run output (`runs.output_json`); null until the run settles with one. */
  readonly outputJson: string | null
  /** Last activity timestamp (epoch ms; the board's merge-order key). */
  readonly updatedAt: number
}

/** One run's parent/child lineage (the engine's RunLineage over the wire). */
export interface WireRunLineage {
  /** The run's own row; undefined when the runId is unknown. */
  readonly run: WireRun | undefined
  /** The parent run row; undefined for a top-level run or an absent parent row. */
  readonly parent: WireRun | undefined
  /** Direct children, oldest first. */
  readonly children: readonly WireRun[]
}

/** One journal step as the detail view reads it (the engine's JournalRow projected to camelCase). */
export interface WireJournalEntry {
  /** Idempotent execution unit identity within the run. */
  readonly stepKey: string
  /** Step display name. */
  readonly name: string
  /** 1-based occurrence of the step key (retries re-run a key). */
  readonly occurrence: number
  /** `step` is an execution unit; `segment` is a steer segment boundary fact. */
  readonly kind: 'step' | 'segment'
  /** Journal step status. */
  readonly status: 'started' | 'completed' | 'failed'
  /** The step's session identity when it drove one (agent steps only). */
  readonly sessionId: string | null
  /** Step start timestamp (epoch ms). */
  readonly startedAt: number
  /** Step finish timestamp (epoch ms); null while the step runs. */
  readonly finishedAt: number | null
}

/** The board and detail stores' data dependency. */
export interface RunsApi {
  /** @returns every ledger run, newest activity order owned by the projection. */
  listRuns(): Promise<WireRun[]>
  /**
   * @param runId - run identity.
   * @returns the run's own row, its parent, and its direct children.
   */
  runLineage(runId: string): Promise<WireRunLineage>
  /**
   * @param runId - run identity.
   * @returns the run's journal steps in start order.
   */
  journalTimeline(runId: string): Promise<WireJournalEntry[]>
  /**
   * @param runId - run identity of the failed run to retry.
   * @returns the new run's identity.
   */
  rerun(runId: string): Promise<string>
}

const DEF_KINDS: readonly WireRunDefKind[] = ['workflow', 'agent']
const RUN_STATUSES: readonly WireRunStatus[] = ['running', 'waiting', 'done', 'failed', 'cancelled']
const JOURNAL_KINDS: readonly WireJournalEntry['kind'][] = ['step', 'segment']
const JOURNAL_STATUSES: readonly WireJournalEntry['status'][] = ['started', 'completed', 'failed']

/** Wire boundary: the Remote channel is untyped at this call site. */
function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`ui-inbox: ${what} is not an object`)
  return value as Record<string, unknown>
}

/**
 * Validate one wire run row, projecting the fields the board reads.
 * @param value - one raw `runs` row (or lineage member).
 * @returns the row narrowed to {@link WireRun}.
 */
function parseRun(value: unknown): WireRun {
  const row = asRecord(value, 'run row')
  if (typeof row['run_id'] !== 'string') throw new Error('ui-inbox: run row misses run_id')
  if (typeof row['def_name'] !== 'string') throw new Error('ui-inbox: run row misses def_name')
  const defKind = row['def_kind']
  if (!DEF_KINDS.includes(defKind as WireRunDefKind)) throw new Error('ui-inbox: run row carries an unknown def_kind')
  const status = row['status']
  if (!RUN_STATUSES.includes(status as WireRunStatus)) throw new Error('ui-inbox: run row carries an unknown status')
  const parentRunId = row['parent_run_id']
  if (typeof parentRunId !== 'string' && parentRunId !== null) throw new Error('ui-inbox: run row carries a bad parent_run_id')
  const outputJson = row['output_json']
  if (typeof outputJson !== 'string' && outputJson !== null) throw new Error('ui-inbox: run row carries a bad output_json')
  if (typeof row['updated_at'] !== 'number') throw new Error('ui-inbox: run row misses updated_at')
  return {
    runId: row['run_id'],
    defKind: defKind as WireRunDefKind,
    defName: row['def_name'],
    status: status as WireRunStatus,
    parentRunId,
    outputJson,
    updatedAt: row['updated_at'],
  }
}

/**
 * Validate one wire journal row, projecting the fields the detail view reads.
 * @param value - one raw `journal` row.
 * @returns the row narrowed to {@link WireJournalEntry}.
 */
function parseJournalEntry(value: unknown): WireJournalEntry {
  const row = asRecord(value, 'journal entry')
  if (typeof row['step_key'] !== 'string' || typeof row['name'] !== 'string') {
    throw new Error('ui-inbox: journal entry misses step_key/name')
  }
  if (typeof row['occurrence'] !== 'number') throw new Error('ui-inbox: journal entry misses occurrence')
  const kind = row['kind']
  if (!JOURNAL_KINDS.includes(kind as WireJournalEntry['kind'])) throw new Error('ui-inbox: journal entry carries an unknown kind')
  const status = row['status']
  if (!JOURNAL_STATUSES.includes(status as WireJournalEntry['status'])) throw new Error('ui-inbox: journal entry carries an unknown status')
  const sessionId = row['session_id']
  if (typeof sessionId !== 'string' && sessionId !== null) throw new Error('ui-inbox: journal entry carries a bad session_id')
  if (typeof row['started_at'] !== 'number') throw new Error('ui-inbox: journal entry misses started_at')
  const finishedAt = row['finished_at']
  if (typeof finishedAt !== 'number' && finishedAt !== null) throw new Error('ui-inbox: journal entry carries a bad finished_at')
  return {
    stepKey: row['step_key'],
    name: row['name'],
    occurrence: row['occurrence'],
    kind: kind as WireJournalEntry['kind'],
    status: status as WireJournalEntry['status'],
    sessionId,
    startedAt: row['started_at'],
    finishedAt,
  }
}

/** Absent over JSON: the engine's `undefined` members arrive as null or missing keys. */
function parseOptionalRun(value: unknown): WireRun | undefined {
  return value === undefined || value === null ? undefined : parseRun(value)
}

/**
 * Unwrap one endpoint call's RPC result, failing loud with the endpoint name
 * and the wire failure code.
 * @param endpoint - the Remote endpoint called (for the error message).
 * @param result - the raw RPC result.
 * @returns the success payload.
 */
async function callEndpoint(rpc: Pick<ClientConnectionRpc, 'call'>, endpoint: string, payload: unknown): Promise<unknown> {
  const result = await rpc.call('/api', endpoint, payload)
  if (!result.ok) throw new Error(`ui-inbox: ${endpoint} failed (${result.error.code}): ${result.error.message}`)
  return result.value
}

/**
 * Build the runs API over the connection's generic RPC channel: the gateway
 * claims the `durable/*` endpoints from the engine's Remote binding.
 * @param rpc - the connection's client RPC caller.
 * @returns the board's wire face.
 */
export function createRunsApi(rpc: Pick<ClientConnectionRpc, 'call'>): RunsApi {
  return {
    async listRuns() {
      const value = await callEndpoint(rpc, 'durable/listRuns', { args: {} })
      if (!Array.isArray(value)) throw new Error('ui-inbox: durable/listRuns answered a non-array')
      return (value as unknown[]).map(parseRun)
    },
    async runLineage(runId) {
      const value = await callEndpoint(rpc, 'durable/runLineage', { args: { runId } })
      const lineage = asRecord(value, 'durable/runLineage payload')
      if (!Array.isArray(lineage['children'])) throw new Error('ui-inbox: durable/runLineage children is a non-array')
      return {
        run: parseOptionalRun(lineage['run']),
        parent: parseOptionalRun(lineage['parent']),
        children: (lineage['children'] as unknown[]).map(parseRun),
      }
    },
    async journalTimeline(runId) {
      const value = await callEndpoint(rpc, 'durable/journalTimeline', { args: { runId } })
      if (!Array.isArray(value)) throw new Error('ui-inbox: durable/journalTimeline answered a non-array')
      return (value as unknown[]).map(parseJournalEntry)
    },
    async rerun(runId) {
      const value = await callEndpoint(rpc, 'durable/rerun', { args: { runId } })
      if (typeof value !== 'string') throw new Error('ui-inbox: durable/rerun answered a non-string run id')
      return value
    },
  }
}
