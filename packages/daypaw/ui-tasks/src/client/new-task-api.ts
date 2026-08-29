/**
 * The new-task dialog's wire face: `durable/listDefinitions` and
 * `durable/startRun` — the Remote endpoints the engine serves through the
 * API gateway (ruling #65, ADR 0012; the `durable/listDefinitions` precedent
 * in ui-agents). The engine registry stays the single fact source; this
 * module carries the roster and the start request across the wire and
 * validates the payloads at that boundary — a malformed answer (wrong build,
 * hand-rolled impostor endpoint) fails loud into the dialog's error state
 * rather than offering a broken roster.
 */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'

/**
 * One agent definition as the dialog reads it (the engine's DefinitionView
 * minus the fields the dialog does not present). `display` is an ABSENT key
 * when the definition declares none — never undefined-valued.
 */
export interface WireAgentDefinition {
  /** Definition name; with version, the registry identity. */
  readonly name: string
  /** Definition version; with name, the registry identity. */
  readonly version: string
  /** Declared display metadata (the dialog's business name). */
  readonly display?: {
    readonly title: string
  }
  /** Input presentation: free text for the starter shapes, JSON otherwise; null without a wire face. */
  readonly inputKind: 'text' | 'json' | null
}

/** The dialog's start request over the wire (the engine's StartRunRequest). */
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

/** The dialog's data dependency. */
export interface NewTaskApi {
  /** @returns the registry's agent definitions in registration order. */
  listDefinitions(): Promise<readonly WireAgentDefinition[]>
  /**
   * Start (or attach to) one run.
   * @param request - pinned definition identity, input, and the dialog-minted run id.
   * @returns the run id (the request's own when it attached).
   */
  startRun(request: WireStartRunRequest): Promise<{ runId: string }>
}

/**
 * Validate one wire roster entry. Wire boundary: the Remote channel is
 * untyped at this call site, so the dialog checks the fields it reads.
 * @param value - one raw entry of the endpoint's result array.
 * @returns the entry narrowed to {@link WireAgentDefinition}, or undefined
 *   for a non-agent definition (the dialog starts conversation tasks only).
 */
function parseAgentEntry(value: unknown): WireAgentDefinition | undefined {
  if (typeof value !== 'object' || value === null) throw new Error('ui-tasks: definition entry is not an object')
  const entry = value as Record<string, unknown>
  if (entry['kind'] !== 'agent') return undefined
  const name = entry['name']
  const version = entry['version']
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new Error('ui-tasks: definition entry misses name/version')
  }
  const inputKind = entry['inputKind']
  if (inputKind !== 'text' && inputKind !== 'json' && inputKind !== null) {
    throw new Error('ui-tasks: definition entry carries an unknown inputKind')
  }
  const display = entry['display']
  if (display === undefined) {
    return { name, version, inputKind }
  }
  const title = typeof display === 'object' && display !== null ? (display as Record<string, unknown>)['title'] : undefined
  if (typeof title !== 'string') throw new Error('ui-tasks: definition display misses title')
  return { name, version, display: { title }, inputKind }
}

/**
 * Unwrap one endpoint call's RPC result, failing loud with the endpoint name.
 * @param endpoint - the Remote endpoint called (for the error message).
 * @param result - the raw RPC result.
 * @returns the success payload.
 */
async function callEndpoint(rpc: Pick<ClientConnectionRpc, 'call'>, endpoint: string, payload: unknown): Promise<unknown> {
  const result = await rpc.call('/api', endpoint, payload)
  if (!result.ok) throw new Error(`ui-tasks: ${endpoint} failed: ${result.error.message}`)
  return result.value
}

/**
 * Build the dialog API over the connection's generic RPC channel: the
 * gateway claims the `durable/*` endpoints from the engine's Remote binding.
 * @param rpc - the connection's client RPC caller.
 * @returns the dialog's wire face.
 */
export function createNewTaskApi(rpc: Pick<ClientConnectionRpc, 'call'>): NewTaskApi {
  return {
    async listDefinitions() {
      const value = await callEndpoint(rpc, 'durable/listDefinitions', { args: {} })
      if (!Array.isArray(value)) throw new Error('ui-tasks: durable/listDefinitions answered a non-array')
      const agents: WireAgentDefinition[] = []
      for (const entry of value as unknown[]) {
        const agent = parseAgentEntry(entry)
        if (agent !== undefined) agents.push(agent)
      }
      return agents
    },
    async startRun(request) {
      const value = await callEndpoint(rpc, 'durable/startRun', { args: request })
      if (typeof value !== 'object' || value === null) throw new Error('ui-tasks: durable/startRun answered no run id')
      const runId = (value as Record<string, unknown>)['runId']
      if (typeof runId !== 'string') throw new Error('ui-tasks: durable/startRun answered no run id')
      return { runId }
    },
  }
}
