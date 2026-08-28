import { afterEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, loadProfile } from '@deepseek-ai/dsh-app-boot'
import DurableEngine from '@daypaw/engine'
import { DAYPAW_PROFILE_NAME, seedDaypawProfile, withDefaultProfile } from '../src/index.ts'

const CLI_MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url))
/** The repo's dsh app manifest: the resolution anchor the seeded profile's bundles resolve from. */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../../apps/cli/package.json', import.meta.url))

/** The tuple the prior CLI seeded; the migration tests hand-write it exactly. */
const PREVIOUS_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] as const

let home: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

async function seed(): Promise<string> {
  home = await mkdtemp(join(tmpdir(), 'daypaw-cli-seed-'))
  await seedDaypawProfile(home)
  return join(home, 'profiles', DAYPAW_PROFILE_NAME)
}

/** The launcher-style flat fallback the seed heals the daypaw family into. */
function fallbackLink(name: string): string {
  return join(home!, 'profiles', 'node_modules', ...name.split('/'))
}

/** The manifest fields profile staging writes and the assertions read back. */
interface SeededManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

/** Stage an existing daypaw profile in a fresh home carrying `manifest`. */
async function stageProfile(manifest: SeededManifest): Promise<string> {
  home = await mkdtemp(join(tmpdir(), 'daypaw-cli-seed-'))
  const dir = join(home, 'profiles', DAYPAW_PROFILE_NAME)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
  return dir
}

const readFileUtf8 = (path: string): Promise<string> => readFile(path, 'utf8')
const isSymlink = async (path: string): Promise<boolean> => (await lstat(path)).isSymbolicLink()

describe('seedDaypawProfile', () => {
  it('materializes the product-shell profile template and heals the family fallback on first run', async () => {
    const dir = await seed()

    const manifest = JSON.parse(await readFileUtf8(join(dir, 'package.json'))) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@daypaw/web-app'])

    const patch = await readFileUtf8(join(dir, 'cordis.patch.yml'))
    expect(patch).toContain('id: daypaw-engine')
    expect(patch).toContain("name: '@daypaw/engine'")
    expect(patch).toContain('path: daypaw/ledger.db')
    expect(existsSync(join(dir, 'pnpm-workspace.yaml'))).toBe(true)

    // The engine row, the shell bundle, and every roster package the composed
    // tree names resolve through the flat installation fallback, healed from
    // this CLI package's own dependency closure.
    for (const name of [
      '@daypaw/engine', '@daypaw/web-app', '@daypaw/web-frontend',
      '@daypaw/approval-history', '@daypaw/ui-inbox', '@daypaw/ui-tasks',
      '@daypaw/ui-settings', '@daypaw/ui-agents',
    ]) {
      const link = fallbackLink(name)
      expect(await isSymlink(link), name).toBe(true)
    }
    // The link lands on the anchor probe's directory (a pnpm node_modules
    // entry in the workspace, a real directory in the packed tarball); what
    // must hold in both layouts is that it resolves to this CLI's engine.
    const engineDir = dirname(createRequire(CLI_MANIFEST).resolve('@daypaw/engine/package.json'))
    expect(await realpath(fallbackLink('@daypaw/engine'))).toBe(await realpath(engineDir))
    // The profile-local engine link of the prior seed mechanism is gone: the
    // fallback link is the one resolution path, and pnpm runs inside the
    // profile cannot prune it.
    expect(existsSync(join(dir, 'node_modules', '@daypaw', 'engine'))).toBe(false)
  })

  it('never overwrites an initialized profile, and re-heals a removed fallback link', async () => {
    const dir = await seed()
    const patchPath = join(dir, 'cordis.patch.yml')
    await writeFile(patchPath, '# user edits\n[]\n')
    const manifestPath = join(dir, 'package.json')
    const manifest = await readFileUtf8(manifestPath)
    await rm(fallbackLink('@daypaw/engine'))

    await seedDaypawProfile(home)

    expect(await readFileUtf8(patchPath)).toBe('# user edits\n[]\n')
    expect(await readFileUtf8(manifestPath)).toBe(manifest)
    expect(await isSymlink(fallbackLink('@daypaw/engine'))).toBe(true)
  })

  it('migrates the exact previously-shipped bundle tuple to the shell template, preserving the rest', async () => {
    const dir = await stageProfile({
      name: 'dsh-profile-daypaw',
      private: true,
      dependencies: { 'some-plugin': '^1.0.0' },
      dsh: { profile: { bundles: [...PREVIOUS_BUNDLES] } },
    })

    await seedDaypawProfile(home)

    const manifest = JSON.parse(await readFileUtf8(join(dir, 'package.json'))) as SeededManifest
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@daypaw/web-app'])
    expect(manifest.name).toBe('dsh-profile-daypaw')
    expect(manifest.dependencies).toEqual({ 'some-plugin': '^1.0.0' })
  })

  it('upgrades a prior CLI install: migrates the tuple and leaves the orphaned profile-local link to the fallback', async () => {
    const dir = await stageProfile({
      name: 'dsh-profile-daypaw',
      dsh: { profile: { bundles: [...PREVIOUS_BUNDLES] } },
    })
    await mkdir(join(dir, 'node_modules', '@daypaw'), { recursive: true })
    // A prior install's profile-local engine link: dangling after that
    // install is removed. Node treats the dangling entry as absent and the
    // parent walk continues to the healed fallback.
    await symlink(join(home!, 'removed-prefix', 'engine'), join(dir, 'node_modules', '@daypaw', 'engine'), 'junction')

    await seedDaypawProfile(home)

    const manifest = JSON.parse(await readFileUtf8(join(dir, 'package.json'))) as SeededManifest
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@daypaw/web-app'])
    expect(await isSymlink(fallbackLink('@daypaw/engine'))).toBe(true)
    expect(await realpath(fallbackLink('@daypaw/engine'))).toBe(
      await realpath(dirname(createRequire(CLI_MANIFEST).resolve('@daypaw/engine/package.json'))),
    )
  })

  it('leaves a user-owned bundle list untouched', async () => {
    const userOwned = [...PREVIOUS_BUNDLES, 'custom-bundle']
    const dir = await stageProfile({
      name: 'dsh-profile-daypaw',
      dsh: { profile: { bundles: userOwned } },
    })

    await seedDaypawProfile(home)

    const manifest = JSON.parse(await readFileUtf8(join(dir, 'package.json'))) as SeededManifest
    expect(manifest.dsh?.profile?.bundles).toEqual(userOwned)
  })
})

describe('withDefaultProfile', () => {
  it('defaults a bare invocation to the daypaw profile ahead of the app arguments', () => {
    expect(withDefaultProfile([])).toEqual(['--profile', 'daypaw'])
    expect(withDefaultProfile(['--port', '0'])).toEqual(['--profile', 'daypaw', '--port', '0'])
    // The shell app owns help: the injected profile hands -h to it.
    expect(withDefaultProfile(['-h'])).toEqual(['--profile', 'daypaw', '-h'])
  })

  it('injects the default profile into a bare plugin subcommand', () => {
    expect(withDefaultProfile(['plugin', 'add', 'some-plugin']))
      .toEqual(['plugin', '--profile', 'daypaw', 'add', 'some-plugin'])
  })

  it('passes an invocation that names a profile, or the upstream web alias, through untouched', () => {
    expect(withDefaultProfile(['--profile', 'web', '--port', '9'])).toEqual(['--profile', 'web', '--port', '9'])
    expect(withDefaultProfile(['--profile=headless', 'task'])).toEqual(['--profile=headless', 'task'])
    expect(withDefaultProfile(['plugin', '--profile', 'tui', 'add', 'x']))
      .toEqual(['plugin', '--profile', 'tui', 'add', 'x'])
    expect(withDefaultProfile(['web', '--port', '9'])).toEqual(['web', '--port', '9'])
  })
})

describe('seeded daypaw profile through a real Loader composition', () => {
  it('composes the engine row and the shell bundle rows, and mounts the engine', async () => {
    const dir = await seed()
    const profile = loadProfile('daypaw', DAYPAW_PROFILE_NAME, INSTALL_ANCHOR, home)
    expect(profile.layers.map(layer => layer.packageName))
      .toEqual(['@deepseek-ai/dsh-base', '@daypaw/web-app'])

    const rows = composeEntries([profile.layers.flatMap(layer => layer.patches), profile.patches])
    const rowIds = new Map(rows.map(row => [row.id, row.name]))
    expect(rowIds.get('web-runtime')).toBe('@daypaw/web-app')
    expect(rowIds.get('web-startup')).toBe('@daypaw/web-app/startup')
    expect(rowIds.get('webserver')).toBe('@deepseek-ai/dsh-host-webserver')
    expect(rowIds.get('modules')).toBe('@deepseek-ai/dsh-client-modules')

    const engineRows = rows.filter(row => row.id === 'daypaw-engine')
    expect(engineRows).toHaveLength(1)
    expect(engineRows[0]?.name).toBe('@daypaw/engine')
    expect(engineRows[0]?.config).toEqual({ path: 'daypaw/ledger.db' })

    // Mount the engine row through a real Loader (the whole shell roster is
    // exercised by the web snapshot lanes; here the engine row's mount proves
    // the seeded user layer rides the composed tree). The ledger path is
    // redirected into the temp home: the row's relative path resolves against
    // the process cwd, which a test must not pollute.
    context = new Context()
    context.baseUrl = pathToFileURL(dir).href + '/'
    await context.plugin(Loader)
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@daypaw/engine') return DurableEngine
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: '@daypaw/engine',
      config: { path: join(home!, 'ledger.db'), pollMs: 10 },
    })
    await context.loader.await()

    const engine = context.durable
    expect(engine).toBeInstanceOf(DurableEngine)
    const def = {
      kind: 'workflow' as const,
      name: 'seeded-profile-demo',
      version: '1',
      body: async (run: { step<T>(name: string, fn: () => Promise<T>): Promise<T> }) =>
        (await run.step('only', async () => 'seeded-ok')),
    }
    await engine.register(def)
    const handle = await engine.run(def, null, { runId: 'seeded-1' })
    await expect(handle.result).resolves.toBe('seeded-ok')
  })
})
