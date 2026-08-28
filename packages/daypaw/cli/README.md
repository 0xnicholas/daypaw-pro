---
description: "The self-contained daypaw CLI: npm i -g @daypaw/cli installs the daypaw command, which boots the product shell directly from a vendored "
kind: "package-reference"
---

# @daypaw/cli

English | [中文](README.zh.md)

## Summary

## Table of Contents



The self-contained daypaw CLI: `npm i -g @daypaw/cli` installs the `daypaw` command, which boots the product shell directly from a vendored runtime closure bundled inside this one package — no other `@deepseek-ai/*` install is needed. A bare `daypaw` boots the browser shell and prints its URL line (`daypaw web: http://127.0.0.1:<port>`); the shell app's own flags follow (`daypaw --port 8080`, `daypaw --help`). The durable ledger lands at `daypaw/ledger.db` under the launch directory. Delivery shape: [ADR 0011](../../../docs/adr/0011-customer-self-run-delivery.md).

The manifest is the deploy root whose `dependencies` define exactly which workspace packages enter the tarball (the `python/sdk-runtime` deploy-root precedent). Before delegating to `@deepseek-ai/dsh/lib/bin.js`, `bin.mjs` seeds the `daypaw` profile and defaults the launcher profile through `src/index.ts`: a bare invocation (and a bare `plugin` subcommand) becomes `--profile daypaw`; an invocation that names a `--profile`, or uses the vendored `web` alias (which boots the upstream web profile), passes through untouched, so the full dsh launcher grammar stays reachable. The first run materializes `$DSH_HOME/profiles/daypaw` (bundles `@deepseek-ai/dsh-base` + `@daypaw/web-app`, with the `@daypaw/engine` row seeded into the profile's own `cordis.patch.yml`); a profile seeded by the prior CLI migrates to the shell bundle tuple when its list still matches the shipped one exactly. Every launch heals the daypaw family flat into the installation fallback (`$DSH_HOME/profiles/node_modules`) from this package's own dependency closure — the launcher's heal covers only the dsh app's closure — so every `@daypaw` row the composed tree names resolves, and a pnpm operation inside the profile cannot prune the links. Seeding is idempotent and never overwrites user files. Packing is owned by `scripts/release/daypaw.ts` (`pnpm run release:daypaw`), which builds the frontend dist before the deploy, deploys the closure, rewrites workspace ranges to real versions, packs with `bundleDependencies`, and smokes the tarball by booting a bare `daypaw` from a fresh home through the URL line and a served dist page.

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
- **One-shot headless runs are not this CLI's surface** (spec 05 §4) — the shell is the product; drive durable runs from a program through `@daypaw/sdk`, or boot an upstream headless profile with an explicit `--profile`.
- **Seeding is CLI-only** — the `daypaw` profile template lives in this package, not in the upstream launcher's `PROFILE_TEMPLATES`, so a source-state `pnpm dsh --profile daypaw` does not auto-initialize; compose source-state from [examples/daypaw-skeleton](../../../packages/examples/daypaw-skeleton/README.md) instead.
- **No cross-version in-flight run continuity** — per ADR 0011 §2, upgrades require a drained ledger or a fresh one.
- **Publish path untested without `NPM_TOKEN`** — the release workflow's publish job needs the secret configured; the pack path is the gated one.

### Dev Note
