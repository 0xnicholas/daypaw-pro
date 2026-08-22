# Agent Note: daypaw self-contained npm delivery — closure-manifest packaging and its pnpm-deploy hazards

Status: implemented

English | [中文](2026-08-22-daypaw-npm-self-contained-delivery.zh.md)

## Problem

ADR 0011 ruled that v1 customer delivery is two self-contained npm packages (`@daypaw/cli`, `@daypaw/sdk`) built from vendored-closure tarballs, and the spike proved the route end to end. What remained was turning the spike's throwaway scripts into owned release machinery while satisfying the repo's package gates — which assume every `packages/*/*` package is private, workspace-wired, and carries an invariant companion — and while neutralizing three pnpm-deploy hazards the spike surfaced.

## Decision

- **`packages/daypaw/cli` is a closure-manifest package**: the deploy-root manifest (dependencies = `@deepseek-ai/dsh` plus every peer-only Service Definition package legacy deploy would drop, mirroring the `python/sdk-runtime` precedent), the `bin.mjs` shim that seeds the daypaw profile ([the seeding note](../architecture/2026-08-22-daypaw-profile-template-seeding.md)) before importing `@deepseek-ai/dsh/lib/bin.js`, and the gate-mandated explained-empty invariant companion. It and `@daypaw/sdk` are the family's two publishable exceptions (real `0.x` versions, `publishConfig.access: public`); `check-workspace-constraints` carries a named exemption set, and the sdk's npm-range peers are exempted from the workspace-protocol and invariant-gate `workspace:^` rules. Every exemption is registered in `docs/fork/CORE_TOUCHES.md`.
- **The sdk's consumer-supplied singletons are npm-range peers**: `@deepseek-ai/cordis` `~4.0.1`, `@deepseek-ai/dsh-invariants` `~0.1.0-rc.3` (floor = latest published rc not newer than the vendored copy, per the ADR 0011 §2 addendum), and zod `^4.4.3` moved out of dependencies so consumers share one zod. The sdk re-exports `DurableEngine` so consumers never `createRequire` into the vendored closure; `@daypaw/engine`/`@daypaw/store` stay private and ship only inside the sdk tarball.
- **`scripts/release/daypaw.ts` owns the pipeline** (`pnpm run release:daypaw`): build both faces first, then per package `pnpm deploy --legacy --prod` with the spike's flags, copy the staging tree by content (deploy hardlinks workspace files — in-place edits would write through to the repo), BFS closure check over `dependencies`+`peerDependencies` that honors `peerDependenciesMeta.optional` and the sdk's three intentional external peers, restore of dropped packages from their repository sources, manifest rewrite (`workspace:` → staged versions; cordis peers → `~` ranges; strip devDependencies; `bundleDependencies` = the staged closure), `npm pack`, then two smokes: a clean-prefix global install of the CLI booted with `--profile daypaw` to the no-API-key line, and a registry-installed SDK consumer that typechecks under NodeNext and runs one workflow to a typed result. `--publish` publishes; the default is pack-only.
- **`.github/workflows/release-daypaw.yml`** runs pack + smokes keyless on pull requests and main pushes; the publish job runs only on manual dispatch with `publish=true` and `secrets.NPM_TOKEN`.

The three pnpm hazards and their handling, restated as standing facts: legacy deploy omits peer-only and some transitive packages (the cli manifest declares them explicitly; the closure check proves completeness); deploy hardlinks make the raw staging tree read-only in practice (the pipeline edits a content copy); deploy residue in the source package's node_modules makes the next `pnpm run` demand an interactive `--production` purge (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`), so the script builds before any deploy and a plain `pnpm install` repairs a developer tree after manual deploys.

## Alternatives considered

- **Single-file bundling of the CLI** — rejected by ADR 0011: the cordis loader dynamically imports plugin package names at runtime, so a bundler cannot see the closure.
- **Publishing the `@deepseek-ai/*` scope ourselves** — rejected by ADR 0011: the scope is upstream's; vendoring the closure into `@daypaw/*` tarballs sidesteps it with zero upstream package renames.
- **Bundling cordis and dsh-invariants inside the sdk tarball too** — rejected: consumers mount the engine into their own Cordis app, and a second bundled cordis copy breaks the service singleton; the fork's vendor/ is byte-identical to upstream's published releases, so npm ranges are safe.
- **Keeping zod as a bundled sdk dependency** — rejected: consumer applications already carry zod for their own contracts; a pinned bundled copy duplicates it and splits type identity.

## Consequences

- The pack path is fully gated (workflow runs it on every PR); the publish path needs an `NPM_TOKEN` secret that is not yet configured, so `npm publish` has never executed — first publication is a manual dry-run candidate (`npm publish --dry-run`) before the real push.
- The CLI tarball bundles the build host's platform closure; platform-specific natives outside the host resolve from npm at install time, and platforms without a published native fallback are untested (cli README limitations).
- Any future package added to the dsh CLI's peer-only surface must be added to `packages/daypaw/cli/package.json` dependencies in the same change; the closure check fails the release otherwise.
- The spike's `build:lib:client` crash was diagnosed as the deploy-residue purge abort, not a client-face defect: both faces build green from a clean `pnpm install` state.
