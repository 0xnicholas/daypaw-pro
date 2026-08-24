/** Test-local programmable wire face: the agentPresets + sessions.create domains the new-task dialog consumes. */
import type { IApiClient, RpcResponse, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { NewTaskApi } from '../src/client/new-task-store.ts'

let nextRpc = 0

/**
 * A successful unary response.
 * @param value - the business value.
 * @returns the response envelope.
 */
export function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `fake-${nextRpc++}` as never, result: { ok: true, value } }
}

/**
 * A business-failure unary response (the host answered; the answer is no).
 * @param message - the failure text the surface must show.
 * @returns the response envelope.
 */
export function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: `fake-${nextRpc++}` as never, result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

/** The response value of agentPreset.list, derived from the wire face (the entry type is not re-exported). */
type PresetListValue = Awaited<ReturnType<IApiClient['agentPresets']['list']>> extends RpcResponse<infer V> ? V : never

/** One preset wire row. */
type PresetEntry = PresetListValue['presets'][number]

/** One preset row with the fields the dialog never reads defaulted.
 * @param id - preset id.
 * @param extra - field overrides (name/broken/isDefault…).
 * @returns the wire row.
 */
export function preset(id: string, extra: Partial<PresetEntry> = {}): PresetEntry {
  return { id, trust: 'system', isDefault: false, ...extra }
}

// Parameter annotations below are local structural types on purpose (the CI
// lint lane runs without built artifacts, where wire types resolve to any and
// inferred params trip no-unsafe-argument) — the settings package's
// FakeHostApi sets the precedent.
/** Programmable fake covering the two domains the dialog consumes. */
export class FakeTaskApi implements NewTaskApi {
  /** Chronological call record: [method, payload]. */
  readonly calls: { method: string; payload: unknown }[] = []

  onPresetList: () => Promise<RpcResponse<PresetListValue>> =
    () => Promise.resolve(ok({ presets: [], authorable: false, hasDocument: false }))
  onCreate: (payload: { agentPreset?: string }) => Promise<RpcResponse<{ sessionId: SessionId }>> =
    () => Promise.resolve(ok({ sessionId: 'fx-new' as SessionId }))

  readonly agentPresets: NewTaskApi['agentPresets'] = {
    list: () => this.record('agentPreset.list', {}, this.onPresetList()),
    select: (payload: { agentPreset: string }) =>
      this.record('agentPreset.select', payload, Promise.resolve(ok({ agentPreset: payload.agentPreset }))),
    read: (payload: { agentPreset: string }) =>
      this.record('agentPreset.read', payload, Promise.resolve(ok({ agentPreset: payload.agentPreset, trust: 'user' as const, content: '' }))),
    copy: (payload: { agentPreset: string }) =>
      this.record('agentPreset.copy', payload, Promise.resolve(ok({ agentPreset: payload.agentPreset }))),
    openDocument: (payload: { agentPreset: string }) =>
      this.record('agentPreset.openDocument', payload, Promise.resolve(ok({ opened: true as const }))),
    remove: (payload: { agentPreset: string }) =>
      this.record('agentPreset.remove', payload, Promise.resolve(ok({}))),
  }

  readonly sessions: NewTaskApi['sessions'] = {
    create: (payload: { agentPreset?: string }) => this.record('session.create', payload, this.onCreate(payload)),
  }

  /**
   * Every payload recorded for one method, in call order.
   * @param method - the wire method name.
   * @returns the payload list.
   */
  callsOf(method: string): unknown[] {
    return this.calls.filter(call => call.method === method).map(call => call.payload)
  }

  private record<T>(method: string, payload: unknown, response: Promise<T>): Promise<T> {
    this.calls.push({ method, payload })
    return response
  }
}
