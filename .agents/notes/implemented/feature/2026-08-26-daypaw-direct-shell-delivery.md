# Agent Note: daypaw direct shell delivery — argv defaulting, bundle migration, closure heal, dist in tarball

Status: implemented

English | [中文](2026-08-26-daypaw-direct-shell-delivery.zh.md)

## Problem

Issue #62 turns the `daypaw` command into the product shell's front door (spec 05 §4): a bare `daypaw` must boot the browser shell from the installed tarball, install-time builds nothing. Four gaps stood between the #54 scaffold and that acceptance. The vendored launcher grammar requires `--profile <name>`, so bare `daypaw` errored; the seeded profile carried the one-shot headless tuple, not the shell bundle; the launcher's installation fallback heals only the dsh app's closure, so every `@daypaw` row the shell tree names (`@daypaw/engine`, the `@daypaw/web-app` glue and its `/startup`, the roster packages `modules` resolves through `createRequire(ctx.baseUrl)` from the profile directory) had no resolution path in a real install; and the frontend dist was a build-time product the release pipeline never built or packed.

## Decision

- **A fork-owned argv adapter, not an upstream launcher seam.** `withDefaultProfile(argv)` in `@daypaw/cli` maps a bare invocation (and a bare `plugin` subcommand) to `--profile daypaw` ahead of the app arguments; an invocation that names a `--profile`, or uses the vendored `web` alias (upstream web profile, own grammar), passes through untouched, so the full dsh launcher grammar stays reachable. `bin.mjs` rewrites `process.argv` before importing the dsh bin. A default-profile env seam in `apps/cli/src/args.ts` would have been a new upstream core touch for pure fork UX; the adapter duplicates no grammar (it inspects three tokens: a `--profile` flag, `web`, `plugin`) and its mapping is pinned by spec.
- **The seeded tuple becomes the shell composition, with exact-tuple migration.** `DAYPAW_PROFILE_BUNDLES` is now `['@deepseek-ai/dsh-base', '@daypaw/web-app']`; a profile whose bundle list still equals the previously shipped headless tuple exactly migrates to it with every other manifest field preserved, mirroring the launcher's own `normalizeShippedProfile` precedent but owned by the fork CLI. Any deviation is user-owned and untouched.
- **One heal mechanism: the CLI anchors the launcher's own fallback heal.** The seed calls the exported `healProfilesModuleFallback` with this package's manifest as the install anchor, linking the delivered closure — engine, shell bundle, roster packages, frontend — flat under `$DSH_HOME/profiles/node_modules`. The prior mechanism (a profile-local `@daypaw/engine` link) is retired: the fallback is outside every profile's pnpm-managed `node_modules`, so a `daypaw plugin` operation can no longer prune the link, and rows resolve through one path. An old install's orphaned profile-local link is a dangling entry Node skips on the parent walk (covered by the upgrade spec case). This consumes the `ensureSymlink` sharing seam from the sibling [sharing note](../architecture/2026-08-26-ensure-symlink-shared-from-app-boot.md) indirectly — the heal itself was already exported upstream.
- **The dist ships as a build-time product.** The release pipeline gains a third build face (`@daypaw/web-frontend` vite build) ahead of the deploy that copies it into the closure; `bundleDependencies` pins it; install builds nothing (spec 05 §4's packaging ruling, ADR 0011's single artifact line).
- **The smoke proves the front door.** `smokeCli` boots a bare `daypaw --port 0` from a fresh `DSH_HOME` in a clean prefix, waits for the `daypaw web:` URL line, fetches the served dist page while the server is alive, then terminates and asserts the seed artifacts (engine row, fallback links, dist, ledger). The prior smoke's credential-error shape belonged to the headless surface; the shell serves without a key.

## Alternatives considered

- **A default-profile environment seam in the upstream launcher** — rejected: a new upstream runtime-file edit for fork-only UX, growing the delivery closure's registered exceptions for nothing the adapter cannot do.
- **Keep the profile-local engine link and add fallback links beside it** — rejected: two heal mechanisms for one job, and the profile-local one remains prunable by pnpm operations inside the profile.
- **A hardcoded per-package link list (engine, web-app, roster)** — rejected: the closure BFS already exists as the exported `healProfilesModuleFallback`; anchoring it on the CLI manifest reuses it with zero new walk code and covers future `@daypaw` rows without list maintenance.
- **Wrapping the launcher with a fork CLI parser that re-emits dsh grammar** — rejected: it would duplicate the launcher grammar and drift with it; three-token inspection is the entire fork surface.

## Consequences

- A bare `daypaw -h`/`--help` now prints the shell app's help (the injected profile hands the flag to the app), matching `dsh --profile web -h` semantics; the launcher's own help is no longer the bare-command surface.
- One-shot headless runs leave the CLI (spec 05 §4): programmatic durable work goes through `@daypaw/sdk`, one-shot CLI runs through an explicit `--profile` on an upstream profile. The CLI README's limitations carry this.
- The tarball grows by the web-app closure and the built dist; closure completeness stays owned by the release pipeline's restore rounds, and the smoke's served-dist probe fails loud if a future packaging change drops the dist or any roster client bundle (the modules activation invariant rejects a row that advertises a client bundle it cannot resolve).
- The vendored `web` alias remains reachable on `daypaw web` and boots the upstream web profile — an expert escape hatch, not the product surface; the README documents it.
- Bundle-tuple changes to the shipped template must now update `PREVIOUS_DAYPAW_PROFILE_BUNDLES` machinery only when a released tuple needs migrating; the spec pins both the fresh seed and the migration.
