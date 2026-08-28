/**
 * First-run seeding and launcher-argv defaulting for the `daypaw` bin:
 * materialize the `daypaw` profile from the shipped product-shell template,
 * migrate a profile seeded by the prior CLI to it, and keep the flat
 * installation fallback healed for the daypaw family. Seeding runs on every
 * launch before the vendored dsh bin, so every subcommand sees the same
 * profile; it is idempotent and never overwrites an existing file — user edits
 * to the seeded profile stick.
 *
 * The daypaw template does not live in the dsh launcher's `PROFILE_TEMPLATES`
 * (an upstream file): the template ships inside this package and this module
 * applies it, so seeding a new profile needs no upstream runtime edit
 * (ADR 0011). The engine row is seeded into the profile's own
 * `cordis.patch.yml` — the product composition rides the user layer by
 * design, so a customer can retune or remove it like any other override.
 *
 * The launcher's own fallback heal anchors on the dsh app manifest, whose
 * closure the daypaw family is not part of, so this module heals the same
 * flat directory from THIS package's manifest: every `@daypaw` row the
 * composed tree names (engine, the shell bundle, the roster packages) then
 * resolves from any profile through Node's ordinary parent-walk, and a pnpm
 * operation inside one profile cannot prune the links.
 * @module @daypaw/cli
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  healProfilesModuleFallback,
  initProfile,
  PROFILE_PATCH_FILENAME,
  readProfileManifest,
  resolveProfileDir,
  writeProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** The profile the daypaw CLI seeds on first run. */
export const DAYPAW_PROFILE_NAME = 'daypaw'

/** Bundle layers of the seeded profile: the shared core plus the product shell. */
const DAYPAW_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@daypaw/web-app'] as const

/**
 * The bundle tuple the prior CLI seeded (the one-shot headless runner).
 * An exact match migrates to the current template; any deviation is
 * user-owned and stays untouched.
 */
const PREVIOUS_DAYPAW_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] as const

/**
 * The seeded user patch layer: the single-row durable-engine recipe of
 * docs/spec/00-overview.md §3. The relative ledger path resolves against the
 * directory `daypaw` runs from, so each working directory keeps its own ledger.
 */
const DAYPAW_PROFILE_PATCH = `# The daypaw CLI seeded this file on first run; it is your patch layer,
# applied after every bundle layer. The daypaw-engine row below is the product
# composition — retune or remove it like any other override. The CLI rewrites
# this file only when the whole profile is missing.
- insert:
    - id: daypaw-engine
      name: '@daypaw/engine'
      config:
        # Relative to the directory you run \`daypaw\` from.
        path: daypaw/ledger.db
`

/** This package's manifest: the heal anchor whose dependency closure is the delivered installation. */
const CLI_MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url))

/**
 * The starter agent the CLI seeds into the workspace on first run (ruling
 * #65, ADR 0012): a steerable general-purpose assistant in the recommended
 * starter input shape, so the shell's new-task dialog has a roster before
 * the user authors anything.
 */
const STARTER_AGENT_FILE = 'daypaw/agents/starter-assistant.mjs'

/** The starter agent's source; the injected-factory form every agents file takes. */
const STARTER_AGENT_SOURCE = `// daypaw starter agent — seeded on first run, yours to edit (the CLI never
// overwrites this file). Agents files import nothing: the loader injects the
// SDK namespace into the default-exported factory.
export default ({ defineAgent, z }) => defineAgent({
  name: 'starter-assistant',
  version: '1',
  display: {
    title: '通用助手',
    description: '通用任务助手：接收一段任务描述，完成后调用 submit 提交结论；支持运行中追问。',
  },
  input: z.object({ task: z.string() }),
  output: z.string(),
  prompt: [{
    name: 'starter-persona',
    order: 10,
    text: 'You are a general-purpose assistant. Work on the task the user gives you, then call the submit tool exactly once with the final result as a plain string. If the task cannot be completed, submit a short explanation of what blocked it.',
  }],
  tools: [],
  model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  maxTurns: 16,
  steerable: true,
})
`

/**
 * Seed the starter agent into one workspace: write the file only when it is
 * absent, so every launch is idempotent and user edits stick. The workspace
 * keeps its own roster beside its own ledger (ruling #65 §2).
 * @param dir - the workspace directory `daypaw` runs from; defaults to the
 * process working directory.
 */
export function seedStarterAgent(dir: string = process.cwd()): void {
  const file = join(dir, STARTER_AGENT_FILE)
  if (existsSync(file)) return
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, STARTER_AGENT_SOURCE)
}

/** Whether two bundle lists hold the same values in the same order. */
function sameBundles(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * Migrate a profile seeded by the prior CLI to the current bundle template
 * while preserving every other manifest field. Any other list — including a
 * user-edited copy of the old tuple — is user-owned and left unchanged.
 * @param dir - the daypaw profile directory.
 */
function migrateShippedBundles(dir: string): void {
  const manifest = readProfileManifest(DAYPAW_PROFILE_NAME, dir)
  const bundles = manifest.dsh?.profile?.bundles
  if (bundles === undefined || !sameBundles(bundles, PREVIOUS_DAYPAW_PROFILE_BUNDLES)) return
  writeProfileManifest(dir, {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles: [...DAYPAW_PROFILE_BUNDLES] },
    },
  })
}

/**
 * Seed the daypaw profile under the Harness home: on first run, write the
 * template's user patch layer, manifest, and pnpm settings; on every run,
 * migrate a prior CLI's exact shipped bundle tuple and heal the flat
 * installation fallback from this package's dependency closure. Existing
 * files are never touched apart from the bundle migration, so re-seeding is
 * a no-op on a current profile.
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 */
export async function seedDaypawProfile(home: string = resolveDshHome()): Promise<void> {
  const dir = resolveProfileDir(DAYPAW_PROFILE_NAME, home)
  if (!existsSync(join(dir, 'package.json'))) {
    mkdirSync(dir, { recursive: true })
    // Written before initProfile so its never-overwrite rule keeps this exact
    // content; initProfile then adds the manifest and pnpm settings.
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), DAYPAW_PROFILE_PATCH)
    initProfile(dir, DAYPAW_PROFILE_BUNDLES)
  } else {
    migrateShippedBundles(dir)
  }
  await healProfilesModuleFallback({ installAnchor: CLI_MANIFEST, home })
}

/**
 * Default the vendored dsh launcher's profile for the daypaw bin. The product
 * surface is the shell, so a bare `daypaw` boots the daypaw profile and its
 * app arguments (including `-h`, which the shell app owns) reach that tree;
 * `plugin` manages the daypaw profile when the invocation names none. An
 * invocation that names a profile — or uses the vendored `web` alias, which
 * owns its own grammar — passes through untouched, so the full dsh launcher
 * grammar stays reachable for expert use. Launcher flags come first in the
 * vendored grammar, so a `--profile` appearing after an unknown token is an
 * app argument and still suppresses the default; putting launcher flags first
 * is the documented form.
 * @param argv - the raw arguments after `daypaw`.
 * @returns the launcher argv to boot.
 */
export function withDefaultProfile(argv: readonly string[]): string[] {
  const namesProfile = argv.some(argument => argument === '--profile' || argument.startsWith('--profile='))
  if (namesProfile || argv[0] === 'web') return [...argv]
  if (argv[0] === 'plugin') return ['plugin', '--profile', DAYPAW_PROFILE_NAME, ...argv.slice(1)]
  return ['--profile', DAYPAW_PROFILE_NAME, ...argv]
}
