# Agent Note: The 2026-09-24 upstream sync replay

Status: implemented

English | [中文](2026-09-24-upstream-sync-replay.zh.md)

## Problem

The fork sat 3,165 upstream commits behind (last sync base 2026-09-10, upstream at `dsh 0.1.7-rc.1`). The drift carried changes the fork's registered seams ride directly: the browser fixture deleted and replaced by `@deepseek-ai/dsh-remote-mock` plus the client-test-runtime assembly tier; `SESSION_FORMAT_VERSION` advanced to V4 with producer-owned message sources (the catch-all `plugin` kind removed); `healProfilesModuleFallback` and the whole link-healing profile architecture replaced by a runtime resolution generation; the upstream scaffold's assembled-remote/`{exclude, remote}`/{`rpc`} carrier shape; ten new browser roster rows (including `job-controller`, without which `ui-jobs` cannot activate); `agent-presets` split into `agent-preset` + `agent-preset-registry`; the PTC runtime package family; two new gate systems (no-new-unknown-casts, repository-references); and a dependabot security group that had already bumped member manifests on the fork side.

## Decision

Merge upstream now (11 days after the previous sync), resolve the 44 conflicts against the registry's replay semantics, then follow upstream wherever its redesign supersedes a fork seam — and keep the fork seams its own tickets verified — each choice registered in CORE_TOUCHES:

- **Superseded, dropped**: the fixture seed rows and the `createFixtureConnectionRpc` re-export (the world lives in `daypaw-remote.ts`); the bubblewrap security-revision pin (upstream re-pinned 0.12.0 from a launchable archive URL); the two `apps/web` e2e registration rows (both lanes pass on upstream-original files, ADR 0018 §4).
- **Kept, re-threaded**: `@daypaw/assembled-boot` absorbs the upstream body (declarative manifest patches, `{exclude, remote}` mount options, `{rpc}` native carrier, teardown `assertNoUnmatched`) with the three axes re-read as bundle layer / remote scenario / title; the `#105` row-config channel re-lands in `client-modules/src/client/entries.ts` (`create(loader, id, config)`); the light theme default re-pins onto the rewritten host/config files; the `#94` reconciling re-pull stays, its upstream assertion adapted.
- **New fork-side seams**: `seedDaypawProfile` links the private `@daypaw/web-app` bundle into the profile's own `node_modules` so the launcher's runtime resolution collects the whole family (the deleted heal's successor); `inbox.clear()` returns early on a retired projection registration so a teardown-time `cancel()` cannot throw from an abort listener; `install-lefthook.mjs` resolves lefthook on demand so production installs do not fail their postinstall; `verify-repository-references` exempts the fork's record trees while Agent Notes may cite landing commits.
- **Test-plane adaptations**: the skeleton corpus rolled V3→V4 (filename generation matches the header, per the corpus contract); the scenario mirrors the host's turn-window `paginate`; roster expectations follow upstream's product calls (ralph disabled by default, `workflow-ptc` replaces the worker-thread row); the root pnpm pin advanced to the security-fixed 11.11.0 so the carrier/payload invariant holds.

## Alternatives considered

**Wait for the planned 2026-09-27 window.** Three more days of ~240 commits/day of drift for no milestone benefit; the ticket's remaining items were blocked only on this merge.

**Dry-run on a throwaway branch.** Same merge cost, and the findings would decay before the real window.

**Cache the old fixture in a fork package to avoid the migration.** Explicitly ruled out by ADR 0018 (path A).

## Consequences

- Main is green on the fork's required aggregate (`check:ci:daypaw-hosted`: 76 gates incl. build, publint, built-bin smoke, and the ten assembled goldens), and `CI=true pnpm run release:daypaw` passes end to end (CLI tarball boot, browser first render, seeded profile with the engine ledger, SDK consumer typed run).
- The residual full-suite failures are host-environmental and sit in upstream-identical files (npm 11.13's isolated-config output, a git partial-clone promisor probe, subprocess tests that exceed their 5s budgets under local parallelism); they pass in isolation on this host and belong to CI's platform matrix.
- The release smoke's `pnpm deploy --prod` prunes the workspace's devDependencies (pre-existing hazard): a failed release run leaves the tree without `typescript`, so any retry starts with `CI=true pnpm install`.
- Upstream's product calls that change daypaw's surface (ralph disabled, the settings sections split into per-page rows, `job-controller` now required by `ui-jobs`) are inherited as-is; the shell's own ruling on them is the owner's call in a follow-up ticket if wanted.
