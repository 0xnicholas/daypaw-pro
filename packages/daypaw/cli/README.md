# @daypaw/cli

English | [中文](README.zh.md)

The self-contained daypaw CLI: `npm i -g @daypaw/cli` installs the `daypaw` command, which boots the dsh CLI from a vendored runtime closure bundled inside this one package — no other `@deepseek-ai/*` install is needed. Run one task with `daypaw --profile daypaw "<task>"`; the durable ledger lands at `daypaw/ledger.db` under the launch directory. Delivery shape: [ADR 0011](../../../docs/adr/0011-customer-self-run-delivery.md).

The manifest is the deploy root whose `dependencies` define exactly which workspace packages enter the tarball (the `python/sdk-runtime` deploy-root precedent). Before delegating to `@deepseek-ai/dsh/lib/bin.js`, `bin.mjs` seeds the `daypaw` profile through `src/index.ts`: the first run materializes `$DSH_HOME/profiles/daypaw` (bundles `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`, with the `@daypaw/engine` row seeded into the profile's own `cordis.patch.yml`) and symlinks the bundled engine into the profile's `node_modules`, since the launcher-healed module fallback covers only the dsh app's dependency closure. Seeding is idempotent and never overwrites existing files. Packing is owned by `scripts/release/daypaw.ts` (`pnpm run release:daypaw`), which deploys the closure, rewrites workspace ranges to real versions, packs with `bundleDependencies`, and smokes the tarball by booting `--profile daypaw` from a fresh home to the missing-credential line.

## Publishable exception

The `@daypaw/*` family default is `private: true` / version `0.0.0` ([adding a daypaw package](../../../docs/fork/adding-a-daypaw-package.md) §1). `@daypaw/cli` and `@daypaw/sdk` are the two sanctioned publishable exceptions under ADR 0011: they carry real `0.x` versions on their own artifact line, `publishConfig.access: public`, and npm-facing peer ranges where a consumer must supply the package.

## Model Experience

### Stored domain records

#### What the model sees

Nothing. The package is a distribution shell; every model-facing behavior belongs to the vendored dsh packages reachable through `bin.mjs`.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the package never touches live request prefixes.

## Known Limitations and Deferred Work

- **Host-platform closure** — the tarball bundles the closure as deployed on the build host; platform-specific natives outside that host resolve from npm at install time, and platforms without a published native fallback are untested.
- **Seeding is CLI-only** — the `daypaw` profile template lives in this package, not in the upstream launcher's `PROFILE_TEMPLATES`, so a source-state `pnpm dsh --profile daypaw` does not auto-initialize; compose source-state from [examples/daypaw-skeleton](../../../examples/daypaw-skeleton/README.md) instead.
- **No cross-version in-flight run continuity** — per ADR 0011 §2, upgrades require a drained ledger or a fresh one.
- **Publish path untested without `NPM_TOKEN`** — the release workflow's publish job needs the secret configured; the pack path is the gated one.
