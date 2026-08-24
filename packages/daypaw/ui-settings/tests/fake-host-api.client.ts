/** Test-local programmable wire face: the four domains the settings page and first-run banner read or write. */
import type {
  ConfigurableProviderView, CredentialView, IApiClient, RpcResponse,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { HostDescription } from '@deepseek-ai/dsh-client-connection/client'

/** Test-held settlement: the case decides when an RPC lands (generation-guard material). */
export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

/**
 * Park an RPC response until the case settles it.
 * @returns the deferred handle.
 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let nextRpc = 0

/**
 * A successful unary response.
 * @param value - the business value.
 * @returns the response envelope.
 */
export function ok<T>(value: T): RpcResponse<T> {
  // No value import of RpcId: a tests-glob file lives in the host tsconfig
  // program, and a wire-face value import would drag the client source tree in.
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

/**
 * One configurable-provider directory row with the fields this page never reads defaulted.
 * @param provider - provider route id.
 * @param displayName - human-readable name (defaults to the route id).
 * @returns the wire row.
 */
export function providerView(provider: string, displayName = provider): ConfigurableProviderView {
  return { provider, displayName, settingsNs: 'llm', settingsPath: [], active: true }
}

/** The response value of agentPreset.list, derived from the wire face (the entry type is not re-exported). */
type PresetListValue = Awaited<ReturnType<IApiClient['agentPresets']['list']>> extends RpcResponse<infer V> ? V : never

// Parameter annotations below are local structural types on purpose (the CI
// lint lane runs without built artifacts, where IApiClient's wire types
// resolve to any and inferred params trip no-unsafe-argument) — the connection
// package's FakeApiClient sets the precedent. The unused-domain handlers exist
// so the fake satisfies the full domain interfaces the stores type against.
/** Programmable fake covering the agentPresets/host/credentials/llm domains the stores consume. */
export class FakeHostApi implements Pick<IApiClient, 'agentPresets' | 'host' | 'credentials' | 'llm'> {
  /** Chronological call record: [method, payload]. */
  readonly calls: { method: string; payload: unknown }[] = []

  onPresetList: (payload: unknown) => Promise<RpcResponse<PresetListValue>> =
    () => Promise.resolve(ok({ presets: [], authorable: false, hasDocument: false }))
  onHostDescribe: (payload: unknown) => Promise<RpcResponse<HostDescription>> =
    () => Promise.resolve(ok<HostDescription>({ version: '0-fake', cwd: '/f', attachedSessions: 0, canOpenPath: true }))
  onDescribeCredentials: (payload: { refs: string[] }) => Promise<RpcResponse<{ credentials: Record<string, CredentialView> }>> =
    () => Promise.resolve(ok({ credentials: {} }))
  onSet: (payload: { ref: string; value: string }) => Promise<RpcResponse<object>> =
    () => Promise.resolve(ok({}))
  onUnset: (payload: { ref: string }) => Promise<RpcResponse<object>> =
    () => Promise.resolve(ok({}))
  onProviders: (payload: unknown) => Promise<RpcResponse<{ providers: ConfigurableProviderView[] }>> =
    () => Promise.resolve(ok({ providers: [] }))

  readonly agentPresets: Pick<IApiClient, 'agentPresets'>['agentPresets'] = {
    list: (payload: unknown) => this.record('agentPreset.list', payload, this.onPresetList(payload)),
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

  readonly host: Pick<IApiClient, 'host'>['host'] = {
    describe: (payload: unknown) => this.record('host.describe', payload, this.onHostDescribe(payload)),
    pickDirectory: (payload: unknown) => this.record('host.pickDirectory', payload, Promise.resolve(ok({ path: null }))),
    listDirectory: (payload: unknown) =>
      this.record('host.listDirectory', payload, Promise.resolve(ok({ path: '/f', home: '/f', crumbs: [], entries: [], truncated: false }))),
    createDirectory: (payload: unknown) => this.record('host.createDirectory', payload, Promise.resolve(ok({ path: '/f/new' }))),
    openPath: (payload: unknown) => this.record('host.openPath', payload, Promise.resolve(ok({ opened: true as const }))),
  }

  readonly credentials: Pick<IApiClient, 'credentials'>['credentials'] = {
    describe: (payload: { refs: string[] }) => this.record('credentials.describe', payload, this.onDescribeCredentials(payload)),
    set: (payload: { ref: string; value: string }) => this.record('credentials.set', payload, this.onSet(payload)),
    unset: (payload: { ref: string }) => this.record('credentials.unset', payload, this.onUnset(payload)),
  }

  readonly llm: Pick<IApiClient, 'llm'>['llm'] = {
    providers: (payload: unknown) => this.record('llm.providers', payload, this.onProviders(payload)),
    models: (payload: unknown) => this.record('llm.models', payload, Promise.resolve(ok({ groups: [], failures: [] }))),
    discoverModels: (payload: unknown) => this.record('llm.discoverModels', payload, Promise.resolve(ok({ models: [] }))),
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
