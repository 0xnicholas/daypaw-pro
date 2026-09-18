import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBootGraph, buildBundleTable, loadAssembledPlugins } from '../src/composition.ts'
import type { AssembledBundleLayer } from '../src/composition.ts'

const fixture = (file: string): string => join(import.meta.dirname, 'fixtures/micro', file)
const layer = (patch: string): AssembledBundleLayer => ({ manifest: fixture('package.json'), patch: fixture(patch) })

describe('loadAssembledPlugins', () => {
  it('derives plugin rows from the overlay patches, attaching each declaration\'s built artifact', async () => {
    const plugins = await loadAssembledPlugins([layer('base-modules.patch.yml'), layer('web-locale.patch.yml')])
    expect(plugins.map(plugin => plugin.id)).toEqual([
      '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-locale',
    ])
    const locale = plugins[1]
    if (locale === undefined) throw new Error('spec: locale plugin missing')
    expect(locale.bundlePath.endsWith('client.js')).toBe(true)
    expect(locale.inject).toEqual([
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-api-remotes',
    ])
  })

  it('skips disabled rows, non-string names, foreign packages, and non-web declarations, and forwards declaration-gated config', async () => {
    const plugins = await loadAssembledPlugins([layer('base-modules.patch.yml'), layer('web-odd.patch.yml')])
    expect(plugins.map(plugin => plugin.id)).toEqual([
      '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-ui-trajectory',
    ])
    expect(plugins[1]?.config).toEqual({ viewSlot: 'inbox.workspace.conversation.inspector' })
  })

  it('yields an empty composition when every row is disabled', async () => {
    const plugins = await loadAssembledPlugins([layer('base-disabled.patch.yml'), layer('base-disabled.patch.yml')])
    expect(plugins).toEqual([])
  })

  it('loads both real lanes\' rosters: the upstream web bundle and the daypaw patch over it', async () => {
    const root = process.cwd()
    const base: AssembledBundleLayer = {
      manifest: join(root, 'packages/bundle/base/package.json'),
      patch: join(root, 'packages/bundle/base/cordis.patch.yml'),
    }
    const upstream = await loadAssembledPlugins([base, {
      manifest: join(root, 'packages/bundle/web-app/package.json'),
      patch: join(root, 'packages/bundle/web-app/cordis.patch.yml'),
    }])
    expect(upstream.map(plugin => plugin.id)).toContain('@deepseek-ai/dsh-client-modules')
    expect(upstream.every(plugin => !plugin.id.startsWith('@daypaw/'))).toBe(true)

    const fork = await loadAssembledPlugins([base, {
      manifest: join(root, 'packages/daypaw/web-app/package.json'),
      patch: join(root, 'packages/daypaw/web-app/cordis.patch.yml'),
    }])
    expect(fork.map(plugin => plugin.id)).toContain('@daypaw/ui-brand')
    expect(fork.some(plugin => plugin.config !== undefined)).toBe(true)
  })
})

describe('buildBootGraph', () => {
  it('splits the composition into parser-preloaded bootstrap and application batches', async () => {
    const plugins = await loadAssembledPlugins([layer('base-modules.patch.yml'), layer('web-locale.patch.yml')])
    const graph = buildBootGraph(plugins)
    expect(graph.batches.map(batch => batch.phase)).toEqual(['bootstrap', 'application'])
    expect(graph.batches[0]?.entries).toEqual(['@deepseek-ai/dsh-client-modules'])
    expect(graph.batches[1]?.entries).toEqual(['@deepseek-ai/dsh-client-locale'])
    expect(graph.entries.every(entry => !('bundlePath' in entry))).toBe(true)
  })

  it('omits the bootstrap batch when no bootstrap plugin is mounted', async () => {
    const plugins = await loadAssembledPlugins([layer('base-disabled.patch.yml'), layer('web-locale.patch.yml')])
    const graph = buildBootGraph(plugins)
    expect(graph.batches.map(batch => batch.phase)).toEqual(['application'])
  })

  it('omits the application batch when only the bootstrap plugin is mounted', async () => {
    const plugins = await loadAssembledPlugins([layer('base-modules.patch.yml'), layer('base-disabled.patch.yml')])
    const graph = buildBootGraph(plugins)
    expect(graph.batches.map(batch => batch.phase)).toEqual(['bootstrap'])
  })
})

describe('buildBundleTable', () => {
  it('tables every artifact body and the concatenated batch bodies', async () => {
    const plugins = await loadAssembledPlugins([layer('base-modules.patch.yml'), layer('web-locale.patch.yml')])
    const graph = buildBootGraph(plugins)
    const bundles = buildBundleTable(graph, plugins)
    const moduleBody = bundles.get(plugins[0]?.url ?? '')
    expect(typeof moduleBody).toBe('string')
    expect((moduleBody ?? '').length).toBeGreaterThan(0)
    for (const batch of graph.batches) {
      const body = bundles.get(batch.url)
      expect(body).toBeDefined()
      expect((body ?? '').length).toBeGreaterThan(0)
    }
  })

  it('fails loud when a batch names a plugin outside the tabled composition', async () => {
    const plugins = await loadAssembledPlugins([layer('base-modules.patch.yml'), layer('web-locale.patch.yml')])
    const graph = buildBootGraph(plugins)
    expect(() => buildBundleTable(graph, plugins.slice(0, 1))).toThrow('batch names unknown plugin')
  })
})
