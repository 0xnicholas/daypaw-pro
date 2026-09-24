// @vitest-environment jsdom
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { createAssembledBootLane, hasClass, REFRESHING_GOLDEN } from '../src/index.ts'
import type { AssembledBootLane, AssembledRemoteWorld } from '../src/index.ts'

const fixture = (file: string): string => join(import.meta.dirname, 'fixtures/micro', file)

/** A remote world answering nothing: its rpc serves as the page's carrier without any rule. */
const stubWorld = (): AssembledRemoteWorld => ({
  mock: { rpc: { call: async () => ({ ok: true, value: {} }) }, assertNoUnmatched: () => {} },
})

interface MicroLaneOptions {
  readonly baseManifest?: string
  readonly webManifest?: string
  readonly documentTitle?: string
  readonly remote?: () => AssembledRemoteWorld
}

const microLane = async (options: MicroLaneOptions = {}): Promise<AssembledBootLane> =>
  createAssembledBootLane({
    baseBundle: { dir: fixture(''), manifest: fixture(options.baseManifest ?? 'manifest-base-modules.json') },
    webBundle: { dir: fixture(''), manifest: fixture(options.webManifest ?? 'manifest-base-disabled.json') },
    documentTitle: options.documentTitle ?? 'micro lane',
    remote: options.remote ?? stubWorld,
  })

const lane = await microLane()
// The first lane's setup assigns the geometry shims per test (jsdom ships
// neither API); this lane's setup then finds them present and skips.
const shimmedLane = await microLane({ documentTitle: 'shimmed lane' })

describe('assembled boot lane (jsdom)', () => {
  lane.installAssembledBootEnv()

  it('defaults the base bundle layer to the repo dsh-base layer', async () => {
    const defaultBaseLane = await createAssembledBootLane({
      webBundle: { dir: fixture(''), manifest: fixture('manifest-web-locale.json') },
      documentTitle: 'default base lane',
      remote: stubWorld,
    })
    expect(typeof defaultBaseLane.installAssembledBootEnv).toBe('function')
    expect(typeof defaultBaseLane.mountAssembledApp).toBe('function')
  })

  it('pins the document title and the English navigator before each boot', () => {
    expect(document.title).toBe('micro lane')
    expect(navigator.language).toBe('en-US')
    expect(navigator.languages).toEqual(['en-US'])
  })

  it('installs the mounted world\'s mock rpc as the page carrier', async () => {
    const remoteLane = await microLane({ webManifest: 'manifest-web-locale.json' })
    const world = remoteLane.mountAssembledApp()
    const transport = (window as { __DSH_TRANSPORT__?: { rpc: ClientConnectionRpc } }).__DSH_TRANSPORT__
    if (transport === undefined) throw new Error('spec: page carrier missing')
    expect(transport.rpc).toBe(world.mock.rpc)
    expect(window.location.search).toBe('')
    expect(document.getElementById('root')).not.toBeNull()
    expect((window as { __DSH_BOOT__?: { entries: unknown[] } }).__DSH_BOOT__?.entries.length).toBe(2)
  })

  it('installs the world\'s rpc override as the page carrier when present', async () => {
    const world = stubWorld()
    const decorated: ClientConnectionRpc = { call: async () => ({ ok: true, value: {} }) }
    const remoteLane = await microLane({
      webManifest: 'manifest-web-locale.json',
      remote: () => ({ ...world, rpc: decorated }),
    })
    remoteLane.mountAssembledApp()
    const transport = (window as { __DSH_TRANSPORT__?: { rpc: ClientConnectionRpc } }).__DSH_TRANSPORT__
    if (transport === undefined) throw new Error('spec: page carrier missing')
    expect(transport.rpc).toBe(decorated)
  })

  it('applies per-mount exclusions to the mounted composition', async () => {
    const excludeLane = await microLane({ webManifest: 'manifest-web-locale.json' })
    excludeLane.mountAssembledApp({ exclude: ['@deepseek-ai/dsh-client-locale'] })
    expect((window as { __DSH_BOOT__?: { entries: unknown[] } }).__DSH_BOOT__?.entries.length).toBe(1)
    excludeLane.mountAssembledApp({ exclude: ['@deepseek-ai/dsh-not-in-roster'] })
    expect((window as { __DSH_BOOT__?: { entries: unknown[] } }).__DSH_BOOT__?.entries.length).toBe(2)
  })

  it('fails loud when the composition has no parser-preloaded bootstrap batch', async () => {
    const emptyLane = await microLane({ baseManifest: 'manifest-base-disabled.json' })
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
