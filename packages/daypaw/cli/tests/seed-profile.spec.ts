import { afterEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, loadProfile } from '@deepseek-ai/dsh-app-boot'
import DurableEngine from '@daypaw/engine'
import { DAYPAW_PROFILE_NAME, seedDaypawProfile } from '../src/index.ts'

const CLI_MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url))
/** The repo's dsh app manifest: the resolution anchor the seeded profile's bundles resolve from. */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../../apps/cli/package.json', import.meta.url))

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
  seedDaypawProfile(home)
  return join(home, 'profiles', DAYPAW_PROFILE_NAME)
}

/** The engine directory this CLI's own dependency closure resolves. */
function expectedEngineDir(): string {
  return dirname(createRequire(CLI_MANIFEST).resolve('@daypaw/engine/package.json'))
}

describe('seedDaypawProfile', () => {
  it('materializes the daypaw profile template and engine link on first run', async () => {
    const dir = await seed()

    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'])

    const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('id: daypaw-engine')
    expect(patch).toContain("name: '@daypaw/engine'")
    expect(patch).toContain('path: daypaw/ledger.db')

    await lstat(join(dir, 'pnpm-workspace.yaml'))
    const link = join(dir, 'node_modules', '@daypaw', 'engine')
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readlink(link)).toBe(expectedEngineDir())
  })

  it('never overwrites an initialized profile, and re-heals a removed engine link', async () => {
    const dir = await seed()
    const patchPath = join(dir, 'cordis.patch.yml')
    await writeFile(patchPath, '# user edits\n[]\n')
    const manifestPath = join(dir, 'package.json')
    const manifest = await readFile(manifestPath, 'utf8')
    await rm(join(dir, 'node_modules', '@daypaw', 'engine'))

    seedDaypawProfile(home)

    expect(await readFile(patchPath, 'utf8')).toBe('# user edits\n[]\n')
    expect(await readFile(manifestPath, 'utf8')).toBe(manifest)
    expect(await readlink(join(dir, 'node_modules', '@daypaw', 'engine'))).toBe(expectedEngineDir())
  })

  it('throws when the engine link path holds a real directory', async () => {
    const dir = await seed()
    const link = join(dir, 'node_modules', '@daypaw', 'engine')
    await rm(link)
    await mkdir(link, { recursive: true })
    await writeFile(join(link, 'placeholder'), '')

    expect(() => { seedDaypawProfile(home) }).toThrow(/exists and is not a symlink/)
  })
})

describe('seeded daypaw profile through a real Loader composition', () => {
  it('composes the engine row from the shipped layers and mounts it', async () => {
    const dir = await seed()
    const profile = loadProfile('daypaw', DAYPAW_PROFILE_NAME, INSTALL_ANCHOR, home)
    const rows = composeEntries([profile.layers.flatMap(layer => layer.patches), profile.patches])

    const engineRows = rows.filter(row => row.id === 'daypaw-engine')
    expect(engineRows).toHaveLength(1)
    expect(engineRows[0]?.name).toBe('@daypaw/engine')
    expect(engineRows[0]?.config).toEqual({ path: 'daypaw/ledger.db' })

    // Mount the composed row through a real Loader. The ledger path is
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
