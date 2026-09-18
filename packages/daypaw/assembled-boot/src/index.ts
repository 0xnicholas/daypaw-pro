// The assembled jsdom lane: per-test environment and mount over the bundle
// composition, parameterized by the lane's bundle layers, transport carrier,
// and pinned document title. Both web snapshot lanes (the upstream apps/web
// e2e lane and the fork's apps/daypaw-web golden lane) boot their real built
// rosters through this module, differing only in the lane options.
import { join } from 'node:path'
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import type { ClientConnectionRpc, ClientRequest, ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import { bootInjections } from '@deepseek-ai/dsh-client-modules'
import type { ClientModuleLoaderTarget, WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { buildBootGraph, buildBundleTable, loadAssembledPlugins } from './composition.ts'
import type { AssembledBundleLayer, AssembledPlugin } from './composition.ts'

/** Composition changes applied to one mount. */
export interface AssembledBootOptions {
  /** Package ids omitted from this mounted composition. */
  readonly exclude?: readonly string[]
}

/** Lane facts: which roster to boot and how the page reaches the fixture transport. */
export interface AssembledBootLaneOptions {
  /** Top bundle layer layered over the lane's base layer. */
  readonly webBundle: AssembledBundleLayer
  /** Base bundle layer; defaults to the repo's `packages/bundle/base` layer. */
  readonly baseBundle?: AssembledBundleLayer
  /** Document title pinned before each boot. */
  readonly documentTitle: string
  /**
   * Carrier hooks installed as `__DSH_TRANSPORT__` per mount, bridging the
   * page onto a Connection transport. When omitted, the page self-selects the
   * fixture Connection transport through the `?fixture` search switch.
   */
  readonly carrier?: () => ClientTransportHooks
}

/** One web snapshot lane's environment and mount surface. */
export interface AssembledBootLane {
  /** Register the per-test jsdom setup and teardown (call once per spec file, at import). */
  readonly installAssembledBootEnv: () => void
  /**
   * Mount the assembled application; the teardown registered by
   * `installAssembledBootEnv` disposes it.
   * @param search - query string selecting deterministic host behavior;
   * defaults to `'?fixture'` on carrier-less lanes and `''` on carrier lanes
   * (which reject the `fixture` key: the fixture rides the carrier hooks).
   * @param options - composition changes applied to this mount.
   */
  readonly mountAssembledApp: (search?: string, options?: AssembledBootOptions) => void
}

interface FixtureWindow extends Window {
  __DSH_BOOT__?: WebBootGraph
  __ModuleLoader__?: ClientModuleLoaderTarget
  __DSH_TRANSPORT__?: ClientTransportHooks
}

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

class EventSourceStub {
  addEventListener(): void {}
  close(): void {}
}

const win = window as FixtureWindow
let unmount: (() => Promise<void>) | undefined

/**
 * Bridge a Connection transport onto the connection plugin's carrier-override
 * hooks: unary calls cross the real ClientRequest/ServerResponse envelope the
 * web caller builds, and streams delegate to the transport's in-process opens.
 * @param rpc - the Connection transport the page's calls bridge onto.
 * @returns transport hooks installing that transport as the page's carrier.
 */
export function connectionRpcCarrier(rpc: ClientConnectionRpc): ClientTransportHooks {
  return {
    async fetch(input, init) {
      const endpoint = decodeURIComponent(input.pathname.replace(/^\/api\//, ''))
      // The web caller always posts one JSON-stringified ClientRequest; a
      // non-string body can only come from a foreign caller on this carrier.
      if (typeof init.body !== 'string') {
        throw new Error(`fixture transport: non-string request body for ${endpoint}`)
      }
      const body = JSON.parse(init.body) as ClientRequest
      const result = await rpc.call('/api', endpoint, body.payload, init.signal ?? undefined)
      return new Response(
        JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
    openStream(endpoint, payload, signal) {
      const stream = rpc.open?.('/api', endpoint, payload, signal)
      if (stream === undefined) {
        throw new Error(`fixture transport: stream endpoint ${JSON.stringify(endpoint)} is unavailable`)
      }
      return stream
    },
  }
}

/**
 * Create one lane's boot surface from its options.
 * @param options - the lane's bundle layers, carrier, and pinned title.
 * @returns the lane's `installAssembledBootEnv` / `mountAssembledApp` pair.
 */
export async function createAssembledBootLane(options: AssembledBootLaneOptions): Promise<AssembledBootLane> {
  const baseLayer: AssembledBundleLayer = options.baseBundle ?? {
    manifest: join(process.cwd(), 'packages/bundle/base/package.json'),
    patch: join(process.cwd(), 'packages/bundle/base/cordis.patch.yml'),
  }
  const plugins = await loadAssembledPlugins([baseLayer, options.webBundle])
  const defaultSearch = options.carrier === undefined ? '?fixture' : ''
  return {
    installAssembledBootEnv: () => {
      installAssembledBootEnv(options.documentTitle)
    },
    mountAssembledApp: (search = defaultSearch, mountOptions: AssembledBootOptions = {}) => {
      mountAssembledApp(plugins, options.carrier, search, mountOptions)
    },
  }
}

/**
 * Register the per-test jsdom setup and teardown the assembled boot needs:
 * English pinned before boot so role/text locators and goldens stay
 * deterministic across localized component migrations (both lanes' goldens
 * render the English dictionary), the observers and frame callbacks jsdom
 * lacks, and a full reset of the document, the boot globals, and the injected
 * plugin styles afterwards.
 * @param documentTitle - title pinned before each boot and cleared after.
 */
function installAssembledBootEnv(documentTitle: string): void {
  beforeEach(() => {
    // jsdom implements no scroll geometry: menus that reveal a highlight
    // with scrollIntoView need the method to exist. Re-checked per test so a
    // native implementation and the shim coexist across environments.
    if (typeof Element.prototype.scrollIntoView !== 'function') {
      Element.prototype.scrollIntoView = () => {}
    }
    // jsdom implements no Range geometry either: Lexical's selection reveal
    // measures the caret with one after a programmatic edit settles focus.
    if (typeof Range.prototype.getBoundingClientRect !== 'function') {
      Range.prototype.getBoundingClientRect = () => ({
        top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
      })
    }
    localStorage.clear()
    // The locale service derives its provisional locale from the browser and
    // takes an explicit choice only from Host settings, which the fixture
    // transport does not serve; pinning the navigator is what selects the
    // dictionary.
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    document.title = documentTitle
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('EventSource', EventSourceStub)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => { callback(0) }, 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { clearTimeout(id) })
  })

  afterEach(async () => {
    await act(async () => { await unmount?.() })
    unmount = undefined
    cleanup()
    delete win.__DSH_BOOT__
    delete win.__ModuleLoader__
    delete win.__DSH_TRANSPORT__
    document.body.innerHTML = ''
    document.head.querySelectorAll('style[data-plugin]').forEach((style) => { style.remove() })
    document.title = ''
    history.replaceState(null, '', '/')
    // Deleting the own properties uncovers jsdom's own accessors again
    // (Navigator declares both readonly, hence the erased receiver).
    const ownNavigator = navigator as unknown as Record<string, unknown>
    delete ownNavigator.languages
    delete ownNavigator.language
    vi.unstubAllGlobals()
  })
}

/**
 * Mount the assembled application on the lane's transport; the teardown
 * registered by `installAssembledBootEnv` disposes it.
 * @param plugins - the lane's plugin rows, in module-graph order.
 * @param carrier - the lane's carrier hooks factory, when the lane bridges its transport.
 * @param search - query string selecting deterministic host behavior.
 * @param options - composition changes applied to this mount.
 */
function mountAssembledApp(
  plugins: readonly AssembledPlugin[],
  carrier: (() => ClientTransportHooks) | undefined,
  search: string,
  options: AssembledBootOptions,
): void {
  if (carrier !== undefined && new URLSearchParams(search).has('fixture')) {
    throw new Error('assembled boot: the fixture rides the __DSH_TRANSPORT__ carrier hooks; remove the ?fixture switch')
  }
  const excluded = new Set(options.exclude)
  const mounted = plugins.filter(plugin => !excluded.has(plugin.id))
  history.replaceState(null, '', `/${search}`)
  // The carrier's transport is minted per mount after the search is in place,
  // so its option switches apply and later mounts never see earlier appends.
  if (carrier !== undefined) {
    win.__DSH_TRANSPORT__ = carrier()
  }
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  const graph = buildBootGraph(mounted)
  const bundles = buildBundleTable(graph, mounted)
  win.__DSH_BOOT__ = graph
  const [facadeRow] = bootInjections(win.__DSH_BOOT__)
  /* v8 ignore next -- bootInjections on a graph always leads with the facade row */
  if (facadeRow?.kind !== 'script') throw new Error('missing injected ModuleLoader facade row')
  ;(0, eval)(facadeRow.text)
  // Mirror the blocking Host-injected bootstrap batch before the Vite entry calls create().
  const bootstrapUrl = graph.batches.find(batch => batch.phase === 'bootstrap')?.url
  const bootstrap = bootstrapUrl === undefined ? undefined : bundles.get(bootstrapUrl)
  /* v8 ignore next 2 -- a graph with a bootstrap batch always tables its body */
  if (bootstrap === undefined) throw new Error('missing parser-preloaded fixture batch')
  ;(0, eval)(bootstrap)
  act(() => {
    const entry = new AppWebEntry(root, {
      // The ModuleLoader contract takes a promise; the eval is synchronous,
      // so the loader answers with an already-settled one.
      loadBundle: (url) => {
        const code = bundles.get(url)
        /* v8 ignore next -- every URL the graph names is tabled by buildBundleTable above */
        if (code === undefined) throw new Error(`missing built bundle ${url}`)
        ;(0, eval)(code)
        return Promise.resolve()
      },
    })
    void entry.run()
    unmount = () => entry.dispose()
  })
}

/**
 * Match a CSS-module class by its logical name.
 * Module class names carry a per-build hash in one of two schemes —
 * ui-primitives emits `_<name>_<hash>` (name bounded by underscores),
 * feature bundles emit `<hash>_<name>` (name at the end) — and a longer name
 * containing this one must not match (`line` must not hit `lineNumber`).
 * @param el - element whose class list is inspected.
 * @param name - logical (unhashed) module class name.
 * @returns whether the element carries that module class.
 */
export function hasClass(el: Element, name: string): boolean {
  return [...el.classList].some(cls => cls === name || cls.endsWith(`_${name}`) || cls.startsWith(`_${name}_`) || cls.includes(`_${name}_`))
}

/**
 * Whether this run rewrites its golden instead of comparing against it, set by
 * the snapshot gate's `DSH_SNAPSHOT` mode (`record` re-runs the scenarios from
 * scratch, `refresh` re-derives the expected text from the existing ones).
 */
export const REFRESHING_GOLDEN = process.env.DSH_SNAPSHOT === 'record' || process.env.DSH_SNAPSHOT === 'refresh'
