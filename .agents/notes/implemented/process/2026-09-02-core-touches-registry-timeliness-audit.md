# Agent Note: Core-touches registry full-path timeliness audit

Status: implemented

English | [中文](2026-09-02-core-touches-registry-timeliness-audit.zh.md)

## Problem

The CORE_TOUCHES registry is the sync ritual's replay list (ADR 0001 §4): each row names an upstream-owned file and the fork edit on it, and the ritual re-verifies every touch after a merge. The verification only holds while rows point at paths that exist and describe edits that still sit in the tree. One row named a path that does not match the file it describes ([frontend arch review](../../../../docs/reports/2026-09-02-frontend-arch-review.md)), so a path that resolves today can still stop resolving after a merge; the full registry carries the same risk, and a spot-check of one row does not establish the invariant for the others (issue [#91](https://github.com/0xnicholas/daypaw-pro/issues/91), wayfinder [#81](https://github.com/0xnicholas/daypaw-pro/issues/81) ruling 2).

## Decision

Two directions must hold against the 2026-08-28 upstream checkpoint (`cd5ef81481`): every path a row names exists with its described edit present, and every fork-modified upstream file is claimed by a row or that row's connected-file set. The registry rows below carry the corrections:

- built-boot row: the path is `apps/web/tests/built-boot.expected.e2e.ts`, and the row's edit is the expected built-boot text containing the "Waiting for approval" line.
- ui-theme row: the dialog golden path is `expected/`; `src/client/settings-store.ts` and `apply.client.spec.ts` are byte-identical to upstream and carry no fork edit, so they are not in the row's connected set; the fork edit in `settings-store.client.spec.ts` is its test title.
- fixture.ts row names its owning-spec companion `packages/client/connection/tests/fixture.client.spec.ts` (assertion adaptations for callId pairing, the fx-gamma question, `flipGammaRunning`, and approvalHistory folding).
- A new row registers the `apps/web/tests/todo-row.expected.e2e.ts` header comment, which states the current turn value; the row mirrors the built-boot adaptive-text row.
- The session-controller manager row (#94) names its doc companions: the `service.ts` `list`-field JSDoc and the README removal-frame re-pull paragraph.
- The fixture-durable spec lives at `apps/daypaw-web/tests/durable-rpc.spec.ts`; `packages/client/connection/tests/` holds no fork-added file.

No rows cover these fork edits, and they stay unregistered until a follow-up ticket names their change family: root scripts — `tsdown.config.ts` (types entry glob), `scripts/gen-doc-graphs.ts` (durable service role), `scripts/test-invariants.ts` and `scripts/verify-built-package-invariants.mjs` (companion-absence transition), `scripts/type-equiv.manifest.json` (daypaw-engine doc pairs), `scripts/rescope-vendor.ts` (inspector wire-id skips) — and the regenerated catalogs (`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`, `packages/extensions/tool-cordis/src/api-catalog.ts`, `docs/capability-seams*`, `docs/config-catalog*`, `docs/rescope*`, `docs/subsystems/README*`).

## Alternatives considered

- **Register every unlisted diff in this change.** Rejected: those edits belong to other tickets' change families and each row's reason column must carry that family's deciding rationale; this registry records path timeliness, not every unlisted diff. They are reported for a follow-up ticket instead.
- **Count regenerated catalogs as registry touches.** Rejected: they are generator outputs re-derived at sync, and rows register hand edits rather than derived artifacts (the catalog-regeneration hygiene commit `72002c1945` is the precedent).

## Consequences

- Every path in the registry resolves in the working tree and each touched row's connected-file set matches the tree, so a sync replays every row against live paths.
- The unregistered root-script edits need a follow-up ticket. Without rows, a sync surfaces those files as merge conflicts or test reds; comment-only adaptations stay silent and are covered by rows only once registered.
