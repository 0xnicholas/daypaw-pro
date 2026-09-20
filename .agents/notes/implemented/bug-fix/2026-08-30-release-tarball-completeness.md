# Agent Note: Release tarball closure completeness and smoke robustness

Status: implemented

English | [中文](2026-08-30-release-tarball-completeness.zh.md)

## Problem

`Release (daypaw)` fails at the CLI smoke: the installed tarball boots, but plugin loading dies on `Cannot find package '@deepseek-ai/dsh-settings'` (imported by `dsh-agent-presets`), `@deepseek-ai/dsh-credentials` (imported by `dsh-client-connection`), and `@deepseek-ai/dsh-jobs` (imported by `dsh-jobs-local`). All three were staged and listed in `bundleDependencies`, yet carried zero files in the tarball. Behind them, the SDK smoke failed its consumer typecheck with a zod generic mismatch: the registry had drifted to zod 4.5.2 while the SDK's bundled types were built against the workspace's 4.4.3.

## Decision

- `rewriteManifests` pins every bundled name into `dependencies` at its staged version for both the CLI and the SDK. npm 11 packs a `bundleDependencies` entry only when its name is also a real dependency: `bundleDependencies` alone packs one file, adding the `dependencies` entry packs the child. `dsh-settings`/`dsh-credentials` are transitive requirements of bundled plugins (imported, not facade dependencies), so they must also be pinned.
- `missingClosurePackages` tracks requirements: a name may be absent only when every reached manifest declaring it allows absence (optional `peerDependenciesMeta` peer, or a deploy-root external peer). A name optional at one manifest and required at another is required. `dsh-jobs` is a hard peer at `dsh-jobs-local` and only optional at `dsh-api-session-controller`, so the restore stages it. A staged optional is traversed too, so its own dependencies are checked.
- The SDK tarball ships zod only as a consumer-supplied peer: the facade neither bundles nor depends on it, every bundled manifest declares it as a peer (a bundled package declaring it as a dependency gets a private nested zod install — a second identity whose structurally identical types stop unifying with the facade's declarations, which breaks the smoke), and drift-prone registry ranges in staged manifests pin to the workspace-resolved zod so a customer install never re-resolves a diverging copy. The cordis and invariants singletons keep their bundled workspace copies — the facade's declarations type against them — matching the bundled copies the 2026-08-29 registry-consumer run proved.

## Alternatives considered

**Rely on `bundleDependencies` alone for the CLI.** Rejected: npm 11 packs a `bundleDependencies` entry only when the name also appears in `dependencies`; the tarball's file list is the acceptance criterion, and it requires the `dependencies` pin.

**Walk `optionalDependencies` edges in the completeness BFS.** Rejected: traversal-by-readdir already covers staged optionals (deploy hoists to the top level) and absence of an optional stays legal; walking the edge would force staging packages the tarball deliberately omits.

**Widen the SDK's zod type surface for future 4.x.** Rejected: the zod generic parameters are internal; the verifiable claim is the pinned zod version plus the published `peerDependencies` range.

## Consequences

- The CLI tarball carries 594 bundled closure manifests (50.9 MB) and boots in the clean-prefix smoke; the SDK smoke typechecks and runs (`RESULT {"total":50}`); `pnpm run release:daypaw` exits 0 locally end to end.
- Residual, recorded risk: a customer resolving zod newer than the tested pin may still hit zod generic-parameter mismatches against the SDK's types; the peer range promises compatibility that is only verified at the pinned version.
- `daypaw-closure.spec.ts` pins the new semantics: a name optional at one manifest and hard at another is reported missing; a staged optional's own missing dependency is reported.
