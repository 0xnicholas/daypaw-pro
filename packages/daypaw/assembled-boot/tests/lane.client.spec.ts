// @vitest-environment jsdom
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { connectionRpcCarrier, createAssembledBootLane, hasClass, REFRESHING_GOLDEN } from '../src/index.ts'
import type { AssembledBootLane } from '../src/index.ts'

const fixture = (file: string): string => join(import.meta.dirname, 'fixtures/micro', file)

/** A carrier bridging a no-op Connection transport: installed as the page's carrier without answering anything. */
const stubCarrier = (): (() => ReturnType<typeof connectionRpcCarrier>) => {
  const rpc: ClientConnectionRpc = { call: async () => ({ ok: true, value: {} }) }
  return () => connectionRpcCarrier(rpc)
}

interface MicroLaneOptions {
  readonly basePatch?: string
  readonly webPatch?: string
  readonly documentTitle?: string
  readonly carrier?: () => ReturnType<typeof connectionRpcCarrier>
}

const microLane = async (options: MicroLaneOptions = {}): Promise<AssembledBootLane> =>
  createAssembledBootLane({
    baseBundle: { manifest: fixture('package.json'), patch: fixture(options.basePatch ?? 'base-modules.patch.yml') },
    webBundle: { manifest: fixture('package.json'), patch: fixture(options.webPatch ?? 'base-disabled.patch.yml') },
    documentTitle: options.documentTitle ?? 'micro lane',
    ...(options.carrier === undefined ? {} : { carrier: options.carrier }),
  })

const lane = await microLane()
// The first lane's setup assigns the geometry shims per test (jsdom ships
// neither API); this lane's setup then finds them present and skips.
const shimmedLane = await microLane({ documentTitle: 'shimmed lane' })

describe('connectionRpcCarrier', () => {
  it('bridges unary calls through the ClientRequest/ServerResponse envelope', async () => {
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const rpc: ClientConnectionRpc = {
      call: async (_channel, endpoint, payload) => {
        calls.push({ endpoint, payload })
        return { ok: true, value: { echoed: endpoint } }
      },
    }
    const fetch = connectionRpcCarrier(rpc).fetch
    if (fetch === undefined) throw new Error('spec: carrier lacks its unary fetch hook')
    const response = await fetch(
      new URL('http://localhost/api/durable%2FlistDefinitions'),
      {
        method: 'POST',
        body: JSON.stringify({ rpcId: 'rpc-1', payload: { task: 'x' } }),
        signal: new AbortController().signal,
      },
    )
    expect(calls).toEqual([{ endpoint: 'durable/listDefinitions', payload: { task: 'x' } }])
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    await expect(response.json()).resolves.toEqual({
      type: 'server-response',
      rpcId: 'rpc-1',
      result: { ok: true, value: { echoed: 'durable/listDefinitions' } },
    })
    // The same call without an AbortSignal exercises the carrier's no-signal arm.
    await expect(fetch(
      new URL('http://localhost/api/durable%2FlistDefinitions'),
      { method: 'POST', body: JSON.stringify({ rpcId: 'rpc-2', payload: {} }) },
    )).resolves.toBeInstanceOf(Response)
  })

  it('rejects a non-string request body from a foreign caller', async () => {
    const rpc: ClientConnectionRpc = { call: async () => ({ ok: true, value: {} }) }
    const fetch = connectionRpcCarrier(rpc).fetch
    if (fetch === undefined) throw new Error('spec: carrier lacks its unary fetch hook')
    await expect(
      fetch(new URL('http://localhost/api/x'), { method: 'POST' }),
    ).rejects.toThrow('non-string request body')
  })

  it('delegates streams to the transport\'s in-process opens', () => {
    const stream = { marker: 'stream' }
    const rpc: ClientConnectionRpc = {
      call: async () => ({ ok: true, value: {} }),
      open: (_channel, _endpoint, _payload, _signal) => stream as never,
    }
    const openStream = connectionRpcCarrier(rpc).openStream
    if (openStream === undefined) throw new Error('spec: carrier lacks its stream hook')
    expect(openStream('endpoint', {}, new AbortController().signal)).toBe(stream)
  })

  it('fails loud when the transport offers no stream for an endpoint', () => {
    const rpc: ClientConnectionRpc = { call: async () => ({ ok: true, value: {} }) }
    const openStream = connectionRpcCarrier(rpc).openStream
    if (openStream === undefined) throw new Error('spec: carrier lacks its stream hook')
    expect(() => openStream('endpoint', {}, new AbortController().signal))
      .toThrow('stream endpoint "endpoint" is unavailable')
  })
})

describe('assembled boot lane (jsdom)', () => {
  lane.installAssembledBootEnv()

  it('defaults the base bundle layer to the repo dsh-base layer', async () => {
    const defaultBaseLane = await createAssembledBootLane({
      webBundle: { manifest: fixture('package.json'), patch: fixture('web-locale.patch.yml') },
      documentTitle: 'default base lane',
    })
    expect(typeof defaultBaseLane.installAssembledBootEnv).toBe('function')
    expect(typeof defaultBaseLane.mountAssembledApp).toBe('function')
  })

  it('pins the document title and the English navigator before each boot', () => {
    expect(document.title).toBe('micro lane')
    expect(navigator.language).toBe('en-US')
    expect(navigator.languages).toEqual(['en-US'])
  })

  it('mounts on the carrier transport with an empty search by default', async () => {
    const carrierLane = await microLane({ carrier: stubCarrier(), webPatch: 'web-locale.patch.yml' })
    carrierLane.mountAssembledApp()
    expect(window.location.search).toBe('')
    expect(document.getElementById('root')).not.toBeNull()
    expect((window as { __DSH_BOOT__?: { entries: unknown[] } }).__DSH_BOOT__?.entries.length).toBe(2)
    expect((window as { __DSH_TRANSPORT__?: unknown }).__DSH_TRANSPORT__).toBeDefined()
  })

  it('rejects the ?fixture switch on a carrier lane', async () => {
    const carrierLane = await microLane({ carrier: stubCarrier() })
    expect(() => { carrierLane.mountAssembledApp('?fixture') }).toThrow('remove the ?fixture switch')
  })

  it('defaults a carrier-less lane to the ?fixture search switch', async () => {
    const searchLane = await microLane()
    searchLane.mountAssembledApp()
    expect(window.location.search).toBe('?fixture')
    expect((window as { __DSH_TRANSPORT__?: unknown }).__DSH_TRANSPORT__).toBeUndefined()
  })

  it('applies per-mount exclusions to the mounted composition', async () => {
    const excludeLane = await microLane({ webPatch: 'web-locale.patch.yml' })
    excludeLane.mountAssembledApp('', { exclude: ['@deepseek-ai/dsh-client-locale'] })
    expect((window as { __DSH_BOOT__?: { entries: unknown[] } }).__DSH_BOOT__?.entries.length).toBe(1)
    excludeLane.mountAssembledApp('', { exclude: ['@deepseek-ai/dsh-not-in-roster'] })
    expect((window as { __DSH_BOOT__?: { entries: unknown[] } }).__DSH_BOOT__?.entries.length).toBe(2)
  })

  it('fails loud when the composition has no parser-preloaded bootstrap batch', async () => {
    const emptyLane = await microLane({ basePatch: 'base-disabled.patch.yml' })
    expect(() => { emptyLane.mountAssembledApp() }).toThrow('missing parser-preloaded fixture batch')
  })

  it('exposes inert observer stubs, the frame callbacks, and the geometry shims', async () => {
    const observer = new ResizeObserver(() => {})
    observer.observe(document.body)
    observer.unobserve(document.body)
    observer.disconnect()
    const source = new EventSource('/')
    source.addEventListener('open', () => {})
    source.close()
    let painted = false
    requestAnimationFrame(() => { painted = true })
    cancelAnimationFrame(1)
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    expect(painted).toBe(true)
    Element.prototype.scrollIntoView?.()
    Range.prototype.getBoundingClientRect?.()?.toJSON()
  })

  it('leaves an injected plugin style for the teardown to remove', () => {
    const style = document.createElement('style')
    style.dataset.plugin = 'spec'
    document.head.appendChild(style)
  })

  it('keeps a clean slate between tests', () => {
    expect(document.getElementById('root')).toBeNull()
    expect(window.location.pathname).toBe('/')
    expect(document.head.querySelectorAll('style[data-plugin]')).toHaveLength(0)
  })

  it('exposes the snapshot refresh flag and the CSS-module class matcher', () => {
    expect(REFRESHING_GOLDEN).toBe(false)
    const el = document.createElement('div')
    el.className = 'foo abc_foo _foo_1 x_foo_y foobar lineNumber'
    expect(hasClass(el, 'foo')).toBe(true)
    expect(hasClass(el, 'line')).toBe(false)
  })

  it('tracks the DSH_SNAPSHOT mode', async () => {
    const reload = async (): Promise<boolean> => {
      vi.resetModules()
      return (await import('../src/index.ts')).REFRESHING_GOLDEN
    }
    try {
      vi.stubEnv('DSH_SNAPSHOT', 'record')
      await expect(reload()).resolves.toBe(true)
      vi.stubEnv('DSH_SNAPSHOT', 'refresh')
      await expect(reload()).resolves.toBe(true)
      vi.unstubAllEnvs()
      await expect(reload()).resolves.toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('assembled boot lane with the geometry shims already present', () => {
  shimmedLane.installAssembledBootEnv()

  it('installs without reshimming the geometry it finds present', () => {
    expect(document.title).toBe('shimmed lane')
    expect(typeof Element.prototype.scrollIntoView).toBe('function')
  })
})
