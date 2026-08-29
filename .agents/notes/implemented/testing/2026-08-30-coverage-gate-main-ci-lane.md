# Agent Note: Coverage gate repair and the fork-owned main CI lane

Status: implemented

English | [中文](2026-08-30-coverage-gate-main-ci-lane.zh.md)

## Problem

The per-file 100% coverage gate had never run on this fork's CI: the inherited `CI` workflow's `pull_request` jobs resolve to the upstream organization's runner label (`dsh-ubuntu-24-04-16core`), which does not exist here — dependabot runs queued for hours until timeout — and `CI master` watches the upstream default branch `master`, never this fork's `main`. Run locally, the gate failed on three files: `daypaw/ui-tasks/src/client/task-list.tsx` (branch 96.15%), `daypaw/ui-inbox/src/client/index.ts` (lines 97.87%), and `daypaw/engine/src/core.ts` (branch 99.57%, the `settledResult` failed-row path).

## Decision

- ADR 0007 §1 landed as ruled: one coverage-exclude glob `packages/daypaw/ui-*/src/**` in `vitest.config.ts` (a registered core touch in `docs/fork/CORE_TOUCHES.md`), mirroring upstream's own GUI-debt exemption for client UI — jsdom component tests and the assembled web lane stay, the per-file gate does not apply. Host-side daypaw packages keep the gate.
- The engine gap is covered, not exempted: the crafted-row test now also attaches to a `failed` row with `error_json` set, exercising the `JSON.parse` direction of `settledResult` (the only prior pass through that branch carried `error_json: null`; live failures settle through the runner, never the attach replay). `engine/src/core.ts` is 100% per-file.
- Main pushes get exhaustive CI through a new fork-owned workflow, `.github/workflows/ci-daypaw-main.yml`: one `ubuntu-latest` job (public repository — hosted minutes are free) running `pnpm run check:ci:linux-primary`, the same serial aggregate the upstream master standby runs (typecheck, lint, duplication, per-file coverage, snapshots, doc-sync, module graph, knip, build, publint, node-next types, built invariants, bin smoke, web snapshot), with `DSH_TELEMETRY_DISABLED` and per-ref cancellation.
- The lane pins `DSH_GATE_CONCURRENCY=1` only — gates serialize so a 4-vCPU runner never juggles two lanes (the first run failed exactly there), while each lane keeps its natural intra-suite parallelism, matching the upstream pull-request lane's shape. The standby's full serial pinning targets its weaker single-purpose VMs and starved timing-sensitive process tests on hosted hardware and, after serialization, on the missing hosted environment the standby also prepares (Playwright Chromium, bubblewrap with unrestricted user namespaces), and the same run surfaced one real violation the dead lanes had let through — `agents-dir.ts`'s dynamic factory import assigned `any` (`no-unsafe-assignment`); the import is now structurally typed at the file boundary.
- The dead inherited `CI` workflow is disabled through the GitHub UI (reversible, zero core touch — the ADR 0007 §5 precedent) and its stuck queued runs were cancelled. `CI master` stays untouched: it cannot fire on a branch this fork never pushes.

## Alternatives considered

**Retarget `ci-master.yml` to `main`.** Rejected: its jobs assume the in-house self-hosted standby pools and Wine cache seeding; without those runners the lane queues forever, and the change would be a broad core touch on an upstream file.

**Add `push: main` to the inherited `ci.yml`.** Rejected: every job conditions on `github.event_name == 'pull_request'` and reads PR context (base sha, user login), so the trigger alone runs nothing; adapting the conditions is a larger core touch than a fork-owned file.

**Cover the ui-* gaps instead of the glob.** Rejected: ADR 0007 §1 already ruled the family's stance from upstream's own precedent; chasing per-file 100% on jsdom-hosted components buys no verification the assembled lane lacks.

## Consequences

- The three gate failures are gone: `engine/src/core.ts` measures 100%, the two `ui-*` files are excluded, and scoped coverage runs no longer trip thresholds.
- A full local `pnpm run test:coverage` still aborts under this host's Node 26 on the documented flake set (12 failures across 10 files; 10 of 11 files pass in isolation and `session-projection-cache` reds in isolation exactly as the sync-note baseline records). The authoritative gate verdict is the new node-24 CI lane; local red-on-flakes is baseline, not regression.
- Future daypaw `ui-*` packages fall under the glob automatically; host-side daypaw packages that miss the bar fail the main lane loudly.
