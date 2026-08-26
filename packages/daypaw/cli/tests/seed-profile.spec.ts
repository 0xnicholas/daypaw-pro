import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, loadProfile } from '@deepseek-ai/dsh-app-boot'
import DurableEngine from '@daypaw/engine'
import { DAYPAW_PROFILE_NAME, seedDaypawProfile } from '../src/index.ts'

// The concurrent-first-run race (symlinkSync EEXIST) cannot be staged with a
// real filesystem deterministically; the mock spreads the real module so only
// the planted call is intercepted.
const hoisted = vi.hoisted(() => ({ realFs: undefined as unknown as typeof import('node:fs') }))
vi.mock('node:fs', async (importOriginal) => {
  hoisted.realFs = await importOriginal<typeof import('node:fs')>()
  return { ...hoisted.realFs, symlinkSync: vi.fn(hoisted.realFs.symlinkSync) }
})

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

    expect(() => { seedDaypawProfile(home) }).toThrow(
      `daypaw: ${link} exists and is not a symlink; remove it so daypaw can manage the profile's engine link`,
    )
  })

  it('re-points a stale engine link at the bundled engine', async () => {
    const dir = await seed()
    const link = join(dir, 'node_modules', '@daypaw', 'engine')
    await rm(link)
    await symlink(dir, link, 'junction')

    seedDaypawProfile(home)

    expect(await readlink(link)).toBe(expectedEngineDir())
  })

  it('leaves a healthy engine link untouched on re-seed', async () => {
    const dir = await seed()
    const link = join(dir, 'node_modules', '@daypaw', 'engine')
    vi.mocked(fs.symlinkSync).mockClear()

    seedDaypawProfile(home)

    expect(vi.mocked(fs.symlinkSync)).not.toHaveBeenCalled()
    expect(await readlink(link)).toBe(expectedEngineDir())
  })

  it('rethrows a non-EEXIST link failure', async () => {
    const dir = await seed()
    await rm(join(dir, 'node_modules', '@daypaw', 'engine'))
    vi.mocked(fs.symlinkSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    })

    expect(() => { seedDaypawProfile(home) }).toThrow(/EACCES/)
  })

  it('accepts losing the link race to an identical concurrent link', async () => {
    const dir = await seed()
    const link = join(dir, 'node_modules', '@daypaw', 'engine')
    await rm(link)
    vi.mocked(fs.symlinkSync).mockImplementationOnce((target, path, type) => {
      hoisted.realFs.symlinkSync(target, path, type)
      throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
    })

    expect(() => { seedDaypawProfile(home) }).not.toThrow()
    expect(await readlink(link)).toBe(expectedEngineDir())
  })

  it('rethrows the race loss when the winning path is not a symlink', async () => {
    const dir = await seed()
    await rm(join(dir, 'node_modules', '@daypaw', 'engine'))
    vi.mocked(fs.symlinkSync).mockImplementationOnce((_target, path) => {
      hoisted.realFs.mkdirSync(path, { recursive: true })
      throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
    })

    expect(() => { seedDaypawProfile(home) }).toThrow(/EEXIST/)
  })

  it('rethrows the race loss when the winning link points elsewhere', async () => {
    const dir = await seed()
    const link = join(dir, 'node_modules', '@daypaw', 'engine')
    await rm(link)
    vi.mocked(fs.symlinkSync).mockImplementationOnce((_target, path, type) => {
      hoisted.realFs.symlinkSync(dir, path, type)
      throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
    })

    expect(() => { seedDaypawProfile(home) }).toThrow(/EEXIST/)
    expect(await readlink(link)).toBe(dir)
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
