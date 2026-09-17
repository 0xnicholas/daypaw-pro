/**
 * The durable wire vocabulary (spec 05 §5): hand-declared types for the
 * payloads the engine's `durable/*` Remote endpoints exchange with the
 * browser, plus the one fail-loud parser per row kind. The declarations are
 * written here, not aliased from `@daypaw/engine` — an independent
 * declaration is exactly the object the wire-boundary check validates, and
 * drift between the engine's serialization and this vocabulary is caught by
 * the live-gateway proof in `@daypaw/web-app`'s wire-contract spec, not by a
 * type alias that can never disagree. Rows project to camelCase over exactly
 * the fields the browser planes read; every field read here is validated so
 * a malformed answer (wrong build, hand-rolled impostor endpoint) fails loud
 * at the boundary instead of painting a broken surface.
 */

/** Durable run status as it crosses the wire (`runs.status`). */
export type WireRunStatus = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled'

/** Durable run kind as it crosses the wire (`runs.def_kind`). */
export type WireRunDefKind = 'workflow' | 'agent'

/** One run as the browser planes read it (the engine's RunRow projected to camelCase). */
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

/** One journal step as the detail views read it (the engine's JournalRow projected to camelCase). */
export interface WireJournalEntry {
  /** Idempotent execution unit identity within the run. */
  readonly stepKey: string
  /** Step display name. */
  readonly name: string
  /** 0-based occurrence of the step name within its scope (re-calls and retries advance it; the default step key is `name#occurrence`). */
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

/** One definition registry entry as it crosses the wire (the engine's DefinitionView). */
export interface WireDefinition {
  /** Definition family; the catalog presents agents only. */
  readonly kind: WireRunDefKind
  /** Definition name; with version, the registry identity. */
  readonly name: string
  /** Definition version; with name, the registry identity. */
  readonly version: string
  /** Declared display metadata; the key is absent when the definition declares none. */
  readonly display?: {
    readonly title: string
    readonly description: string
  }
  /** Dialog input presentation: free text for the starter shapes, JSON otherwise; null without a wire face. */
  readonly inputKind: 'text' | 'json' | null
}

/** One browser-initiated run start (the engine's StartRunRequest over the wire). */
export interface WireStartRunRequest {
  /** Definition name; the registry identity with the version. */
  readonly defName: string
  /** Exact definition version; the roster row always pins one. */
  readonly defVersion: string
  /** Run input: the free-text string for text kinds, the parsed JSON value otherwise. */
  readonly input: unknown
  /** Persistent run identity the dialog minted; an existing id attaches instead of starting. */
  readonly runId: string
}

const DEF_KINDS: readonly WireRunDefKind[] = ['workflow', 'agent']
const RUN_STATUSES: readonly WireRunStatus[] = ['running', 'waiting', 'done', 'failed', 'cancelled']
const JOURNAL_KINDS: readonly WireJournalEntry['kind'][] = ['step', 'segment']
const JOURNAL_STATUSES: readonly WireJournalEntry['status'][] = ['started', 'completed', 'failed']
const INPUT_KINDS: readonly WireDefinition['inputKind'][] = ['text', 'json', null]

/** Wire boundary: the Remote channel is untyped at this call site.
 * @param value - one raw payload fragment.
 * @param what - what the fragment is (for the error message).
 * @returns the fragment narrowed to a plain record.
 */
export function asWireRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`durable-client: ${what} is not an object`)
  return value as Record<string, unknown>
}

/**
 * Validate one wire run row, projecting the fields the browser planes read.
 * @param value - one raw `runs` row (or lineage member).
 * @returns the row narrowed to {@link WireRun}.
 */
export function parseWireRun(value: unknown): WireRun {
  const row = asWireRecord(value, 'run row')
  if (typeof row['run_id'] !== 'string') throw new Error('durable-client: run row misses run_id')
  if (typeof row['def_name'] !== 'string') throw new Error('durable-client: run row misses def_name')
  const defKind = row['def_kind']
  if (!DEF_KINDS.includes(defKind as WireRunDefKind)) throw new Error('durable-client: run row carries an unknown def_kind')
  const status = row['status']
  if (!RUN_STATUSES.includes(status as WireRunStatus)) throw new Error('durable-client: run row carries an unknown status')
  const parentRunId = row['parent_run_id']
  if (typeof parentRunId !== 'string' && parentRunId !== null) throw new Error('durable-client: run row carries a bad parent_run_id')
  const outputJson = row['output_json']
  if (typeof outputJson !== 'string' && outputJson !== null) throw new Error('durable-client: run row carries a bad output_json')
  if (typeof row['updated_at'] !== 'number') throw new Error('durable-client: run row misses updated_at')
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
 * Validate one wire journal row, projecting the fields the detail views read.
 * @param value - one raw `journal` row.
 * @returns the row narrowed to {@link WireJournalEntry}.
 */
export function parseWireJournalEntry(value: unknown): WireJournalEntry {
  const row = asWireRecord(value, 'journal entry')
  if (typeof row['step_key'] !== 'string' || typeof row['name'] !== 'string') {
    throw new Error('durable-client: journal entry misses step_key/name')
  }
  if (typeof row['occurrence'] !== 'number') throw new Error('durable-client: journal entry misses occurrence')
  const kind = row['kind']
  if (!JOURNAL_KINDS.includes(kind as WireJournalEntry['kind'])) throw new Error('durable-client: journal entry carries an unknown kind')
  const status = row['status']
  if (!JOURNAL_STATUSES.includes(status as WireJournalEntry['status'])) throw new Error('durable-client: journal entry carries an unknown status')
  const sessionId = row['session_id']
  if (typeof sessionId !== 'string' && sessionId !== null) throw new Error('durable-client: journal entry carries a bad session_id')
  if (typeof row['started_at'] !== 'number') throw new Error('durable-client: journal entry misses started_at')
  const finishedAt = row['finished_at']
  if (typeof finishedAt !== 'number' && finishedAt !== null) throw new Error('durable-client: journal entry carries a bad finished_at')
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

/**
 * Validate one wire registry entry.
 * @param value - one raw entry of the endpoint's result array.
 * @returns the entry narrowed to {@link WireDefinition}.
 */
export function parseWireDefinition(value: unknown): WireDefinition {
  const row = asWireRecord(value, 'definition entry')
  const kind = row['kind']
  if (!DEF_KINDS.includes(kind as WireRunDefKind)) throw new Error('durable-client: definition entry carries an unknown kind')
  if (typeof row['name'] !== 'string' || typeof row['version'] !== 'string') {
    throw new Error('durable-client: definition entry misses name/version')
  }
  const inputKind = row['inputKind']
  if (!INPUT_KINDS.includes(inputKind as WireDefinition['inputKind'])) {
    throw new Error('durable-client: definition entry carries an unknown inputKind')
  }
  // Absent over JSON: the engine omits `display` when the definition
  // declares none; a present key must carry the full metadata pair.
  if (!('display' in row) || row['display'] === undefined) {
    return { kind: kind as WireRunDefKind, name: row['name'], version: row['version'], inputKind: inputKind as WireDefinition['inputKind'] }
  }
  const display = asWireRecord(row['display'], 'definition display')
  const title = display['title']
  const description = display['description']
  if (typeof title !== 'string' || typeof description !== 'string') {
    throw new Error('durable-client: definition display misses title/description')
  }
  return { kind: kind as WireRunDefKind, name: row['name'], version: row['version'], display: { title, description }, inputKind: inputKind as WireDefinition['inputKind'] }
}

/** Absent over JSON: the engine's `undefined` members arrive as null or missing keys.
 * @param value - one raw optional lineage member.
 * @returns the member narrowed to {@link WireRun}, or undefined when absent.
 */
export function parseOptionalWireRun(value: unknown): WireRun | undefined {
  return value === undefined || value === null ? undefined : parseWireRun(value)
}
