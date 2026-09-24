// Bundle composition for the assembled jsdom lanes: derive the browser boot
// graph from the same bundle patches and package declarations as `dsh web`,
// then read the built `lib/client.js` artifacts those declarations point at.
// Keyless and deterministic: nothing here reaches a model or the network.
import { globSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { orderByModuleGraph } from '@deepseek-ai/dsh-client-modules'
import type { WebBootEntry, WebBootGraph } from '@deepseek-ai/dsh-client-modules/client'

/** One bundle layer: the layer's package dir, whose manifest declares the overlay patches `dsh web` composes. */
export interface AssembledBundleLayer {
  /** The layer bundle package's dir (patch paths in its manifest resolve against it). */
  readonly dir: string
  /** Absolute path to the layer bundle package's manifest (require-resolution root for `@deepseek-ai/dsh-app-boot`). */
  readonly manifest: string
}

/** A browser plugin row with its built artifact attached for bundle-table reads. */
export interface AssembledPlugin extends WebBootEntry {
  /** Absolute path to the built client artifact declared by this package. */
  bundlePath: string
}

interface ClientPackageManifest {
  name?: string
  exports?: Record<string, string | { default?: string }>
  dsh?: {
    client?: {
      platform?: string
      inject?: string[]
      external?: string[]
      immediately?: boolean
      /** Marks the row's cordis config as forwardable to the browser plugin's apply. */
      config?: boolean
    }
  }
}

interface ComposedEntry {
  name?: unknown
  disabled?: unknown
  /** The row's cordis config, forwarded when the package declares `dsh.client.config`. */
  config?: unknown
}

interface BootComposition {
  bundlePatchPaths(packageDir: string, bundle: { patch: string | string[] }): string[]
  loadOverlayPatches(binName: string, file: string): unknown[]
  composeEntries(layers: readonly unknown[][]): ComposedEntry[]
}

const REPO_ROOT = process.cwd()

const workspacePackageManifests = new Map(globSync('packages/*/*/package.json', { cwd: REPO_ROOT }).map((relative) => {
  const path = join(REPO_ROOT, relative)
  const pkg = JSON.parse(readFileSync(path, 'utf8')) as ClientPackageManifest
  /* v8 ignore next 3 -- every workspace manifest carries a name; the check fails loud if one stops */
  if (pkg.name === undefined) throw new Error(`assembled boot: workspace package has no name: ${path}`)
  return [pkg.name, path]
}))

const comboUrl = (ids: readonly string[], rev: string): string =>
  `plugins/??${ids.map(id => `${id}/client.js`).join(',')}&rev=${rev}`

function resolvePackageManifest(specifier: string): string | undefined {
  return workspacePackageManifests.get(specifier)
}

function resolveClientExport(packagePath: string, pkg: ClientPackageManifest): string {
  const declared = pkg.exports?.['./client']
  /* v8 ignore next -- no workspace package spells its ./client export as a bare string; the arm fails loud if one appears */
  const relative = typeof declared === 'string' ? declared : declared?.default
  /* v8 ignore next 3 -- no workspace package declares dsh.client without a ./client export; the check fails loud if one appears */
  if (relative === undefined) {
    throw new Error(`assembled boot: ${pkg.name ?? packagePath} declares dsh.client without a ./client export`)
  }
  return resolve(dirname(packagePath), relative)
}

/**
 * Derive the assembled browser plugin list from the bundle layers' overlay
 * patches and the workspace packages' `dsh.client` declarations.
 * @param layers - bundle layers in application order; the last layer's manifest is the require root for the compose tooling.
 * @returns plugin rows in module-graph order, each with its built artifact path attached.
 */
export async function loadAssembledPlugins(layers: readonly AssembledBundleLayer[]): Promise<readonly AssembledPlugin[]> {
  const bundleResolvers = layers.map(layer => createRequire(layer.manifest))
  const webBundleResolver = bundleResolvers[bundleResolvers.length - 1]
  /* v8 ignore next 2 -- a lane always carries at least one bundle layer */
  if (webBundleResolver === undefined) throw new Error('assembled boot: web bundle resolver missing')
  const appBoot = await import(pathToFileURL(webBundleResolver.resolve('@deepseek-ai/dsh-app-boot')).href) as unknown as BootComposition
  const entries = appBoot.composeEntries(layers.map((layer) => {
    const declared = (JSON.parse(readFileSync(layer.manifest, 'utf8')) as { dsh: { bundle: { patch: string | string[] } } }).dsh.bundle
    return appBoot.bundlePatchPaths(layer.dir, declared).flatMap(patch => appBoot.loadOverlayPatches('assembled boot', patch))
  }))
  const plugins = new Map<string, AssembledPlugin>()
  for (const entry of entries) {
    if (entry.disabled === true || typeof entry.name !== 'string') continue
    const packagePath = resolvePackageManifest(entry.name)
    if (packagePath === undefined) continue
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as ClientPackageManifest
    const declaration = pkg.dsh?.client
    if (declaration?.platform !== 'web') continue
    /* v8 ignore next 3 -- the workspace map is keyed by each manifest's own name */
    if (pkg.name !== entry.name) {
      throw new Error(`assembled boot: ${entry.name} resolved package ${pkg.name ?? '<unnamed>'}`)
    }
    plugins.set(entry.name, {
      id: entry.name,
      bundlePath: resolveClientExport(packagePath, pkg),
      url: comboUrl([entry.name], 'fx'),
      rev: 'fx',
      ...(declaration.inject === undefined ? {} : { inject: declaration.inject }),
      ...(declaration.external === undefined ? {} : { external: declaration.external }),
      ...(declaration.immediately === true ? { immediately: true } : {}),
      ...(declaration.config === true && entry.config !== undefined ? { config: entry.config } : {}),
    })
  }
  return orderByModuleGraph([...plugins.values()]).map(({ id }) => {
    const plugin = plugins.get(id)
    /* v8 ignore next -- orderByModuleGraph returns the input row identities */
    if (plugin === undefined) throw new Error(`assembled boot: ordered unknown client package ${id}`)
    return plugin
  })
}

const BOOTSTRAP_IDS = ['@deepseek-ai/dsh-client-modules'] as const

/**
 * Build the boot graph for one mounted composition: entries minus artifact
 * paths, split into the parser-preloaded bootstrap batch and the application
 * batch the ModuleLoader fetches.
 * @param plugins - plugin rows to mount, in module-graph order.
 * @returns the graph installed as `__DSH_BOOT__`.
 */
export function buildBootGraph(plugins: readonly AssembledPlugin[]): WebBootGraph {
  const bootstrapEntries = plugins
    .map(plugin => plugin.id)
    .filter(id => BOOTSTRAP_IDS.includes(id as typeof BOOTSTRAP_IDS[number]))
  const applicationEntries = plugins
    .map(plugin => plugin.id)
    .filter(id => !BOOTSTRAP_IDS.includes(id as typeof BOOTSTRAP_IDS[number]))
  return {
    rev: 'fx',
    entries: plugins.map(({ bundlePath: _bundlePath, ...plugin }) => plugin),
    batches: [
      ...(bootstrapEntries.length === 0 ? [] : [{
        phase: 'bootstrap' as const,
        url: comboUrl(bootstrapEntries, 'fx'),
        rev: 'fx',
        entries: bootstrapEntries,
      }]),
      ...(applicationEntries.length === 0 ? [] : [{
        phase: 'application' as const,
        url: comboUrl(applicationEntries, 'fx'),
        rev: 'fx',
        entries: applicationEntries,
      }]),
    ],
  }
}

/**
 * Build the served-script table for one mounted composition: every plugin's
 * built artifact body keyed by its URL, plus the concatenated batch bodies.
 * @param graph - the composition's boot graph.
 * @param plugins - the plugin rows the graph was built from.
 * @returns URL → script body for the ModuleLoader's `loadBundle` reads.
 */
export function buildBundleTable(graph: WebBootGraph, plugins: readonly AssembledPlugin[]): Map<string, string> {
  const bundles = new Map(plugins.map(plugin => [
    plugin.url,
    readFileSync(plugin.bundlePath, 'utf8'),
  ]))
  for (const batch of graph.batches) {
    bundles.set(batch.url, batch.entries.map((id) => {
      const plugin = plugins.find(candidate => candidate.id === id)
      if (plugin === undefined) throw new Error(`assembled boot: batch names unknown plugin ${id}`)
      const code = bundles.get(plugin.url)
      /* v8 ignore next -- every batched plugin's URL is keyed by the same plugins array above */
      if (code === undefined) throw new Error(`assembled boot: missing built bundle ${plugin.url}`)
      return code
    }).join('\n;\n'))
  }
  return bundles
}
