# Agent Note: The assembled daypaw golden lane gates the fork's main CI

Status: implemented

English | [中文](2026-09-14-daypaw-golden-lane-required.zh.md)

## Problem

No CI lane ran the daypaw assembled golden lane (`vitest.web.daypaw.config.ts`, `apps/daypaw-web/tests/**/*.golden.ts`): the required `ci-daypaw-hosted` aggregate carries upstream's deterministic gates, and the advisory job runs the three timing-sensitive full-suite lanes ([lane split](2026-08-30-coverage-gate-main-ci-lane.md)). The 2026-10-09 upstream sync missed the `resources` and `ui-sidebar-right` roster rows — upstream `11d6bd05f3` onward the kept rows hard-wait on `sidebarRight`/`resources` — so daypaw browser boot was broken at HEAD: the product shell and every assembled golden stayed red for a whole sync cycle, undetected until [#93](https://github.com/0xnicholas/daypaw-pro/issues/93) added goldens and hit the break (the roster repair is a registered core touch; see the [connection-recovery note](../feature/2026-09-13-daypaw-connection-recovery-notice.md)). The repair closed that instance; the detection gap stayed — a future sync that drops a roster row the kept rows inject still reddened nothing in CI.

## Decision

- The lane joins the required `ci-daypaw-hosted` aggregate as the `daypaw-web-goldens` gate: `pnpm run test:web:daypaw:built` with `needs: ['build']`, because the goldens read the built `lib/client.js` bundles the aggregate's build gate produces. The workflow needs no new step — the aggregate carries the gate; its header comment's gate enumeration records the addition. Upstream's `ci-primary` aggregate stays untouched.
- Timing classification per the lane split's rule: the assembled goldens are jsdom boots of the real built roster against the keyless fixture transport — keyless, deterministic compare against committed goldens — not timing-sensitive host measurements, so they gate rather than advise. The default run (no `DSH_SNAPSHOT`) is the compare judgment; record/refresh stay explicit local workflows. Verified at the judgment face: with the `resources` roster row removed, all 8 golden files fail; restored, the lane is green (8 files / 9 tests, serial, ~40–50 s on an 8-core dev host).

## Alternatives considered

**Run the lane in the advisory timing-sensitive job.** Rejected: advisory lanes report without gating, so the sync-gap failure would stay non-blocking, and the lane is deterministic — misclassifying it would re-argue the determinism split against the evidence.

**Add a workflow step instead of the aggregate.** Rejected: a job's gates live in its aggregate, which already owns the build dependency the gate needs; a parallel YAML step would split the judgment surface between `run-gates.ts` and the workflow for no reuse.

**Gate on `test:web:daypaw` (build included).** Rejected: the aggregate already runs `build` as a gate with its needs graph; the `:built` variant is the judgment face, the same precedent as the `ci-linux-primary` web-snapshot gate on `test:web:built`.

## Consequences

- Main pushes gate on the assembled goldens: a sync that drops a roster row the kept rows hard-wait on fails the required job at this gate (the removal probe above), instead of shipping a broken product shell silently.
- The required job's wall clock grows by the lane's serial runtime (~1–2 min expected on hosted 4-vCPU); the 90-minute job budget absorbs it.
- If the lane ever proves marginal on hosted hardware, the lane-split rule applies — move it to the advisory job rather than widening budgets; nothing here pins it as untouchable.
- The [2026-08-30 lane note](2026-08-30-coverage-gate-main-ci-lane.md)'s aggregate enumeration and the `scripts/run-gates.ts` row in `docs/fork/CORE_TOUCHES.md` are updated in the same change.
