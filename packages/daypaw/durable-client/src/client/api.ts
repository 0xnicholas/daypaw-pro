/**
 * The browser planes' single client face over the engine's Remote endpoints
 * (spec 05 §5): the seven `durable/*` calls the daypaw shell consumes today,
 * behind one interface with one `{ args }` envelope, one ok/error unwrap, and
 * the fail-loud wire parsers. The engine ledger stays the single fact source;
 * this module only carries its read view and the start/steer verbs across
 * the wire. Serialization drift between the engine and this vocabulary is
 * proven out by `@daypaw/web-app`'s live-gateway wire-contract spec.
 */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import {
  asWireRecord,
  parseOptionalWireRun,
  parseWireDefinition,
  parseWireJournalEntry,
  parseWireRun,
  type WireDefinition,
  type WireJournalEntry,
  type WireGateSettlement,
  type WireRun,
  type WireRunLineage,
  type WireStartRunRequest,
} from './wire.ts'

/** The browser planes' whole durable data dependency (the seven consumed endpoints). */
export interface DurableClient {
  /** @returns every ledger run, newest activity order owned by the projection. */
  listRuns(): Promise<readonly WireRun[]>
  /**
   * @param runId - run identity.
   * @returns the run's own row, its parent, and its direct children.
   */
  runLineage(runId: string): Promise<WireRunLineage>
  /**
   * @param runId - run identity.
   * @returns the run's journal steps in start order.
   */
  journalTimeline(runId: string): Promise<readonly WireJournalEntry[]>
  /**
   * @param runId - run identity of the failed run to retry.
   * @returns the new run's identity.
   */
  rerun(runId: string): Promise<string>
  /** @returns the registry's definitions in registration order. */
  listDefinitions(): Promise<readonly WireDefinition[]>
  /**
   * Start (or attach to) one run.
   * @param request - pinned definition identity, input, and the dialog-minted run id.
   * @returns the run id (the request's own when it attached).
   */
  startRun(request: WireStartRunRequest): Promise<{ readonly runId: string }>
  /**
   * Append one free-text follow-up segment to an unfinished steerable run;
   * the boundary applies the definition's wire face to the bare text.
   * @param runId - run identity.
   * @param text - free-text follow-up; the definition's wire face owns the starter shape.
   * @returns the assigned segment sequence (1-based).
   */
  steerText(runId: string, text: string): Promise<number>
  /**
   * Settle one pending gate (ticket #128): approve with a value the gate's
   * contract validates, or reject with a reason. The browser plane is ADR
   * 0002 §3's Manager UI entry, so the host records `'manager'` as the
   * resolution source.
   * @param runId - run identity.
   * @param gate - gate name.
   * @param settlement - the caller's settlement.
   * @returns whether this call won the settlement; false means the gate was
   *   already settled (a timeout, another answer, or a cancellation).
   */
  resolveGate(runId: string, gate: string, settlement: WireGateSettlement): Promise<boolean>
}

/**
 * Unwrap one endpoint call's RPC result, failing loud with the endpoint name
 * and the wire failure code.
 * @param rpc - the connection's client RPC caller.
 * @param endpoint - the Remote endpoint called (for the error message).
 * @param payload - the `{ args }` envelope the gateway's unary dispatch expects.
 * @returns the success payload.
 */
async function callEndpoint(rpc: Pick<ClientConnectionRpc, 'call'>, endpoint: string, payload: unknown): Promise<unknown> {
  const result = await rpc.call('/api', endpoint, payload)
  if (!result.ok) throw new Error(`durable-client: ${endpoint} failed (${result.error.code}): ${result.error.message}`)
  return result.value
}

/**
 * Build the durable client over the connection's generic RPC channel: the
 * gateway claims the `durable/*` endpoints from the engine's Remote binding.
 * @param rpc - the connection's client RPC caller.
 * @returns the browser planes' durable wire face.
 */
export function createDurableClient(rpc: Pick<ClientConnectionRpc, 'call'>): DurableClient {
  return {
    async listRuns() {
      const value = await callEndpoint(rpc, 'durable/listRuns', { args: {} })
      if (!Array.isArray(value)) throw new Error('durable-client: durable/listRuns answered a non-array')
      return (value as unknown[]).map(parseWireRun)
    },
    async runLineage(runId) {
      const value = await callEndpoint(rpc, 'durable/runLineage', { args: { runId } })
      const lineage = asWireRecord(value, 'durable/runLineage payload')
      if (!Array.isArray(lineage['children'])) throw new Error('durable-client: durable/runLineage children is a non-array')
      return {
        run: parseOptionalWireRun(lineage['run']),
        parent: parseOptionalWireRun(lineage['parent']),
        children: (lineage['children'] as unknown[]).map(parseWireRun),
      }
    },
    async journalTimeline(runId) {
      const value = await callEndpoint(rpc, 'durable/journalTimeline', { args: { runId } })
      if (!Array.isArray(value)) throw new Error('durable-client: durable/journalTimeline answered a non-array')
      return (value as unknown[]).map(parseWireJournalEntry)
    },
    async rerun(runId) {
      const value = await callEndpoint(rpc, 'durable/rerun', { args: { runId } })
      if (typeof value !== 'string') throw new Error('durable-client: durable/rerun answered a non-string run id')
      return value
    },
    async listDefinitions() {
      const value = await callEndpoint(rpc, 'durable/listDefinitions', { args: {} })
      if (!Array.isArray(value)) throw new Error('durable-client: durable/listDefinitions answered a non-array')
      return (value as unknown[]).map(parseWireDefinition)
    },
    async startRun(request) {
      const value = await callEndpoint(rpc, 'durable/startRun', { args: { request } })
      const answer = asWireRecord(value, 'durable/startRun answer')
      if (typeof answer['runId'] !== 'string') throw new Error('durable-client: durable/startRun answered no run id')
      return { runId: answer['runId'] }
    },
    async steerText(runId, text) {
      const value = await callEndpoint(rpc, 'durable/steerText', { args: { runId, text } })
      if (typeof value !== 'number') throw new Error('durable-client: durable/steerText answered a non-number segment ordinal')
      return value
    },
    async resolveGate(runId, gate, settlement) {
      const value = await callEndpoint(rpc, 'durable/resolveGate', { args: { runId, gate, settlement } })
      if (typeof value !== 'boolean') throw new Error('durable-client: durable/resolveGate answered a non-boolean settlement')
      return value
    },
  }
}
