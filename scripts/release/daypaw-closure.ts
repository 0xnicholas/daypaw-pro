/**
 * Closure completeness for the daypaw release staging trees: the BFS that
 * finds packages `pnpm deploy --legacy` dropped, the restore loop that copies
 * them in from their repository sources, and the manifest IO the two share.
 * Owned by `scripts/release/daypaw.ts`; messages keep its `release-daypaw:`
 * prefix.
 */

import { existsSync } from 'node:fs'
import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'

/** The subset of staged manifest fields the release pipeline reads and rewrites. */
export interface StagedManifest {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  devDependencies?: Record<string, string>
  bundleDependencies?: string[]
  [field: string]: unknown
}

/**
 * Read one staged manifest.
 * @param path - the manifest path.
 * @returns the parsed manifest.
 */
export async function readManifest(path: string): Promise<StagedManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as StagedManifest
}

/**
 * Write one staged manifest with a trailing newline.
 * @param path - the manifest path.
 * @param manifest - the manifest to write.
 */
export async function writeManifest(path: string, manifest: StagedManifest): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Resolve the staged directory of one package as Node would from an anchor manifest. */
function stagedPackageDir(staging: string, anchorManifest: string, name: string): string | undefined {
  for (const parent of createRequire(anchorManifest).resolve.paths(name) ?? []) {
    const candidate = join(parent, name)
    // The staging tree lives inside the repository, so Node's parent-directory
    // walk would otherwise escape into the repo's own node_modules and the
    // completeness check would credit packages the tarball does not carry.
    if (!candidate.startsWith(staging + sep)) continue
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * BFS over `dependencies` + `peerDependencies` from the staging root; every
 * reached package must be staged. Peers the referencing manifest marks
 * optional in `peerDependenciesMeta` may be absent (ws's bufferutil, the MCP
 * SDK's json-schema peer), as may the deploy root's consumer-supplied
 * external peers.
 * @param staging - the deploy target.
 * @param externalPeers - root peers allowed to be absent by design.
 * @returns the missing package names.
 */
export async function missingClosurePackages(staging: string, externalPeers: readonly string[]): Promise<string[]> {
  const external = new Set(externalPeers)
  const rootManifestPath = join(staging, 'package.json')
  const seen = new Set<string>()
  const missing = new Set<string>()
  const queue = [rootManifestPath]
  for (let anchor = queue.shift(); anchor !== undefined; anchor = queue.shift()) {
    const manifest = await readManifest(anchor)
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]
    for (const name of declared) {
      if (seen.has(name)) continue
      seen.add(name)
      const dir = stagedPackageDir(staging, anchor, name)
      if (dir === undefined) {
        if (manifest.peerDependenciesMeta?.[name]?.optional === true) continue
        if (anchor === rootManifestPath && external.has(name)) continue
        missing.add(name)
        continue
      }
      queue.push(join(dir, 'package.json'))
    }
  }
  return [...missing].sort()
}

/**
 * Find a package's repository source directory: workspace package dir, the
 * deploy source's node_modules (legacy-deploy hoist residue), or the
 * repo-root resolution paths for external packages. `native/` platform
 * build trees are not restore sources; `repositoryVersion` in
 * `daypaw.ts` reads their versions without copying them.
 * @param name - the package name.
 * @param sourceDir - the deploy root's repository directory.
 * @param root - the repository root.
 * @returns the source directory, or undefined when unknown.
 */
async function locatePackage(name: string, sourceDir: string, root: string): Promise<string | undefined> {
  for (const base of ['packages', 'vendor', 'apps']) {
    const found = await findWorkspacePackage(join(root, base), name, 3)
    if (found !== undefined) return found
  }
  const hoisted = join(sourceDir, 'node_modules', name)
  if (existsSync(join(hoisted, 'package.json'))) return hoisted
  for (const parent of createRequire(join(root, 'package.json')).resolve.paths(name) ?? []) {
    const candidate = join(parent, name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * Walk a workspace base directory for the package.json declaring `name`.
 * @param dir - the directory to walk.
 * @param name - the wanted package name.
 * @param depth - remaining directory depth.
 * @returns the declaring directory, or undefined when absent.
 */
export async function findWorkspacePackage(dir: string, name: string, depth: number): Promise<string | undefined> {
  if (depth < 0 || !existsSync(dir)) return undefined
  const manifestPath = join(dir, 'package.json')
  if (existsSync(manifestPath) && (await readManifest(manifestPath)).name === name) return dir
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const found = await findWorkspacePackage(join(dir, entry.name), name, depth - 1)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Copy each missing workspace or registry package into the staging closure
 * from its repository location, then re-check, until the completeness check
 * reaches its fixpoint. Legacy deploy drops transitive and peer-only
 * packages, and each restore round surfaces only the dependencies of
 * packages staged by the previous round, so the loop runs as deep as the
 * closure requires: every round stages at least one package, every staged
 * package is credited by its staged directory on the next check, and the
 * repository's finite on-disk sources bound the reachable name universe.
 * A package without a repository source fails the release by name.
 * @param staging - the edit-safe staging tree.
 * @param sourceDir - the deploy root's repository directory.
 * @param externalPeers - root peers allowed to be absent by design.
 * @param root - the repository root.
 */
export async function completeClosure(
  staging: string,
  sourceDir: string,
  externalPeers: readonly string[],
  root: string,
): Promise<void> {
  for (let round = 0; ; round++) {
    const missing = await missingClosurePackages(staging, externalPeers)
    if (missing.length === 0) {
      console.log(`release-daypaw: closure complete after ${round} restore round(s)`)
      return
    }
    console.log(`release-daypaw: restoring ${missing.length} missing closure package(s): ${missing.join(', ')}`)
    for (const name of missing) {
      const source = await locatePackage(name, sourceDir, root)
      if (source === undefined) {
        throw new Error(`release-daypaw: closure package ${name} is missing from ${staging} and has no repository source.`)
      }
      const destination = join(staging, 'node_modules', name)
      const nestedNodeModules = join(source, 'node_modules')
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
    }
  }
}
