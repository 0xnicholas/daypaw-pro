/** Test-local programmable wire face: the agentPresets namespace + session create the new-task dialog consumes. */
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NewTaskApi } from '../src/client/new-task-store.ts'

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

/** One preset wire row. */
export interface FakePreset {
  id: string
  trust: 'system' | 'user'
  isDefault: boolean
  name?: string
  broken?: string
}

/**
 * One preset row with the fields the dialog never reads defaulted.
 * @param id - preset id.
 * @param extra - field overrides (name/broken/isDefault…).
 * @returns the wire row.
 */
export function preset(id: string, extra: Partial<FakePreset> = {}): FakePreset {
  return { id, trust: 'system', isDefault: false, ...extra }
}

type PresetsNamespace = Pick<ClientRemote['agentPresets'], 'list' | 'select'>

/**
 * Programmable fake covering the dialog's wire domains. Namespace members are
 * the real generated slices; programmable handlers return local structural
 * values with the envelope bridged by assertion (the settings FakeHostApi
 * precedent).
 */
export class FakeTaskApi implements NewTaskApi {
  /** Chronological call record: [method, payload]. */
  readonly calls: { method: string; payload: unknown }[] = []

  onPresetList: () => Promise<Result<{ presets: readonly FakePreset[]; authorable: boolean }>> =
    () => Promise.resolve(ok({ presets: [], authorable: false }))
  onCreateSession: () => Promise<Result<SessionId>> =
    () => Promise.resolve(ok('fx-new' as SessionId))
  onSelect: (sessionId: string, agentPreset: string) => Promise<Result<unknown>> =
    (_sessionId, agentPreset) => Promise.resolve(ok({ agentPreset }))

  readonly agentPresets: PresetsNamespace = {
    list: (() => this.record('agentPresets.list', undefined, this.onPresetList())) as PresetsNamespace['list'],
    select: ((sessionId: string, agentPreset: string) =>
      this.record('agentPresets.select', { sessionId, agentPreset }, this.onSelect(sessionId, agentPreset))) as PresetsNamespace['select'],
  }

  readonly createSession: () => Promise<SessionId> =
    () => this.record('session.create', undefined, this.onCreateSession()).then((result) => {
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    })

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
