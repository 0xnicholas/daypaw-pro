# Agent Note: Core-touches registry full-path timeliness audit

Status: implemented

English | [中文](2026-09-02-core-touches-registry-timeliness-audit.zh.md)

## Problem

The CORE_TOUCHES registry is the sync ritual's replay list (ADR 0001 §4): each row names an upstream-owned file and the fork edit on it, and the ritual re-verifies every touch after a merge. The verification only holds while rows point at paths that exist and describe edits that still sit in the tree. A spot-check against the [frontend arch review](../../../../docs/reports/2026-09-02-frontend-arch-review.md) found one row pointing at a pre-rename path; issue #91 (wayfinder #81 ruling 2) required validating the full registry, not just the sampled row.

## Decision

The audit checks both directions against the 2026-08-28 upstream checkpoint (`cd5ef81481`): every path a row names must exist with its described edit still present, and every fork-modified upstream file must be claimed by a row or that row's connected-file set. Findings and fixes, all landed in the registry:

- built-boot row: path corrected to `apps/web/tests/built-boot.expected.e2e.ts` (upstream's expected-output rename; the "Waiting for approval" edit survived the rename).
- ui-theme row: the dialog golden path follows the same upstream move (`snapshots/` → `expected/`), and `src/client/settings-store.ts` and `apply.client.spec.ts` leave the row's connected set — both files are byte-identical to upstream again after the 2026-08-28 sync took upstream's evolved versions (the surviving fork edit in `settings-store.client.spec.ts` is its test title).
- fixture.ts row names its owning-spec companion `packages/client/connection/tests/fixture.client.spec.ts` (assertion adaptations for callId pairing, the fx-gamma question, `flipGammaRunning`, and approvalHistory folding).
- A new row registers `apps/web/tests/todo-row.expected.e2e.ts` (header comment turn 74→75), mirroring the built-boot adaptive-text row.
- The session-controller manager row (#94) names its doc companions: the `service.ts` `list`-field JSDoc and the README removal-frame re-pull paragraph.
- Issue item 1 (fixture-durable spec out of the upstream tree) landed with #90 as a `git mv` to `apps/daypaw-web/tests/durable-rpc.spec.ts`; `packages/client/connection/tests/` holds no fork-added file.

Reported without rows, for the owner to ticket as follow-up: unclaimed fork edits to root scripts — `tsdown.config.ts` (types entry glob), `scripts/gen-doc-graphs.ts` (durable service role), `scripts/test-invariants.ts` and `scripts/verify-built-package-invariants.mjs` (companion-absence transition), `scripts/type-equiv.manifest.json` (daypaw-engine doc pairs), `scripts/rescope-vendor.ts` (inspector wire-id skips) — and the regenerated catalogs (`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`, `packages/extensions/tool-cordis/src/api-catalog.ts`, `docs/capability-seams*`, `docs/config-catalog*`, `docs/rescope*`, `docs/subsystems/README*`).

## Alternatives considered

- **Register every unlisted diff in this change.** Rejected: those edits belong to other tickets' change families and each row's reason column must carry that family's deciding rationale; ruling 2 scoped this audit to path timeliness. They are reported for a follow-up ticket instead.
- **Count regenerated catalogs as registry touches.** Rejected: they are generator outputs re-derived at sync (the catalog-regeneration hygiene commit `72002c1945` is the precedent); rows register hand edits, not derived artifacts.

## Consequences

- Every path in the registry resolves in the working tree and each touched row's connected-file set matches the tree, so the next sync replays every row against live paths.
- The unregistered root-script edits stay open until a follow-up ticket registers them; a sync surfaces those files as merge conflicts or test reds, while the silent class (comment-only adaptations) is covered by rows.
