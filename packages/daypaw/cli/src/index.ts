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
import { join } from 'node:path'
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
