/** Test-local programmable wire face: the durable endpoints the task surfaces consume. */
import type { DurableClient, WireDefinition, WireJournalEntry, WireRun, WireStartRunRequest } from '@daypaw/durable-client/client'

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

/** One definition row with the fields the dialog never reads defaulted.
 * @param name - definition name.
 * @param extra - field overrides (version/display/inputKind/kind).
 * @returns the wire row.
 */
export function definition(name: string, extra: Partial<WireDefinition> = {}): WireDefinition {
  return { kind: 'agent', name, version: '1', inputKind: 'text', ...extra }
}

/**
 * Programmable fake covering the task surfaces' wire endpoints. Handlers
 * return local structural values with the envelope bridged by assertion (the
 * settings FakeHostApi precedent). Implements the single `DurableClient`
 * interface; the board/read endpoints answer an empty ledger unless a test
 * programs them.
 */
export class FakeTaskApi implements DurableClient {
  /** Chronological call record: [method, payload]. */
  readonly calls: { method: string; payload: unknown }[] = []

  onListDefinitions: () => Promise<Result<readonly WireDefinition[]>> =
    () => Promise.resolve(ok([]))

  onStartRun: (request: WireStartRunRequest) => Promise<Result<{ runId: string }>> =
    request => Promise.resolve(ok({ runId: request.runId }))

  onSteerText: (runId: string, text: string) => Promise<Result<number>> =
    () => Promise.resolve(ok(1))

  async listDefinitions(): Promise<readonly WireDefinition[]> {
    this.calls.push({ method: 'durable/listDefinitions', payload: undefined })
    const result = await this.onListDefinitions()
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  async startRun(request: WireStartRunRequest): Promise<{ readonly runId: string }> {
    this.calls.push({ method: 'durable/startRun', payload: request })
    const result = await this.onStartRun(request)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  async steerText(runId: string, text: string): Promise<number> {
    this.calls.push({ method: 'durable/steerText', payload: { runId, text } })
    const result = await this.onSteerText(runId, text)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  async listRuns(): Promise<readonly WireRun[]> {
    this.calls.push({ method: 'durable/listRuns', payload: undefined })
    return []
  }

  async runLineage(): Promise<{ run: WireRun | undefined; parent: WireRun | undefined; children: readonly WireRun[] }> {
    this.calls.push({ method: 'durable/runLineage', payload: undefined })
    return { run: undefined, parent: undefined, children: [] }
  }

  async journalTimeline(): Promise<readonly WireJournalEntry[]> {
    this.calls.push({ method: 'durable/journalTimeline', payload: undefined })
    return []
  }

  async rerun(): Promise<string> {
    this.calls.push({ method: 'durable/rerun', payload: undefined })
    return 'rerun-1'
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
