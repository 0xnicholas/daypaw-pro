/** Test-local programmable wire face: the durable endpoints the new-task dialog consumes. */
import type { WireAgentDefinition, WireStartRunRequest, NewTaskApi } from '../src/client/new-task-api.ts'

/** Local structural Remote result envelope. */
type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: unknown } }

/**
 * A successful Remote result.
 * @param value - the business value.
 * @returns the result envelope.
 */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

/**
 * A business-failure Remote result.
 * @param message - the failure text the surface must show.
 * @returns the result envelope.
 */
export function fail<T>(message: string): Result<T> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** One raw registry entry the endpoint may serve (the dialog keeps agents only). */
export interface FakeDefinition extends WireAgentDefinition {
  /** Definition family; the dialog offers agents only. */
  readonly kind: 'agent' | 'workflow'
}

/**
 * One definition row with the fields the dialog never reads defaulted.
 * @param name - definition name.
 * @param extra - field overrides (version/display/inputKind/kind).
 * @returns the wire row.
 */
export function definition(name: string, extra: Partial<FakeDefinition> = {}): FakeDefinition {
  return { kind: 'agent', name, version: '1', inputKind: 'text', ...extra }
}

/**
 * Programmable fake covering the dialog's wire endpoints. Handlers return
 * local structural values with the envelope bridged by assertion (the
 * settings FakeHostApi precedent).
 */
export class FakeTaskApi implements NewTaskApi {
  /** Chronological call record: [method, payload]. */
  readonly calls: { method: string; payload: unknown }[] = []

  onListDefinitions: () => Promise<Result<readonly FakeDefinition[]>> =
    () => Promise.resolve(ok([]))

  onStartRun: (request: WireStartRunRequest) => Promise<Result<{ runId: string }>> =
    request => Promise.resolve(ok({ runId: request.runId }))

  async listDefinitions(): Promise<readonly WireAgentDefinition[]> {
    this.calls.push({ method: 'durable/listDefinitions', payload: undefined })
    const result = await this.onListDefinitions()
    if (!result.ok) throw new Error(result.error.message)
    return result.value.filter(entry => entry.kind === 'agent')
  }

  async startRun(request: WireStartRunRequest): Promise<{ runId: string }> {
    this.calls.push({ method: 'durable/startRun', payload: request })
    const result = await this.onStartRun(request)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  /**
   * Every payload recorded for one method, in call order.
   * @param method - the wire method name.
   * @returns the payload list.
   */
  callsOf(method: string): unknown[] {
    return this.calls.filter(call => call.method === method).map(call => call.payload)
  }
}
