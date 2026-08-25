/**
 * The catalog's wire face: `durable/listDefinitions`, the Remote endpoint the
 * engine serves through the API gateway (spec 05 §5). The engine registry
 * stays the single fact source; this module only carries its read view across
 * the wire and validates the payload at that boundary — a malformed answer
 * (wrong build, hand-rolled impostor endpoint) fails loud into the page's
 * error state rather than painting a broken catalog.
 */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'

/**
 * One definition registry entry as it crosses the wire (the engine's
 * DefinitionView minus everything the catalog does not present). `display`
 * is an ABSENT key when the definition declares none — never undefined-valued.
 */
export interface WireDefinition {
  /** Definition family; the catalog presents agents only. */
  readonly kind: string
  /** Definition name; with version, the registry identity. */
  readonly name: string
  /** Definition version; with name, the registry identity. */
  readonly version: string
  /** Declared display metadata (business name + description). */
  readonly display?: {
    readonly title: string
    readonly description: string
  }
}

/** The catalog store's data dependency. */
export interface CatalogApi {
  /** @returns the registry's agent definitions in registration order. */
  listDefinitions(): Promise<WireDefinition[]>
}

/**
 * Validate one wire payload entry. Wire boundary: the Remote channel is
 * untyped at this call site, so the catalogue checks the fields it reads.
 * @param value - one raw entry of the endpoint's result array.
 * @returns the entry narrowed to {@link WireDefinition}.
 */
function parseEntry(value: unknown): WireDefinition {
  if (typeof value !== 'object' || value === null) throw new Error('ui-agents: definition entry is not an object')
  const entry = value as Record<string, unknown>
  if (typeof entry['kind'] !== 'string'
    || typeof entry['name'] !== 'string'
    || typeof entry['version'] !== 'string') {
    throw new Error('ui-agents: definition entry misses kind/name/version')
  }
  const display = entry['display']
  if (display === undefined) {
    return { kind: entry['kind'], name: entry['name'], version: entry['version'] }
  }
  if (typeof display !== 'object' || display === null) throw new Error('ui-agents: definition display is not an object')
  const { title, description } = display as Record<string, unknown>
  if (typeof title !== 'string' || typeof description !== 'string') {
    throw new Error('ui-agents: definition display misses title/description')
  }
  return { kind: entry['kind'], name: entry['name'], version: entry['version'], display: { title, description } }
}

/**
 * Build the catalog API over the connection's generic RPC channel: the
 * gateway claims `durable/listDefinitions` from the engine's Remote binding.
 * @param rpc - the connection's client RPC caller.
 * @returns the catalog's wire face.
 */
export function createCatalogApi(rpc: Pick<ClientConnectionRpc, 'call'>): CatalogApi {
  return {
    async listDefinitions() {
      const result = await rpc.call('/api', 'durable/listDefinitions', { args: {} })
      if (!result.ok) throw new Error(`ui-agents: durable/listDefinitions failed: ${result.error.message}`)
      if (!Array.isArray(result.value)) throw new Error('ui-agents: durable/listDefinitions answered a non-array')
      return (result.value as unknown[]).map(parseEntry)
    },
  }
}
