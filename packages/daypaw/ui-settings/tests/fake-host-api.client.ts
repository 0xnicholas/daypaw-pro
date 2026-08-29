/** Test-local programmable wire face: the Client Remote namespaces the settings page and first-run banner read or write. */
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'

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

/** Local structural Remote result envelope (bridged onto the generated slices by assertion). */
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: unknown } }

/**
 * A successful Remote result.
 * @param value - the business value.
 * @returns the result envelope.
 */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

/**
 * A business-failure Remote result (the host answered; the answer is no).
 * @param message - the failure text the surface must show.
 * @returns the result envelope.
 */
export function fail<T>(message: string): Result<T> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** One engine-registry row the roster endpoint serves. */
export interface FakeDefinitionRow {
  kind: 'agent' | 'workflow'
  name: string
  version?: string
  display?: { title: string }
}

/** One provider directory row. */
export interface FakeProviderInfo {
  id: string
  name: string
}

/** One credential state row. */
export interface FakeCredentialInfo {
  configured: boolean
  writable: boolean
}

/** The model-catalog snapshot (the About tab reads its default selection). */
export interface FakeModelCatalog {
  default: { provider: string; model: string }
  routableProviders: readonly string[]
  groups: readonly { id: string; name: string; models: readonly { id: string; name: string }[] }[]
  failures: readonly { id: string; name: string; message: string }[]
}

type CredentialsNamespace = Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'>
type LlmNamespace = Pick<ClientRemote['llm'], 'listProviders'>
type SessionNamespace = Pick<ClientRemote['session'], 'modelCatalog'>

/**
 * Programmable fake covering the credentials/llm/session Remote namespaces
 * and the engine-roster RPC the settings stores consume. Namespace members
 * are typed as the real generated slices (assignability is the point under
 * test); each routes through a programmable handler returning a local
 * structural value, with the envelope bridged by assertion — the generated
 * result types are nominal over identical shapes.
 */
export class FakeHostApi {
  /** Chronological call record: [method, payload]. */
  readonly calls: { method: string; payload: unknown }[] = []

  onListDefinitions: () => Promise<Result<readonly FakeDefinitionRow[]>> =
    () => Promise.resolve(ok([]))
  onModelCatalog: () => Promise<Result<FakeModelCatalog>> =
    () => Promise.resolve(ok({ default: { provider: 'deepseek', model: 'deepseek-chat' }, routableProviders: [], groups: [], failures: [] }))
  onDescribeCredentials: (refs: readonly string[]) => Promise<Result<Record<string, FakeCredentialInfo>>> =
    () => Promise.resolve(ok({}))
  onSet: (ref: string, value: string) => Promise<Result<void>> =
    () => Promise.resolve(ok(undefined))
  onUnset: (ref: string) => Promise<Result<void>> =
    () => Promise.resolve(ok(undefined))
  onListProviders: () => Promise<Result<readonly FakeProviderInfo[]>> =
    () => Promise.resolve(ok([]))

  /** The connection's generic RPC channel over the engine-roster endpoint. */
  readonly rpc: Pick<ClientConnectionRpc, 'call'> = {
    call: (_channel, endpoint, _payload) => {
      if (endpoint === 'durable/listDefinitions') {
        return this.record('durable/listDefinitions', undefined, this.onListDefinitions()) as ReturnType<ClientConnectionRpc['call']>
      }
      return Promise.resolve(fail(`unexpected ${endpoint}`)) as ReturnType<ClientConnectionRpc['call']>
    },
  }

  readonly credentials: CredentialsNamespace = {
    describe: ((refs: readonly string[]) =>
      this.record('credentials.describe', [...refs], this.onDescribeCredentials([...refs]))) as CredentialsNamespace['describe'],
    set: ((ref: string, value: string) =>
      this.record('credentials.set', { ref, value }, this.onSet(ref, value))) as CredentialsNamespace['set'],
    unset: ((ref: string) =>
      this.record('credentials.unset', { ref }, this.onUnset(ref))) as CredentialsNamespace['unset'],
  }

  readonly llm: LlmNamespace = {
    listProviders: (() =>
      this.record('llm.listProviders', undefined, this.onListProviders())) as LlmNamespace['listProviders'],
  }

  readonly session: SessionNamespace = {
    modelCatalog: (() =>
      this.record('session.modelCatalog', undefined, this.onModelCatalog())) as SessionNamespace['modelCatalog'],
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
