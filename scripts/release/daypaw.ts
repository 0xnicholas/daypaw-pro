/**
 * Build and pack the daypaw customer-delivery npm packages (`@daypaw/cli`,
 * `@daypaw/sdk`) as self-contained tarballs per ADR 0011: `pnpm deploy`
 * materializes each package's vendored workspace closure, the closure is
 * completeness-checked and restored, manifests are rewritten from
 * `workspace:` ranges to real versions, and `npm pack` bundles the closure
 * through `bundleDependencies`. `--publish` publishes the packed tarballs.
 *
 * Two pnpm-deploy hazards shape the pipeline: deploy hardlinks workspace
 * files into the target, so every manifest edit happens in a content-copied
 * tree; and legacy deploy leaves hoist residue in the deploy source's
 * node_modules that makes the next `pnpm run` demand an interactive
 * `--production` purge — the build faces therefore run before any deploy.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..', '..')

/** Pack and smoke artifacts land here; the directory is gitignored. */
const OUT_DIR = resolve(root, 'dist-daypaw')

/**
 * Peer packages the published `@daypaw/sdk` deliberately does NOT bundle:
 * the consumer supplies them (cordis/invariants singletons, zod contracts),
 * resolved from upstream's npm releases (ADR 0011 §2 addendum).
 */
const SDK_EXTERNAL_PEERS = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-invariants', 'zod'] as const

/** The two publishable packages and their deploy filters. */
const PACKAGES = [
  { key: 'cli', filter: '@daypaw/cli', externalPeers: [] as readonly string[] },
  { key: 'sdk', filter: '@daypaw/sdk', externalPeers: SDK_EXTERNAL_PEERS },
] as const

type PackageKey = (typeof PACKAGES)[number]['key']

/** The subset of staged manifest fields this script reads and rewrites. */
interface StagedManifest {
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

/** Validated CLI configuration; construction owns help and parse-error exits. */
class ReleaseCli {
  private constructor(
    /** Skip the two build faces; lib/ artifacts must already exist. */
    readonly skipBuild: boolean,
    /** Skip the post-pack install smokes. */
    readonly skipSmoke: boolean,
    /** Publish the packed tarballs with `npm publish` instead of stopping at pack. */
    readonly publish: boolean,
  ) {}

  /**
   * Parse argv. Help exits 0; malformed flags exit 1.
   * @param argv - the raw arguments (`process.argv.slice(2)`).
   * @returns the parsed configuration.
   */
  static parse(argv: string[]): ReleaseCli {
    let values: ReturnType<typeof ReleaseCli.parseRaw>
    try {
      values = ReleaseCli.parseRaw(argv)
    } catch (error) {
      console.error(`release-daypaw: ${error instanceof Error ? error.message : String(error)}\n`)
      console.error(ReleaseCli.usage())
      process.exit(1)
    }
    if (values.help) {
      console.log(ReleaseCli.usage())
      process.exit(0)
    }
    return new ReleaseCli(values['skip-build'], values['skip-smoke'], values.publish)
  }

  private static parseRaw(argv: string[]) {
    return parseArgs({
      args: argv,
      options: {
        'skip-build': { type: 'boolean', default: false },
        'skip-smoke': { type: 'boolean', default: false },
        'publish': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    }).values
  }

  private static usage(): string {
    return [
      'Usage: pnpm run release:daypaw [--flags]',
      '',
      '  --skip-build   skip both build faces (lib/ artifacts must already exist).',
      '  --skip-smoke   skip the clean-prefix CLI boot and SDK consumer typecheck smokes.',
      '  --publish      npm publish the packed tarballs (default: pack only).',
      '  --help         print this help.',
      '',
      `Artifacts land in ${OUT_DIR}/. Delivery shape: docs/adr/0011-customer-self-run-delivery.md.`,
    ].join('\n')
  }
}

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Run one subprocess, returning captured stdout. Spawn and non-zero-exit
 * errors include the command; stdout inherits to the terminal unless
 * `capture` is set.
 * @param label - the step name used in logs and error messages.
 * @param command - the executable.
 * @param args - its arguments.
 * @param options - working directory, extra environment, and capture mode.
 * @returns captured combined output when `options.capture` is set.
 */
async function run(
  label: string,
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined>; capture?: boolean } = {},
): Promise<string> {
  const printable = formatCommand(command, args)
  console.log(`release-daypaw: ${label}: ${printable}`)
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      stdio: options.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      // Artifact builds must not mutate or validate a developer's Git hooks.
      env: { ...process.env, ...options.env, CI: 'true' },
    })
    let captured = ''
    if (options.capture) {
      child.stdout?.on('data', (chunk: Buffer) => { captured += chunk.toString('utf8') })
      child.stderr?.on('data', (chunk: Buffer) => { captured += chunk.toString('utf8') })
    }
    child.once('error', (error) => {
      reject(new Error(`release-daypaw: ${label} failed to spawn: ${error.message} (${printable})`))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise(captured)
        return
      }
      const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
      const detail = captured === '' ? '' : `\n${captured}`
      reject(new Error(`release-daypaw: ${label} failed (${cause}): ${printable}${detail}`))
    })
  })
}

async function readManifest(path: string): Promise<StagedManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as StagedManifest
}

async function writeManifest(path: string, manifest: StagedManifest): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Every staged top-level package name with its version, scoped packages included. */
async function installedPackages(staging: string): Promise<Map<string, string>> {
  const installed = new Map<string, string>()
  const nodeModules = join(staging, 'node_modules')
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue
    const names = entry.name.startsWith('@')
      ? (await readdir(join(nodeModules, entry.name))).map(scope => `${entry.name}/${scope}`)
      : [entry.name]
    for (const name of names) {
      const manifestPath = join(nodeModules, name, 'package.json')
      if (existsSync(manifestPath)) installed.set(name, (await readManifest(manifestPath)).version ?? '0.0.0')
    }
  }
  return installed
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
 * SDK's json-schema peer), as may the sdk's consumer-supplied external peers.
 * @param staging - the deploy target.
 * @param externalPeers - root peers allowed to be absent by design.
 * @returns the missing package names.
 */
async function missingClosurePackages(staging: string, externalPeers: readonly string[]): Promise<string[]> {
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

/** The release pipeline: build, stage, rewrite, pack, smoke, optional publish. */
class DaypawRelease {
  constructor(private readonly cli: ReleaseCli) {}

  /** Build both faces before any deploy: legacy deploy residue breaks later `pnpm run`. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('release-daypaw: skipping build faces (--skip-build)')
      return
    }
    await run('build host face', pnpmBin(), ['run', 'build:lib:host'])
    await run('build client face', pnpmBin(), ['run', 'build:lib:client'])
  }

  /**
   * Deploy one package's closure and return the edit-safe staging path.
   * pnpm deploy hardlinks workspace files into the target, so the editable
   * staging tree is a content copy; the raw deploy target is discarded.
   * @param filter - the deploy root's package name.
   * @param key - short package key used in directory names.
   * @returns the copied staging directory.
   */
  private async deploy(filter: string, key: PackageKey): Promise<string> {
    const raw = join(OUT_DIR, 'staging-raw', key)
    const staging = join(OUT_DIR, 'staging', key)
    for (const dir of [raw, staging]) {
      if (dir === root || root.startsWith(dir + sep)) {
        throw new Error(`release-daypaw: refusing to clear staging dir ${dir}: it contains the repo root.`)
      }
      await rm(dir, { recursive: true, force: true })
    }
    await run(`deploy ${filter}`, pnpmBin(), [
      '--filter',
      filter,
      'deploy',
      '--legacy',
      '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      // The root node-pty patch is unused in the sdk closure.
      '--config.allow-unused-patches=true',
      raw,
    ])
    await cp(raw, staging, { recursive: true, dereference: true })
    await rm(raw, { recursive: true, force: true })
    return staging
  }

  /**
   * Copy each missing workspace or registry package into the staging closure
   * from its repository location, then re-check. Legacy deploy drops
   * transitive and peer-only packages; anything still missing after the
   * restore fails the release.
   * @param staging - the edit-safe staging tree.
   * @param sourceDir - the deploy root's repository directory.
   * @param externalPeers - root peers allowed to be absent by design.
   */
  private async completeClosure(staging: string, sourceDir: string, externalPeers: readonly string[]): Promise<void> {
    for (let round = 0; round < 6; round++) {
      const missing = await missingClosurePackages(staging, externalPeers)
      if (missing.length === 0) {
        console.log(`release-daypaw: closure complete after ${round} restore round(s)`)
        return
      }
      console.log(`release-daypaw: restoring ${missing.length} missing closure package(s): ${missing.join(', ')}`)
      for (const name of missing) {
        const source = await this.locatePackage(name, sourceDir)
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
    const missing = await missingClosurePackages(staging, externalPeers)
    if (missing.length > 0) {
      throw new Error(`release-daypaw: closure still incomplete after restore rounds: ${missing.join(', ')}.`)
    }
  }

  /**
   * Find a package's repository source directory: workspace package dir, the
   * deploy source's node_modules (legacy-deploy hoist residue), or the
   * repo-root resolution paths for external packages.
   * @param name - the package name.
   * @param sourceDir - the deploy root's repository directory.
   * @returns the source directory, or undefined when unknown.
   */
  private async locatePackage(name: string, sourceDir: string): Promise<string | undefined> {
    for (const base of ['packages', 'vendor', 'apps']) {
      const found = await this.findWorkspacePackage(join(root, base), name, 3)
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

  /** Walk a workspace base directory for the package.json declaring `name`. */
  private async findWorkspacePackage(dir: string, name: string, depth: number): Promise<string | undefined> {
    if (depth < 0 || !existsSync(dir)) return undefined
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath) && (await readManifest(manifestPath)).name === name) return dir
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const found = await this.findWorkspacePackage(join(dir, entry.name), name, depth - 1)
      if (found !== undefined) return found
    }
    return undefined
  }

  /**
   * Rewrite `workspace:` ranges to real versions across the staged closure,
   * then patch the root manifest for publication: the CLI bundles its entire
   * closure, the SDK bundles the closure minus its consumer-supplied peers.
   * @param staging - the edit-safe staging tree.
   * @param key - which package is being rewritten.
   */
  private async rewriteManifests(staging: string, key: PackageKey): Promise<void> {
    const installed = await installedPackages(staging)
    const rootManifestPath = join(staging, 'package.json')
    // Consumer-facing peer ranges for the packages the SDK does not bundle,
    // sourced from the SDK's own manifest so there is one home for the ranges.
    const sdkSource = await readManifest(resolve(root, 'packages', 'daypaw', 'sdk', 'package.json'))
    const externalPeerRanges = sdkSource.peerDependencies ?? {}
    const rewriteSpecs = async (manifestPath: string): Promise<void> => {
      const manifest = await readManifest(manifestPath)
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
        const deps = manifest[field]
        if (deps === undefined) continue
        for (const [name, spec] of Object.entries(deps)) {
          if (!spec.startsWith('workspace:')) continue
          // Peer ranges on the consumer-supplied singletons name upstream's
          // published npm releases, not an exact (possibly unpublished)
          // vendored build.
          const externalRange = field === 'peerDependencies' ? externalPeerRanges[name] : undefined
          if (externalRange !== undefined) {
            deps[name] = externalRange
            continue
          }
          const version = installed.get(name) ?? await this.repositoryVersion(name)
          if (version === undefined) {
            throw new Error(`release-daypaw: ${manifestPath}: no version for workspace range on ${name}.`)
          }
          deps[name] = version
        }
      }
      // Workspace-only sections must not leak into published tarballs.
      delete manifest.devDependencies
      await writeManifest(manifestPath, manifest)
    }
    for (const name of installed.keys()) await rewriteSpecs(join(staging, 'node_modules', name, 'package.json'))
    await rewriteSpecs(rootManifestPath)

    const rootManifest = await readManifest(rootManifestPath)
    const bundled = [...installed.keys()].sort()
    if (key === 'cli') {
      // Everything the CLI needs is vendored; peers and dev ranges would only
      // mislead npm at install time.
      delete rootManifest.peerDependencies
      delete rootManifest.devDependencies
    } else {
      delete rootManifest.devDependencies
      // Vendored closure packages become direct dependencies at their staged
      // versions so bundleDependencies keeps them beside the facade.
      const dependencies = rootManifest.dependencies ?? {}
      for (const name of bundled) dependencies[name] = installed.get(name) ?? '0.0.0'
      rootManifest.dependencies = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)))
    }
    rootManifest.bundleDependencies = bundled
    await writeManifest(rootManifestPath, rootManifest)
    console.log(`release-daypaw: ${key}: rewrote ${installed.size} closure manifests; bundleDependencies=${bundled.length}`)
  }

  /** Version of a workspace package absent from this host's staging (platform-optional natives). */
  private async repositoryVersion(name: string): Promise<string | undefined> {
    for (const base of ['packages', 'vendor', 'apps', 'native']) {
      const dir = await this.findWorkspacePackage(join(root, base), name, 3)
      if (dir !== undefined) return (await readManifest(join(dir, 'package.json'))).version
    }
    return undefined
  }

  /** Pack one staged package and return the tarball path inside {@link OUT_DIR}. */
  private async pack(staging: string): Promise<string> {
    await run('npm pack', npmBin(), ['pack', '--pack-destination', OUT_DIR], { cwd: staging })
    const manifest = await readManifest(join(staging, 'package.json'))
    const tarball = join(OUT_DIR, `${(manifest.name ?? '').replace('@', '').replace('/', '-')}-${manifest.version}.tgz`)
    if (!existsSync(tarball)) throw new Error(`release-daypaw: packed tarball ${tarball} is missing.`)
    const megabytes = (await stat(tarball)).size / (1024 * 1024)
    console.log(`release-daypaw: packed ${tarball} (${megabytes.toFixed(1)} MB)`)
    return tarball
  }

  /**
   * Smoke the CLI tarball: clean-prefix global install, then a headless boot
   * without an API key must reach the credential error — proof the bundled
   * plugin closure loads end to end.
   * @param tarball - the packed CLI tarball.
   */
  private async smokeCli(tarball: string): Promise<void> {
    const scratch = await mkdtemp(join(tmpdir(), 'daypaw-cli-smoke-'))
    const prefix = join(scratch, 'prefix')
    await run('cli smoke install', npmBin(), ['install', '--global', '--prefix', prefix, tarball])
    const home = join(scratch, 'dsh-home')
    // Boot from the scratch dir so the repo root .env cannot supply a key,
    // and with DEEPSEEK_API_KEY explicitly absent from the environment.
    const env: Record<string, string | undefined> = {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1',
    }
    delete env.DEEPSEEK_API_KEY
    const bin = join(prefix, 'bin', 'daypaw')
    const output = await run(
      'cli smoke boot',
      bin,
      ['--profile', 'headless', 'release smoke'],
      { cwd: scratch, env, capture: true },
    ).catch((error: unknown) => {
      // The boot must fail at the missing credential; any earlier failure
      // (plugin resolution, profile boot) carries a different message.
      if (error instanceof Error && /no API key|MISSING_CREDENTIAL/.test(error.message)) return error.message
      throw error
    })
    if (!/no API key|MISSING_CREDENTIAL/.test(output)) {
      throw new Error(`release-daypaw: cli smoke boot did not reach the credential check:\n${output}`)
    }
    console.log('release-daypaw: cli smoke reached the no-API-key line (closure boots).')
  }

  /**
   * Smoke the SDK tarball: a registry-installed consumer mounts the engine
   * through the SDK's own `DurableEngine` export, typechecks under
   * `module: nodenext`, and drives one run to a typed result.
   * @param tarball - the packed SDK tarball.
   */
  private async smokeSdk(tarball: string): Promise<void> {
    const consumer = await mkdtemp(join(tmpdir(), 'daypaw-sdk-smoke-'))
    await writeFile(join(consumer, 'package.json'), `${JSON.stringify({
      name: 'daypaw-sdk-smoke',
      private: true,
      type: 'module',
      dependencies: {
        '@daypaw/sdk': `file:${tarball}`,
        '@deepseek-ai/cordis': '~4.0.1',
        '@deepseek-ai/dsh-invariants': '~0.1.0-rc.3',
        'zod': '^4.4.3',
      },
      devDependencies: {
        '@types/node': '^24.13.3',
        'typescript': '^6.0.3',
      },
    }, null, 2)}\n`)
    await writeFile(join(consumer, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        strict: true,
        noImplicitAny: true,
        noEmit: true,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2023',
        skipLibCheck: false,
        types: ['node'],
      },
      include: ['main.ts'],
    }, null, 2)}\n`)
    await writeFile(join(consumer, 'main.ts'), `import { Context } from '@deepseek-ai/cordis'
import { bind, defineWorkflow, DurableEngine } from '@daypaw/sdk'
import { z } from 'zod'

const demo = defineWorkflow({
  name: 'consumer-demo',
  version: '0.1.0',
  input: z.object({ seed: z.number() }),
  output: z.object({ total: z.number() }),
  body: async (ctx, input) => {
    const step1 = await ctx.step('one', async () => input.seed + 1)
    const step2 = await ctx.step('two', async () => step1 * 10)
    return { total: step2 }
  },
})

const ctx = new Context()
await ctx.plugin(DurableEngine, { path: ':memory:', pollMs: 50 })
try {
  const workflow = await bind(demo, ctx.durable)
  const handle = await workflow.run({ seed: 4 })
  console.log('RESULT', JSON.stringify(await handle.result), 'runId', handle.id)
} finally {
  await ctx.fiber.dispose()
}
`)
    await run('sdk smoke install', npmBin(), ['install'], { cwd: consumer })
    await run('sdk smoke typecheck', npmBin(), ['exec', 'tsc', '--', '-p', '.'], { cwd: consumer })
    const output = await run('sdk smoke run', process.execPath, ['main.ts'], { cwd: consumer, capture: true })
    if (!/RESULT \{"total":50\}/.test(output)) {
      throw new Error(`release-daypaw: sdk smoke run did not produce the typed result:\n${output}`)
    }
    console.log('release-daypaw: sdk smoke consumer typed and ran (RESULT {"total":50}).')
  }

  /** Deploy, complete, rewrite, and pack both packages; returns the tarballs by key. */
  async packAll(): Promise<Map<PackageKey, string>> {
    const tarballs = new Map<PackageKey, string>()
    for (const pkg of PACKAGES) {
      const staging = await this.deploy(pkg.filter, pkg.key)
      await this.completeClosure(staging, resolve(root, 'packages', 'daypaw', pkg.key), pkg.externalPeers)
      await this.rewriteManifests(staging, pkg.key)
      tarballs.set(pkg.key, await this.pack(staging))
      // The tarball is the artifact; spent staging trees carry README pairs
      // that repo documentation gates would otherwise scan.
      await rm(staging, { recursive: true, force: true })
    }
    return tarballs
  }

  /**
   * Run the per-tarball smokes unless skipped.
   * @param tarballs - packed tarballs by package key.
   */
  async smoke(tarballs: Map<PackageKey, string>): Promise<void> {
    if (this.cli.skipSmoke) {
      console.log('release-daypaw: skipping smokes (--skip-smoke)')
      return
    }
    await this.smokeCli(tarballs.get('cli') ?? '')
    await this.smokeSdk(tarballs.get('sdk') ?? '')
  }

  /**
   * Publish both tarballs when `--publish` was passed.
   * @param tarballs - packed tarballs by package key.
   */
  async publish(tarballs: Map<PackageKey, string>): Promise<void> {
    if (!this.cli.publish) return
    for (const tarball of tarballs.values()) {
      await run(`npm publish ${basename(tarball)}`, npmBin(), ['publish', tarball, '--access', 'public'])
    }
  }
}

async function main(): Promise<void> {
  const cli = ReleaseCli.parse(process.argv.slice(2))
  const release = new DaypawRelease(cli)
  await release.build()
  const tarballs = await release.packAll()
  await release.smoke(tarballs)
  await release.publish(tarballs)
}

await main()
