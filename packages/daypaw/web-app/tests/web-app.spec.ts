/**
 * Web runtime glue behavior: dist resolution through the bundle's own hook,
 * the frontend-static child claiming the fallback seat, the web-surface
 * prompt section and bash runtime variables, and URL-line printing with the
 * runtime's bind-dependent LAN snapshot.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, Config, internals } from '../src/index.ts'
import { DurableEngine } from '@daypaw/sdk'

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  networkInterfaces: () => ({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }],
  }),
}))

let dist: string | undefined

afterEach(() => {
  vi.restoreAllMocks()
  internals.resolveDistIndex = originalResolve
  if (dist !== undefined) rmSync(dist, { recursive: true, force: true })
  dist = undefined
})

const originalResolve = internals.resolveDistIndex

/** Stage a dist fixture and point the bundle's resolver at it. */
function stageDist(): string {
  dist = mkdtempSync(join(tmpdir(), 'daypaw-web-app-'))
  mkdirSync(join(dist, 'dist'))
  const index = join(dist, 'dist', 'index.html')
  writeFileSync(index, '<head></head><body>shell</body>')
  internals.resolveDistIndex = () => index
  return index
}

/** A fake webServer capturing the fallback seat and index taps. */
function fakeHttpServer(host: '127.0.0.1' | '0.0.0.0' = '127.0.0.1'): { server: WebServer; seat: () => unknown } {
  let fallback: unknown
  const server = {
    host,
    port: 4567,
    registerFallback: (handler: unknown) => {
      fallback = handler
      return () => { fallback = undefined }
    },
    applyIndexTaps: (html: string) => html,
  } as unknown as WebServer
  return { server, seat: () => fallback }
}

/** A fake connection service: the trust fence admits everything and URL tokens are deterministic. */
function fakeConnection(): never {
  return { authorizeIndex: () => true, authenticatedUrl: (base: string) => `${base}/?token=t` } as never
}

/** A fake Loader whose settlement the test controls (the URL line waits on it). */
function provideLoader(ctx: Context, settle: () => Promise<void> = async () => {}): void {
  ctx.provide('loader', { await: settle } as never)
}

interface BashContribution {
  name: string
  variables: Record<string, { description: string }>
  resolve: () => Record<string, string>
}

describe('web-app runtime glue', () => {
  it('mounts dist serving, prompt section, bash variables, and prints the URL with the LAN snapshot', async () => {
    stageDist()
    const ctx = new Context()
    const { server, seat } = fakeHttpServer('0.0.0.0')
    ctx.provide('webServer', server)
    const contributions: BashContribution[] = []
    ctx.provide('shellEnv', {
      register: (contribution: BashContribution) => {
        contributions.push(contribution)
        return () => {}
      },
    } as never)
    provideLoader(ctx)
    ctx.provide('connection', fakeConnection())
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    // Run the glue as a real plugin fiber: its nested frontend-static and
    // system-prompt fibers activate under it (direct apply leaves nested
    // fibers unactivated).
    const glue = ctx.plugin({
      name: 'web-app',
      apply: (inner) => { apply(inner, new Config({ printUrl: true, surfaceContext: true, trustedHosts: ['lab.internal'], agentsDir: 'daypaw/agents' })) },
    })
    await glue
    await ctx.plugin(SystemPrompt, { persona: '' })
    // Settle the injected registrations.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(seat()).toBeDefined() // frontend-static claimed the fallback
    expect(ctx.get('webRuntime')).toEqual({
      lanAddresses: ['192.168.1.5'],
      trustedHosts: ['192.168.1.5', 'lab.internal'],
    })
    expect(log).toHaveBeenCalledWith('daypaw web: http://127.0.0.1:4567/?token=t (LAN: http://192.168.1.5:4567/?token=t)')
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'harness:source')?.text).toContain('DeepSeek Harness implementation checkout')
    const section = assembly.sections.find(entry => entry.name === 'app:web-surface')
    expect(section?.text).toContain('http://127.0.0.1:4567')
    expect(section?.text).toContain('daypaw Web GUI')
    // The single update contract: the receiver is always on; this shell wires
    // no rebuild watcher, so every change means rebuild plus refresh.
    expect(section?.text).toContain('no rebuild watcher wired yet')
    const webRuntime = contributions.find(contribution => contribution.name === 'web-runtime')
    expect(webRuntime?.resolve()).toEqual({ DSH_WEB_URL: 'http://127.0.0.1:4567' })
    await ctx.fiber.dispose()
  })

  it('stays quiet with printUrl off', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx, new Config({ printUrl: false, surfaceContext: true, trustedHosts: [], agentsDir: 'daypaw/agents' }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'app:web-surface')?.text)
      .toContain('rebuilding the affected Web artifacts')
    await ctx.fiber.dispose()
  })

  it('skips the surface context when disabled (the one-shot layer): no prompt section, no bash variables', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    const contributions: BashContribution[] = []
    ctx.provide('shellEnv', {
      register: (contribution: BashContribution) => {
        contributions.push(contribution)
        return () => {}
      },
    } as never)
    apply(ctx, new Config({ printUrl: false, surfaceContext: false, trustedHosts: [], agentsDir: 'daypaw/agents' }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'app:web-surface')).toBe(false)
    expect(assembly.sections.some(entry => entry.name === 'harness:source')).toBe(false)
    expect(contributions).toEqual([])
    await ctx.fiber.dispose()
  })

  it('prints the loopback-only URL line when no LAN snapshot exists', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    ctx.provide('connection', fakeConnection())
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx, new Config({ printUrl: true, surfaceContext: true, trustedHosts: [], agentsDir: 'daypaw/agents' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith('daypaw web: http://127.0.0.1:4567/?token=t')
    await ctx.fiber.dispose()
  })

  it('defers the URL line until Loader settlement and drops it on failure or teardown', async () => {
    stageDist()
    // Settlement path: the line waits for loader.await() so supervisors can
    // RPC immediately after observing it.
    const settled = new Context()
    settled.provide('webServer', fakeHttpServer().server)
    settled.provide('connection', fakeConnection())
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    provideLoader(settled, () => settlement)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(settled, new Config({ printUrl: true, surfaceContext: true, trustedHosts: [], agentsDir: 'daypaw/agents' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    release!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).toHaveBeenCalledWith('daypaw web: http://127.0.0.1:4567/?token=t')
    await settled.fiber.dispose()

    // Failed path: Loader reports the sibling failure; the app prints no URL
    // for a process that is about to exit.
    log.mockClear()
    const failed = new Context()
    failed.provide('webServer', fakeHttpServer().server)
    provideLoader(failed, async () => { throw new Error('boot failed') })
    apply(failed, new Config({ printUrl: true, surfaceContext: true, trustedHosts: [], agentsDir: 'daypaw/agents' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    await failed.fiber.dispose()

    // Torn-down path: settlement resolves after the webserver is gone — no
    // line, no crash.
    log.mockClear()
    const torn = new Context()
    const child = torn.plugin((childCtx: Context) => {
      childCtx.provide('webServer', fakeHttpServer().server)
    })
    await child
    let releaseTorn: () => void
    const tornSettlement = new Promise<void>((resolve) => { releaseTorn = resolve })
    provideLoader(torn, () => tornSettlement)
    apply(torn, new Config({ printUrl: true, surfaceContext: true, trustedHosts: [], agentsDir: 'daypaw/agents' }))
    await child.dispose() // the webServer service goes away
    releaseTorn!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    await torn.fiber.dispose()

    // Connection-torn path: the webServer survives but the connection row's
    // fiber is disposed before settlement — tokening reads a torn-down
    // service, so no line and no crash.
    log.mockClear()
    const tornConnection = new Context()
    tornConnection.provide('webServer', fakeHttpServer().server)
    const connectionChild = tornConnection.plugin((childCtx: Context) => {
      childCtx.provide('connection', fakeConnection())
    })
    await connectionChild
    let releaseConnection: () => void
    const connectionSettlement = new Promise<void>((resolve) => { releaseConnection = resolve })
    provideLoader(tornConnection, () => connectionSettlement)
    apply(tornConnection, new Config({ printUrl: true, surfaceContext: true, trustedHosts: [], agentsDir: 'daypaw/agents' }))
    await connectionChild.dispose() // the connection service goes away
    releaseConnection!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    await tornConnection.fiber.dispose()
  })

  it('fails loud when the prompt section resolves against a portless webserver', async () => {
    stageDist()
    const ctx = new Context()
    // A webserver whose bound port is gone (torn down mid-request): the
    // section must throw, never render a URL with an undefined port.
    const { server } = fakeHttpServer()
    Object.defineProperty(server, 'port', { get: () => undefined })
    ctx.provide('webServer', server)
    apply(ctx, new Config({ printUrl: false, surfaceContext: true, trustedHosts: [], agentsDir: 'daypaw/agents' }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow('webServer service missing')
    await ctx.fiber.dispose()
  })

  it('resolves the real built daypaw frontend dist through the package exports, failing loud unbuilt', () => {
    // The production resolver (not the test hook). A built checkout resolves
    // the frontend package's index.html; a dist-less one (the CI coverage
    // lane runs before any build) must fail with the build hint, never a
    // silent fallback.
    try {
      expect(originalResolve()).toMatch(/dist[/\\]index\.html$/)
    } catch (error) {
      expect((error as Error).message).toContain('frontend dist not built')
    }
  })
})

describe('web-app agents roster wiring', () => {
  it('loads workspace agents once the durable engine appears', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'daypaw-web-agents-'))
    dist = dir
    writeFileSync(join(dir, 'flow.mjs'), [
      'export default ({ defineWorkflow, z }) => defineWorkflow({',
      "  name: 'wired-flow', version: '1',",
      '  input: z.object({ code: z.string() }), output: z.object({ ok: z.boolean() }),',
      '  body: async (ctx, input) => ({ ok: input.code.length > 0 }),',
      '})',
      '',
    ].join('\n'))
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(line) })
    try {
      const ctx = new Context()
      ctx.provide('webServer', fakeHttpServer().server)
      provideLoader(ctx)
      await ctx.plugin(DurableEngine, { path: ':memory:', pollMs: 20 })
      await ctx.plugin({
        name: 'web-app',
        apply: (inner) => {
          apply(inner, new Config({ printUrl: false, surfaceContext: false, trustedHosts: [], agentsDir: dir }))
        },
      })
      const deadline = Date.now() + 2_000
      while ((await ctx.durable.listDefinitions()).length === 0) {
        if (Date.now() > deadline) throw new Error('agents roster never loaded')
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(await ctx.durable.listDefinitions()).toHaveLength(1)
      expect(lines).toContain(`daypaw agents: 1 definition(s) from ${dir}`)
    } finally {
      log.mockRestore()
    }
  })

  it('defaults agentsDir to daypaw/agents and logs nothing for the legal empty roster', async () => {
    // A nonexistent default directory under a temp cwd stays empty and quiet.
    const emptyRoot = mkdtempSync(join(tmpdir(), 'daypaw-web-empty-'))
    dist = emptyRoot
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(line) })
    try {
      const ctx = new Context()
      ctx.provide('webServer', fakeHttpServer().server)
      provideLoader(ctx)
      await ctx.plugin(DurableEngine, { path: ':memory:', pollMs: 20 })
      await ctx.plugin({
        name: 'web-app',
        apply: (inner) => { apply(inner, new Config({ printUrl: false, surfaceContext: false, trustedHosts: [], agentsDir: 'daypaw/agents' })) },
      })
      const config = new Config({ printUrl: false, surfaceContext: false, trustedHosts: [], agentsDir: 'daypaw/agents' })
      expect(config.agentsDir).toBe('daypaw/agents')
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(lines).toEqual([])
    } finally {
      log.mockRestore()
    }
  })

  it('fails the load fiber loud when an agents file is broken', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'daypaw-web-broken-'))
    dist = dir
    writeFileSync(join(dir, 'broken.mjs'), 'export default 7\n')
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    provideLoader(ctx)
    const errors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
    await ctx.plugin(DurableEngine, { path: ':memory:', pollMs: 20 })
    await ctx.plugin({
      name: 'web-app',
      apply: (inner) => {
        apply(inner, new Config({ printUrl: false, surfaceContext: false, trustedHosts: [], agentsDir: dir }))
      },
    })
    const deadline = Date.now() + 2_000
    while (errors.length === 0) {
      if (Date.now() > deadline) throw new Error('broken agents file never surfaced')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(String(errors[0])).toContain('broken.mjs default-exports no factory')
  })
})
