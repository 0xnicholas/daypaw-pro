# Agent Note: Release closure restore reaches its fixpoint

Status: implemented

English | [中文](2026-08-30-release-closure-restore-fixpoint.zh.md)

## Problem

Since the 2026-08-28 upstream sync, the `Release (daypaw)` pack job failed with `closure still incomplete after restore rounds: vfile-message`. The sync pulled the shiki/micromark/vfile rendering stack into the CLI closure, making the deepest dependency chain seven levels (`vfile` → `vfile-message` at the bottom). `completeClosure` staged one dependency-depth layer per round under a fixed six-round budget, so the last layer was never attempted and the release failed with a budget error instead of a packaging error.

## Decision

- The restore loop runs until `missingClosurePackages` returns an empty set; there is no round budget. Every round stages at least one package, every staged package is credited by its staged directory on the next check, and the repository's finite on-disk sources bound the reachable name universe, so the loop terminates at the fixpoint.
- The closure logic moved from `scripts/release/daypaw.ts` to `scripts/release/daypaw-closure.ts` (`missingClosurePackages`, `locatePackage`, `findWorkspacePackage`, staged-manifest IO) with the repository root as an explicit parameter, giving the restore behavior a unit seam. `daypaw-closure.spec.ts` pins: a chain deeper than any fixed budget completes; a package without a repository source fails the release by name; optional peers and consumer-supplied external peers may stay absent; a staged package is credited by its directory even when the residue manifest declares another name, matching Node directory resolution.
- Failure modes are otherwise unchanged: a package no source can supply fails naming the package, and a malformed staged manifest fails during the completeness BFS.

## Alternatives considered

**Raise the round budget.** Rejected: any fixed depth re-fails on the next deeper chain; chain depth is a property of the synced dependency graph, not of the release.

**Pre-resolve the full transitive closure from sources in one pass.** Rejected: it replaces a three-line loop with a second resolution algorithm while the round loop already converges on exactly the staged-manifest graph the tarball ships.

## Consequences

- The CLI closure completes after seven restore rounds (593 bundled closure manifests) and the SDK after two; the release lane needs no workflow change.
- External restore sources resolve through the root resolution paths as seen under tsx, which include pnpm's hidden hoisted store `node_modules/.pnpm/node_modules`. Running the release script under plain Node cannot see that store and fails with `no repository source` per external package; the release lane always invokes it through tsx.
- Local runs of `pnpm deploy --legacy` leave pnpm's pre-run dependency check demanding an interactive modules purge; a plain `pnpm install` restores the development tree (pre-existing, unchanged).
