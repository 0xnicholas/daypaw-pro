# @daypaw/cli

English | [中文](README.zh.md)

The self-contained daypaw CLI: `npm i -g @daypaw/cli` installs the `daypaw` command, which boots the dsh CLI from a vendored runtime closure bundled inside this one package — no other `@deepseek-ai/*` install is needed. Delivery shape: [ADR 0011](../../../docs/adr/0011-customer-self-run-delivery.md).

This package carries no product code: the manifest is the deploy root whose `dependencies` define exactly which workspace packages enter the tarball (the `python/sdk-runtime` deploy-root precedent), and `bin.mjs` is a shim that imports `@deepseek-ai/dsh/lib/bin.js` from the bundled closure. Packing is owned by `scripts/release/daypaw.ts` (`pnpm run release:daypaw`), which deploys the closure, rewrites workspace ranges to real versions, and packs with `bundleDependencies`.

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
- **No cross-version in-flight run continuity** — per ADR 0011 §2, upgrades require a drained ledger or a fresh one.
- **Publish path untested without `NPM_TOKEN`** — the release workflow's publish job needs the secret configured; the pack path is the gated one.
