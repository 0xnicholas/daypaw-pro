/**
 * First-run seeding for the `daypaw` bin: materialize the `daypaw` profile
 * from the shipped template and keep the profile-local `@daypaw/engine` link
 * healed. Seeding runs on every launch before the vendored dsh bin, so every
 * subcommand (`--profile daypaw`, `plugin --profile daypaw`, config dumps)
 * sees the same profile; it is idempotent and never overwrites an existing
 * file — user edits to the seeded profile stick.
 *
 * The daypaw template does not live in the dsh launcher's `PROFILE_TEMPLATES`
 * (an upstream file): the template ships inside this package and this module
 * applies it, so seeding a new profile needs no upstream runtime edit
 * (ADR 0011). The engine row is seeded into the profile's own
 * `cordis.patch.yml` — the product composition rides the user layer by
 * design, so a customer can retune or remove it like any other override.
 *
 * `@daypaw/engine` is not reachable from the launcher-healed module fallback
 * (that fallback mirrors the dsh app's dependency closure, which the daypaw
 * family is not part of), so the seed links the bundled engine package into
 * the profile's own `node_modules`; the link is re-healed on every launch
 * through the launcher's own `ensureSymlink`.
 * @module @daypaw/cli
 */

import {
  existsSync, mkdirSync, writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { ensureSymlink, initProfile, PROFILE_PATCH_FILENAME, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** The profile the daypaw CLI seeds on first run. */
export const DAYPAW_PROFILE_NAME = 'daypaw'

/** Bundle layers of the seeded profile: the shared core plus the one-shot runner. */
const DAYPAW_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] as const

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

/** Absolute path of the `@daypaw/engine` package bundled beside this CLI. */
function bundledEngineDir(): string {
  // Anchor on this package's own manifest (src/ and lib/ both sit one level
  // under the package root): the engine is a declared dependency, so Node's
  // parent walk finds it in both the workspace and the packed tarball.
  const anchor = new URL('../package.json', import.meta.url)
  return dirname(createRequire(anchor).resolve('@daypaw/engine/package.json'))
}

/**
 * Ensure `profileDir/node_modules/@daypaw/engine` is a symlink to the bundled
 * engine through the shared `ensureSymlink` heal: a wrong or dangling link is
 * re-pointed, a real directory throws, and losing the concurrent first-run
 * race to an identical link is success.
 * @param profileDir - the daypaw profile directory.
 */
function ensureEngineLink(profileDir: string): void {
  const target = bundledEngineDir()
  const link = join(profileDir, 'node_modules', '@daypaw', 'engine')
  mkdirSync(dirname(link), { recursive: true })
  ensureSymlink('daypaw', link, target, "the profile's engine link")
}

/**
 * Seed the daypaw profile under the Harness home: on first run, write the
 * template's user patch layer, manifest, and pnpm settings; on every run,
 * heal the profile-local engine link. An existing profile's files are never
 * touched, so re-seeding is a no-op apart from the link heal.
 * @param home - the Harness home; defaults to {@link resolveDshHome}.
 */
export function seedDaypawProfile(home: string = resolveDshHome()): void {
  const dir = resolveProfileDir(DAYPAW_PROFILE_NAME, home)
  if (!existsSync(join(dir, 'package.json'))) {
    mkdirSync(dir, { recursive: true })
    // Written before initProfile so its never-overwrite rule keeps this exact
    // content; initProfile then adds the manifest and pnpm settings.
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), DAYPAW_PROFILE_PATCH)
    initProfile(dir, DAYPAW_PROFILE_BUNDLES)
  }
  ensureEngineLink(dir)
}
