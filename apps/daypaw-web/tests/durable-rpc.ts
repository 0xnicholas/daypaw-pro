// The daypaw fork's `durable/*` fixture answers, held as a decorator
// transport over the upstream browser fixture (wayfinder #81 ruling 1,
// ticket #90): the decorator intercepts the engine's six Remote endpoints,
// owns the run ledger, journal, and definition-registry tables, and passes
// every other call and stream through to the wrapped fixture transport. The
// upstream `packages/client/connection/src/client/fixture.ts` keeps only the
// fx-world seed adjustments (the registered core touch); these answers live
// with the daypaw golden lanes that consume them.
//
// The `durable/startRun` arm drives the run's session twin through the
// fixture's public face — `session/create` registers the twin (sessionId ≡
// runId, the model default, and the `api-session/added` remote event) and
// `session/prompt` drives the first turn, whose first user message is the
// input's JSON serialization (ADR 0010) — so no fixture-internal state is
// reached. Failure answers carry the engine's `durable/*` failure vocabulary
// (`@daypaw/engine` `src/failures.ts`, ticket #86): codes and details match
// the engine's throw sites verbatim.
import type {
  ClientConnectionRpc,
  ConnectionRpcResult,
} from '@deepseek-ai/dsh-client-connection/client'

/** Wire mirror of the ledger's run row (`@daypaw/store` RunRow, snake_case as it crosses the gateway). */
interface DurableRunRow {
  run_id: string
  def_kind: 'workflow' | 'agent'
  def_name: string
  def_version: string
  input_json: string
  status: 'running' | 'waiting' | 'done' | 'failed' | 'cancelled'
  waiting_gate: string | null
  parent_run_id: string | null
  parent_step_key: string | null
  attempt: number
  retried_from_run_id: string | null
  output_json: string | null
  error_json: string | null
  cancel_cause: string | null
  claimed_by: string | null
  claimed_at: number | null
  created_at: number
  updated_at: number
  finished_at: number | null
}

/** Wire mirror of the ledger's journal row (`@daypaw/store` JournalRow). */
interface DurableJournalRow {
  run_id: string
  step_key: string
  name: string
  occurrence: number
  kind: 'step' | 'segment'
  status: 'started' | 'completed' | 'failed'
  value_json: string | null
  error_json: string | null
  attempt: number
  session_id: string | null
  session_seq: number | null
  started_at: number
  finished_at: number | null
}

/** One entry of the engine's definition registry view (`durable/listDefinitions`). */
interface DurableDefinition {
  readonly kind: 'agent' | 'workflow'
  readonly name: string
  readonly version: string
  readonly inputKind: 'text' | 'json' | null
  readonly display?: { readonly title: string; readonly description: string }
}

/** Fixed epoch (ms) anchoring every seeded ledger timestamp: goldens never see wall time. */
const FX_RUN_EPOCH = Date.UTC(2026, 7, 20, 9, 0, 0)
const FX_HOUR = 3_600_000

/** The endpoints this decorator owns; every other target passes through. */
const DURABLE_ENDPOINTS = new Set([
  'durable/listDefinitions',
  'durable/startRun',
  'durable/listRuns',
  'durable/runLineage',
  'durable/journalTimeline',
  'durable/rerun',
])

/**
 * Seed the run ledger the golden lanes join to the sessions list: the running
 * agent run's id aliases the fx-alpha session, and the failed top-level run
 * carries one failed child so its detail pane shows a subtask.
 */
function seedRuns(): DurableRunRow[] {
  return [
    {
      run_id: 'fx-alpha',
      def_kind: 'agent',
      def_name: 'weekly-report',
      def_version: '1.2.0',
      input_json: '{"objective":"Collect the week\'s updates from each team and draft the report."}',
      status: 'running',
      waiting_gate: null,
      parent_run_id: null,
      parent_step_key: null,
      attempt: 1,
      retried_from_run_id: null,
      output_json: null,
      error_json: null,
      cancel_cause: null,
      claimed_by: null,
      claimed_at: null,
      created_at: FX_RUN_EPOCH + 3 * FX_HOUR,
      updated_at: FX_RUN_EPOCH + 3 * FX_HOUR,
      finished_at: null,
    },
    {
      run_id: 'fx-run-invoice-audit:sub:1',
      def_kind: 'agent',
      def_name: 'invoice-checker',
      def_version: '0.3.1',
      input_json: '{"invoice":"INV-2044","scope":"line-items"}',
      status: 'failed',
      waiting_gate: null,
      parent_run_id: 'fx-run-invoice-audit',
      parent_step_key: 'audit-line-items',
      attempt: 1,
      retried_from_run_id: null,
      output_json: null,
      error_json: '{"message":"line item 7 does not match the purchase order"}',
      cancel_cause: null,
      claimed_by: null,
      claimed_at: null,
      created_at: FX_RUN_EPOCH + 2 * FX_HOUR + 60_000,
      updated_at: FX_RUN_EPOCH + 2 * FX_HOUR + 360_000,
      finished_at: FX_RUN_EPOCH + 2 * FX_HOUR + 360_000,
    },
    {
      run_id: 'fx-run-invoice-audit',
      def_kind: 'agent',
      def_name: 'invoice-checker',
      def_version: '0.3.1',
      input_json: '{"invoice":"INV-2044"}',
      status: 'failed',
      waiting_gate: null,
      parent_run_id: null,
      parent_step_key: null,
      attempt: 1,
      retried_from_run_id: null,
      output_json: null,
      error_json: '{"message":"audit-line-items failed: line item 7 does not match the purchase order"}',
      cancel_cause: null,
      claimed_by: null,
      claimed_at: null,
      created_at: FX_RUN_EPOCH + 2 * FX_HOUR,
      updated_at: FX_RUN_EPOCH + 2 * FX_HOUR + 420_000,
      finished_at: FX_RUN_EPOCH + 2 * FX_HOUR + 420_000,
    },
    {
      run_id: 'fx-run-release-digest',
      def_kind: 'workflow',
      def_name: 'release-digest',
      def_version: '0.4.0',
      input_json: '{"range":"v0.9.0..v0.10.0"}',
      status: 'done',
      waiting_gate: null,
      parent_run_id: null,
      parent_step_key: null,
      attempt: 1,
      retried_from_run_id: null,
      output_json: '{"summary":"Shipped the durable tasks board and two follow-up fixes.","count":3}',
      error_json: null,
      cancel_cause: null,
      claimed_by: null,
      claimed_at: null,
      created_at: FX_RUN_EPOCH + FX_HOUR,
      updated_at: FX_RUN_EPOCH + FX_HOUR + 540_000,
      finished_at: FX_RUN_EPOCH + FX_HOUR + 540_000,
    },
  ]
}

/** Journal steps of the done workflow run, in start order (the UI step timeline reads `name`). */
function seedJournal(): DurableJournalRow[] {
  return [
    {
      run_id: 'fx-run-release-digest',
      step_key: 'collect-updates',
      name: 'Collect team updates',
      occurrence: 0,
      kind: 'step',
      status: 'completed',
      value_json: '{"teams":4}',
      error_json: null,
      attempt: 1,
      session_id: null,
      session_seq: null,
      started_at: FX_RUN_EPOCH + FX_HOUR + 10_000,
      finished_at: FX_RUN_EPOCH + FX_HOUR + 70_000,
    },
    {
      run_id: 'fx-run-release-digest',
      step_key: 'draft-report',
      name: 'Draft the report',
      occurrence: 0,
      kind: 'step',
      status: 'completed',
      value_json: '{"sections":3}',
      error_json: null,
      attempt: 1,
      session_id: null,
      session_seq: null,
      started_at: FX_RUN_EPOCH + FX_HOUR + 80_000,
      finished_at: FX_RUN_EPOCH + FX_HOUR + 300_000,
    },
    {
      run_id: 'fx-run-release-digest',
      step_key: 'publish-summary',
      name: 'Publish the summary',
      occurrence: 0,
      kind: 'step',
      status: 'completed',
      value_json: '{"count":3}',
      error_json: null,
      attempt: 1,
      session_id: null,
      session_seq: null,
      started_at: FX_RUN_EPOCH + FX_HOUR + 310_000,
      finished_at: FX_RUN_EPOCH + FX_HOUR + 540_000,
    },
  ]
}

/**
 * The engine definition registry view (spec 05 §5) served at
 * `durable/listDefinitions` and validated by `durable/startRun`. The starter
 * agent leads (the CLI seeds it first-run) with the starter `{ task }` text
 * shape; one other entry carries display metadata and one does not, so the
 * dialog's technical-name fallback is exercisable. Static: the fixture has no
 * definition registration surface.
 */
const DURABLE_DEFINITIONS: readonly DurableDefinition[] = [
  { kind: 'agent', name: 'starter-assistant', version: '1.0.0', inputKind: 'text', display: { title: 'Starter assistant', description: 'The general-purpose assistant seeded at first setup; steerable and yours to edit.' } },
  { kind: 'agent', name: 'weekly-report', version: '1.2.0', inputKind: 'json', display: { title: 'Weekly report assistant', description: 'Collects the week\'s updates from each team and drafts the report.' } },
  { kind: 'agent', name: 'invoice-checker', version: '0.3.1', inputKind: 'json' },
]

function ok<T>(value: T): Promise<ConnectionRpcResult<T>> {
  return Promise.resolve({ ok: true, value })
}

function failure(
  code: string,
  message: string,
  details: object,
): Promise<ConnectionRpcResult<never>> {
  return Promise.resolve({ ok: false, error: { code, message, details } })
}

/**
 * Wrap the fixture transport with the fork's `durable/*` answers: the six
 * engine Remote endpoints resolve against decorator-owned ledger, journal,
 * and definition tables; every other endpoint and stream passes through
 * untouched. Each call mints a fresh table set, so repeated mounts (one
 * golden per test) never see earlier runs' appends.
 * @param base - the upstream fixture Connection transport.
 * @returns the decorated Connection transport.
 */
export function decorateDurableRpc(base: ClientConnectionRpc): ClientConnectionRpc {
  const openBase = base.open
  const runs = seedRuns()
  const journal = seedJournal()
  /** Rerun serial: fresh deterministic ids and timestamps newer than every seeded row. */
  let nextRerun = 1
  /** Serial for shell-started fixture runs (ids and ledger timestamps). */
  let nextStart = 1

  /**
   * Append the rerun row `durable/rerun` promises: a fresh running row
   * chaining the source's definition, input, and attempt (engine rerun
   * parallel).
   * @param source - the run row being retried.
   * @returns the appended row.
   */
  const appendRerun = (source: DurableRunRow): DurableRunRow => {
    const serial = nextRerun
    nextRerun++
    const createdAt = FX_RUN_EPOCH + 4 * FX_HOUR + serial * 60_000
    const rerun: DurableRunRow = {
      run_id: `fx-rerun-${serial}`,
      def_kind: source.def_kind,
      def_name: source.def_name,
      def_version: source.def_version,
      input_json: source.input_json,
      status: 'running',
      waiting_gate: null,
      parent_run_id: null,
      parent_step_key: null,
      attempt: source.attempt + 1,
      retried_from_run_id: source.run_id,
      output_json: null,
      error_json: null,
      cancel_cause: null,
      claimed_by: null,
      claimed_at: null,
      created_at: createdAt,
      updated_at: createdAt,
      finished_at: null,
    }
    runs.push(rerun)
    return rerun
  }

  /** Answer one owned `durable/*` endpoint against the decorator-owned tables. */
  const answer = (endpoint: string, payload: unknown, signal?: AbortSignal): Promise<ConnectionRpcResult<unknown>> => {
    const args = (payload as { args?: Record<string, unknown> }).args
    switch (endpoint) {
      case 'durable/listDefinitions': return ok(DURABLE_DEFINITIONS)
      // Mirrors the engine's startRun: resolve the registry identity (exact
      // version, or the name's unique entry), coerce the free-text input for
      // the starter `{ task }` shape, start-or-attach by run id, insert the
      // run row, and drive the session twin's first turn.
      case 'durable/startRun': {
        const request = (args?.['request'] ?? {}) as {
          defName?: string
          defVersion?: string
          input?: unknown
          runId?: string
        }
        const defName = request.defName
        const defVersion = request.defVersion
        const candidates = DURABLE_DEFINITIONS.filter(def => def.name === defName)
        const def = defVersion === undefined
          ? candidates.length === 1 ? candidates[0] : undefined
          : candidates.find(candidate => candidate.version === defVersion)
        if (def === undefined) {
          if (defVersion === undefined && candidates.length > 1) {
            const candidateList = candidates.map(candidate => `${candidate.kind}/${candidate.name}/${candidate.version}`)
            return failure(
              'durable/definition-ambiguous',
              `durable engine: definition ${String(defName)} is ambiguous across ${candidateList.join(', ')}; pass an exact version`,
              { defName, candidates: candidateList },
            )
          }
          return failure(
            'durable/definition-not-found',
            `durable engine: no registered definition matches ${defVersion === undefined ? String(defName) : `${defName}@${defVersion}`}`,
            defVersion === undefined ? { defName } : { defName, defVersion },
          )
        }
        const requestedRunId = request.runId
        const runId = typeof requestedRunId === 'string' && requestedRunId !== '' ? requestedRunId : `fx-run-start-${nextStart++}`
        // Start-or-attach: an existing run id answers without touching state.
        if (runs.some(row => row.run_id === runId)) {
          return ok({ runId })
        }
        const input = def.inputKind === 'text' && typeof request.input === 'string' ? { task: request.input } : request.input
        const createdAt = FX_RUN_EPOCH + 5 * FX_HOUR + nextStart * 60_000
        runs.push({
          run_id: runId,
          def_kind: def.kind,
          def_name: def.name,
          def_version: def.version,
          input_json: JSON.stringify(input),
          status: 'running',
          waiting_gate: null,
          parent_run_id: null,
          parent_step_key: null,
          attempt: 1,
          retried_from_run_id: null,
          output_json: null,
          error_json: null,
          cancel_cause: null,
          claimed_by: null,
          claimed_at: null,
          created_at: createdAt,
          updated_at: createdAt,
          finished_at: null,
        })
        // The engine creates the session (sessionId ≡ runId) on first drive,
        // so the twin is registered through the fixture's own session/create:
        // it owns the summary row, the model default, and the
        // `api-session/added` remote event.
        return base.call('/api', 'session/create', {
          args: { request: { sessionId: runId, cwd: '/tmp/fixture' } },
        }, signal).then((created) => {
          if (!created.ok) return created
          // First turn, driven as a queued prompt: the input's JSON
          // serialization lands as the first user message (ADR 0010). The
          // engine drives asynchronously, so the prompt is fired without
          // gating startRun's answer; the fixture prompt answers, never
          // rejects, so nothing is swallowed here.
          void base.call('/api', 'session/prompt', {
            args: {
              request: {
                requestId: `fx-durable-start-${runId}`,
                sessionId: runId,
                mode: 'queue',
                content: [{ type: 'text', text: JSON.stringify(input) }],
              },
            },
          })
          return ok({ runId })
        })
      }
      // The engine's run ledger query surface (rows keep the ledger's
      // snake_case shape; the browser polls unfiltered).
      case 'durable/listRuns': {
        const status = args?.['status'] as DurableRunRow['status'] | undefined
        const rows = runs.filter(row => status === undefined || row.status === status)
        return ok([...rows].sort((a, b) => b.created_at - a.created_at))
      }
      case 'durable/runLineage': {
        const runId = args?.['runId'] as string
        const run = runs.find(row => row.run_id === runId)
        return ok({
          run,
          parent: run?.parent_run_id == null ? undefined : runs.find(row => row.run_id === run.parent_run_id),
          children: runs.filter(row => row.parent_run_id === runId),
        })
      }
      case 'durable/journalTimeline': {
        const runId = args?.['runId'] as string
        return ok(journal.filter(row => row.run_id === runId))
      }
      case 'durable/rerun': {
        const runId = args?.['runId'] as string
        const source = runs.find(row => row.run_id === runId)
        if (source === undefined) {
          return failure(
            'durable/run-not-found',
            `durable engine: rerun targets unknown run ${runId}`,
            { runId },
          )
        }
        return ok(appendRerun(source).run_id)
      }
      default:
        return Promise.reject(new Error(`durable decorator: unowned endpoint ${JSON.stringify(endpoint)}`))
    }
  }

  return {
    call(channel, endpoint, payload, signal) {
      if (channel === '/api' && DURABLE_ENDPOINTS.has(endpoint)) {
        return answer(endpoint, payload, signal)
      }
      return base.call(channel, endpoint, payload, signal)
    },
    ...openBase === undefined ? {} : {
      open(channel, endpoint, payload, signal) {
        return openBase(channel, endpoint, payload, signal)
      },
    },
  }
}
