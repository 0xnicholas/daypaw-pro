# Agent Note: The daypaw roster mirror gate

Status: implemented

English | [中文](2026-09-18-daypaw-roster-mirror-gate.zh.md)

## Problem

The fork's browser surface is a composition mirror: `packages/daypaw/web-app/cordis.patch.yml` derives from `packages/bundle/web-app/cordis.patch.yml` — upstream rows kept, deliberate trims, fork-owned rows added. That mirror law was the fork's only composition fact with no executing owner: it lived in patch comments and in the sync ritual's manual re-diff of two ~470-line yml files. Three incident classes proved the manual diff insufficient: the 2026-09-13 sync dropped the `resources`/`ui-sidebar-right` provider rows and the browser boot broke for a whole cycle, caught only when [#93](https://github.com/0xnicholas/daypaw-pro/issues/93) added goldens; the `workspace-files` row surfaced only in release smoke (a registered core touch); and a missing `ui-deliverables` form never fails at all — with its provider present the shape activates fine, so silent roster absence has no symptom. The [assembled golden lane](../testing/2026-09-14-daypaw-golden-lane-required.md) gates the activation face only (absence that breaks the boot); silent absence had no detector.

## Decision

- The mirror is a check in `verify-cordis-config` — no new script, no `run-gates.ts` change; the three aggregates that already carry the gate (ci / hygiene / ciSharedStaticGates) cover it automatically. `docs/fork/CORE_TOUCHES.md` registers the extension as upstreamable.
- The comparison key is the package name: every upstream row whose package declares `dsh.client` in its workspace manifest must appear in the fork roster or in `ROSTER_TRIMS`, a const array in the gate script whose entries each carry their reason as an end-of-line comment. The initial trim set is five rows: `ui-open-in-app` (the shell ships no Open-In split button), `ui-sidebar` (`@daypaw/ui-inbox` replaces it wholesale), `ui-sidebar-documentpreview` and `ui-sidebar-files` (right-sidebar tabs stay unshipped), and `ui-brand-official` (`@daypaw/ui-brand` owns the brand slots).
- Host rows are not compared: config overrides, disables, and absences such as `open-in-app` or `subagent-model-selection-settings` are patch-layer semantics, not roster membership.
- A trim whose upstream row disappears fails the gate symmetrically, so the trim list cannot rot across syncs.
- The check body is the exported pure function `rosterMirrorViolations(upstream, fork, trims)`; `verify-cordis-config.spec.ts` covers all four directions (upstream row added / fork row dropped / stale trim / green), and the wired path was verified red on each branch against the live tree.

## Alternatives considered

**Compare whole rows (id + name + config) instead of package names.** Rejected: id renames and config divergence are legitimate patch semantics — the fork intentionally overrides configs and disables rows; only roster membership decides whether a client half reaches the browser.

**Keep the trim list as yml comments or a sidecar manifest.** Rejected: comments are where the trims already lived, unjudged; a gate-internal const with per-entry reasons sits inside the checking boundary, and stale entries redden.

**A dedicated script wired into run-gates.** Rejected: `verify-cordis-config` already collects patch plugin references, workspace manifests, and the yaml loader; a second home would split composition checking for zero added coverage plus one more aggregate row.

**Extend the golden lane instead, probing the roster at boot.** Rejected as a substitute: a boot probe only sees absence that breaks activation — the `ui-deliverables`-form class stays invisible. The golden lane remains the complementary activation face.

## Consequences

- The coverage face is closed: a sync that drops or fails to pick up an upstream client row now fails `verify-cordis-config`, naming the row and both remediations (mirror it, or record a trim with its reason). With the golden lane (activation face) and release smoke (dependency-closure face), all three incident classes of the 2026-09-13 sync have named detectors.
- A fork-owned client row still needs its roster row added by hand — the mirror law constrains upstream rows only; the daypaw cookbook §2 now names the two extra registration steps for ui-* packages (roster row + web-app dependency line) together with their gates.
- Host-row absences remain unchecked by design; if a kept row later hard-waits on a service whose provider row the fork trims, the golden lane catches the boot break.
