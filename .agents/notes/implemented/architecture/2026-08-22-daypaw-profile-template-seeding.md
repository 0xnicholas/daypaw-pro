# Agent Note: daypaw profile template — seeded by the CLI bin, not the upstream template registry

Status: implemented

English | [中文](2026-08-22-daypaw-profile-template-seeding.zh.md)

## Problem

ADR 0011 makes the `daypaw` profile's first-run self-initialization the last blocker of the first public release, and spec 00 §3 fixes the composition face: the base bundle plus a one-row `@daypaw/engine` recipe (`path: daypaw/ledger.db`). The dsh launcher auto-initializes only the two profiles hardcoded in `PROFILE_TEMPLATES` (`packages/boot/app-boot/src/profile.ts`, an upstream file), so the daypaw template needed a home: a core touch on that registry, or a seam route owned by `@daypaw/cli`. Two mechanical facts constrained the choice: the launcher-healed module fallback mirrors only the dsh app's dependency closure, so `@daypaw/engine` is not Loader-resolvable from any profile without extra wiring; and the daypaw bin (`bin.mjs`) already delegates to the vendored dsh bin, giving the CLI package a pre-boot hook it fully owns.

## Decision

- **The template ships inside `@daypaw/cli` and the bin seeds it** (`src/index.ts`, built to `lib/index.js`): before importing the dsh bin, `bin.mjs` runs `seedDaypawProfile()`, which materializes `$DSH_HOME/profiles/daypaw` on first run — manifest bundles `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']` via the launcher's own `initProfile`, plus the engine recipe as an `- insert:` row written into the profile's `cordis.patch.yml` first so the initializer's never-overwrite rule preserves it. `PROFILE_TEMPLATES` keeps its two upstream entries untouched, keeping the template decision inside the delivery line's zero-core-touch property (ADR 0011 §1); the engine-link heal later became the one registered exception, sharing the launcher's `ensureSymlink` export ([sharing note](2026-08-26-ensure-symlink-shared-from-app-boot.md)).
- **The engine row rides the user patch layer by design**: the composition is one row the customer can retune or remove in place, and seeding never rewrites an existing profile — a deleted row stays deleted.
- **The engine link is healed, not installed**: every launch symlinks the closure-bundled `@daypaw/engine` into the profile's `node_modules` (wrong or dangling links are re-pointed; a real directory fails loud) through the launcher's own exported `ensureSymlink`. No pnpm install runs at seed time, keeping the first run offline.
- **Coverage**: `packages/daypaw/cli/tests/seed-profile.spec.ts` boots the seeded template through a real Loader composition (seed → `loadProfile` → `composeEntries` → the composed engine row mounts and completes a run), and the release smoke boots the packed tarball with `--profile daypaw` from a fresh `DSH_HOME` to the missing-credential line, asserting the seeded profile and the ledger at the launch cwd. [The delivery note](../process/2026-08-22-daypaw-npm-self-contained-delivery.md) owns the packaging pipeline.

## Alternatives considered

- **Adding `daypaw` to `PROFILE_TEMPLATES` (core touch)** — rejected: it would have been the first edit to a shipped upstream runtime file (every core touch registered at that point was repo configuration or tooling), it broke the delivery line's zero-core-touch claim, and it became a permanent upstream-sync replay item. Its only extra payoff — source-state `pnpm dsh --profile daypaw` auto-initializing — was outside the release acceptance. (The heal later took the one registered runtime-source exception — see the sharing note above.)
- **`@daypaw/engine` as a self-bundle** (`dsh.bundle.patch` on the engine, the template naming it in the profile's bundles) — rejected: the template still needs a seeder or a registry entry to name the bundle list, and the product row moves out of the customer's reach into a package patch; the user-layer seed keeps the one-row recipe visible and editable where overrides already live.
- **Shipping a static `profile-template/` directory copied at seed time** — rejected: `initProfile` already owns the manifest and pnpm-settings content; duplicating them in a second, static home invites drift. Only the patch layer is daypaw-owned content, so it is the one seeded string.

## Consequences

- "Profile template" gains a second home: upstream's `PROFILE_TEMPLATES` for web/headless, `@daypaw/cli`'s seeder for daypaw. spec 00 §3 records the split, and the cli README's limitations carry the user-visible consequence (source-state `pnpm dsh --profile daypaw` does not auto-initialize).
- Seeding runs on every `daypaw` invocation regardless of subcommand, so `daypaw plugin --profile daypaw …` and config dumps see the same seeded profile; the cost is one stat per launch plus the link heal.
- A `daypaw plugin` pnpm operation may prune the unregistered engine symlink from the profile's `node_modules`; the next launch re-heals it. The engine is deliberately absent from the profile manifest's `dependencies`: pnpm would try to fetch the unpublished package from the registry.
- Renames of the engine package or its config keys must update the seeded template in the same change; the REAL-composition test pins the row's id, name, and config.
