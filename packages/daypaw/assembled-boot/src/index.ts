// The assembled jsdom lane: per-test environment and mount over the bundle
// composition, parameterized by the lane's bundle layers, remote scenario,
// and pinned document title. Both web snapshot lanes (the upstream apps/web
// e2e lane and the fork's apps/daypaw-web golden lane) boot their real built
// rosters through this module, differing only in the lane options.
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { bootInjections } from '@deepseek-ai/dsh-client-modules'
import type { ClientModuleLoaderTarget } from '@deepseek-ai/dsh-client-modules/client'
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { join } from 'node:path'
import { buildBootGraph, buildBundleTable, loadAssembledPlugins } from './composition.ts'
import type { AssembledBundleLayer, AssembledPlugin } from './composition.ts'

/** The mock face a mounted remote scenario owes the lane's transport and teardown. */
export interface AssembledRemoteMockFace {
  readonly rpc: ClientConnectionRpc
  assertNoUnmatched(): void
}

/**
 * A mounted remote-scenario world. The scenario's mock is the fake server the
 * page talks to; `rpc` overrides the transport installed as the page's carrier
 * (the fork's lane wraps the mock's rpc with its `durable/*` decorator).
 */
export interface AssembledRemoteWorld {
  readonly mock: AssembledRemoteMockFace
  /** Carrier transport installed as `__DSH_TRANSPORT__`; defaults to the mock's rpc. */
  readonly rpc?: ClientConnectionRpc
}

/** Composition changes applied to one mount. */
export interface AssembledBootOptions<TRemote = unknown> {
  /** Package ids omitted from this mounted composition. */
  readonly exclude?: readonly string[]
  /** Per-mount payload forwarded to the lane's remote-scenario factory. */
  readonly remote?: TRemote
}

/** Lane facts: which roster to boot, which remote world serves it, and the pinned title. */
export interface AssembledBootLaneOptions<TRemote = unknown> {
  /** Top bundle layer layered over the lane's base layer. */
  readonly webBundle: AssembledBundleLayer
  /** Base bundle layer; defaults to the repo's `packages/bundle/base` layer. */
  readonly baseBundle?: AssembledBundleLayer
  /** Document title pinned before each boot. */
  readonly documentTitle: string
  /**
   * Remote-scenario factory minting one world per mount from the mount's
   * remote payload; the teardown registered by `installAssembledBootEnv`
   * asserts it before clearing.
   */
  readonly remote: (options?: TRemote) => AssembledRemoteWorld
}

/** One web snapshot lane's environment and mount surface. */
export interface AssembledBootLane<TRemote = unknown> {
  /** Register the per-test jsdom setup and teardown (call once per spec file, at import). */
  readonly installAssembledBootEnv: () => void
  /**
   * Mount the assembled application on the lane's remote scenario; the
   * teardown registered by `installAssembledBootEnv` disposes it.
   * @param options - composition changes applied to this mount.
   * @returns the mounted remote-scenario world.
   */
  readonly mountAssembledApp: (options?: AssembledBootOptions<TRemote>) => AssembledRemoteWorld
}

interface FixtureWindow extends Window {
  __DSH_BOOT__?: ReturnType<typeof buildBootGraph>
  __ModuleLoader__?: ClientModuleLoaderTarget
  __DSH_TRANSPORT__?: { readonly rpc: ClientConnectionRpc }
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
let mountedRemote: AssembledRemoteWorld | undefined

/**
 * Create one lane's boot surface from its options.
 * @param options - the lane's bundle layers, remote scenario, and pinned title.
 * @returns the lane's `installAssembledBootEnv` / `mountAssembledApp` pair.
 */
export async function createAssembledBootLane<TRemote = unknown>(
  options: AssembledBootLaneOptions<TRemote>,
): Promise<AssembledBootLane<TRemote>> {
  const baseLayer: AssembledBundleLayer = options.baseBundle ?? {
    dir: join(process.cwd(), 'packages/bundle/base'),
    manifest: join(process.cwd(), 'packages/bundle/base/package.json'),
  }
  const plugins = await loadAssembledPlugins([baseLayer, options.webBundle])
  return {
    installAssembledBootEnv: () => {
      installAssembledBootEnv(options.documentTitle)
    },
    mountAssembledApp: (mountOptions: AssembledBootOptions<TRemote> = {}) =>
      mountAssembledApp(plugins, options.remote, mountOptions),
  }
}

/**
 * Register the per-test jsdom setup and teardown the assembled boot needs:
 * English pinned before boot so role/text locators and goldens stay
 * deterministic across localized component migrations (both lanes' goldens
 * render the English dictionary), the observers, font events, and frame
 * callbacks jsdom lacks, and a full reset of the document, the boot globals,
 * and the injected plugin styles afterwards.
 * @param documentTitle - title pinned before each boot and cleared after.
 */
function installAssembledBootEnv(documentTitle: string): void {
  // jsdom implements no scroll geometry: the trigger menu reveals its
  // highlight with scrollIntoView on open, which a pasted leading token now
  // reaches in this lane (the editor re-tracks at the settled caret).
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
  let fontsDescriptor: PropertyDescriptor | undefined
  beforeEach(() => {
    fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
    localStorage.clear()
    // The locale service derives its provisional locale from the browser and
    // takes an explicit choice only from Host settings. The remote scenario
    // serves no locale setting, so pinning the navigator selects English.
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
    const failures: unknown[] = []
    try {
      await act(async () => { await unmount?.() })
    } catch (error) {
      failures.push(error)
    }
    try {
      mountedRemote?.mock.assertNoUnmatched()
    } catch (error) {
      failures.push(error)
    }
    unmount = undefined
    mountedRemote = undefined
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
    if (fontsDescriptor === undefined) Reflect.deleteProperty(document, 'fonts')
    else Object.defineProperty(document, 'fonts', fontsDescriptor)
    if (failures.length > 0) throw new AggregateError(failures, 'assembled boot teardown failed')
  })
}

/**
 * Mount the assembled application on the lane's remote scenario; the teardown
 * registered by `installAssembledBootEnv` disposes it.
 * @param plugins - the lane's plugin rows, in module-graph order.
 * @param remote - the lane's remote-scenario factory.
 * @param options - composition changes applied to this mount.
 * @returns the mounted remote-scenario world.
 */
function mountAssembledApp<TRemote>(
  plugins: readonly AssembledPlugin[],
  remote: (options?: TRemote) => AssembledRemoteWorld,
  options: AssembledBootOptions<TRemote>,
): AssembledRemoteWorld {
  const excluded = new Set(options.exclude)
  const mounted = plugins.filter(plugin => !excluded.has(plugin.id))
  const world = remote(options.remote)
  mountedRemote = world
  win.__DSH_TRANSPORT__ = { rpc: world.rpc ?? world.mock.rpc }
  history.replaceState(null, '', '/')
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
  return world
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
