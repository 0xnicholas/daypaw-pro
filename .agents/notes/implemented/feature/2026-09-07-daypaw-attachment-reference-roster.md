# Agent Note: ui-attachment and ui-reference join the daypaw web roster

Status: implemented

English | [中文](2026-09-07-daypaw-attachment-reference-roster.zh.md)

## Problem

The surface-catalog audit (wayfinder [#97](https://github.com/0xnicholas/daypaw-pro/issues/97), `docs/research/2026-09-02-dsh-surface-catalog.md` §1, branch `research/dsh-surface-catalog`) found the fork web roster missing exactly two upstream client rows that each cost one roster row and no fork code: `ui-attachment`, the whole attachment presentation over conversation slots (composer draft rail, drop invitation, persisted images in Chat/Trajectory/Tool results, original-image lightbox), and `ui-reference`, the composer `@file`/`@session` candidate list, whose Host service rows `file-reference-local` and `session-reference` the fork bundle already mounts. [ADR 0013](../../../../docs/adr/0013-positioning-review-dual-mode.md) ruled both in (wayfinder [#100](https://github.com/0xnicholas/daypaw-pro/issues/100) verdict ②): pasting screenshots is a natural business-user need at near-zero cost, and `@` references pay off for power users as soon as a composer renders the trigger machinery.

## Decision

`packages/daypaw/web-app/cordis.patch.yml` takes both rows enabled: `ui-attachment` beside `ui-chat`, next to its slot owners `ui-conversation`, `ui-chat`, `ui-tool`, and `ui-trajectory`; `ui-reference` after `ui-subagent`, mirroring upstream placement. Both packages join the bundle manifest's closure so `verify-cordis-config` resolves the rows, and the input-trigger roster comment now names all three reference sources (`ui-skill`, `ui-subagent`, `ui-reference`). The take decisions are pinned by the composed-roster spec (`packages/daypaw/web-app/tests/roster-coexistence.spec.ts`), whose row-map helper is shared with the turn-outline describe. Activation is pinned by the assembled golden lane (`pnpm run test:web:daypaw`): it boots both client halves from the real bundles through the fork graph, and the committed goldens are unchanged because no fork surface renders the slots these plugins occupy today — the fork's ConversationView and input seats shadow the upstream composer and chat view. This mirrors the [turn-outline roster decision](2026-09-06-daypaw-turn-outline-roster.md): the capability ships on the wire, and the first surface that renders it (#102's light-conversation entry is the queued candidate) binds without a roster change.

## Alternatives considered

**Hold the rows like `ui-schedule`** — rejected: `ui-schedule` waits on a walk-through verdict; these two are presentation-only rows whose every dependency is already mounted, so a hold would re-litigate the same one-line take after each sync.

**Fork or re-wrap either package** — rejected: the ticket's boundary is 「无 fork 代码」; attachment presentation carries no terminology to translate, and `ui-reference`'s section labels are locale-registered upstream, so the #40 vocabulary mapping has no work here.

**Mount together with the light-conversation surface (#102)** — rejected: roster composition and surface rendering are separate seams; mounting now keeps #102 a pure surface change and lets the assembled lane prove the fork graph carries both halves immediately.

## Consequences

Cost: two more client bundles on the boot graph, and two roster rows whose visible payoff waits on a composer surface the fork does not yet render. Bought: any surface that renders the upstream conversation slots — composer rail, message images, trajectory/tool galleries — or the `@` trigger machinery gets the full attachment presentation and file/session candidates with no further composition change, and upstream fixes to either package (the alpha.5 attachment-card window showed these actively maintained) arrive with the sync for free. Spec 05 §4's cluster counts are untouched: they pin the closed #36/#37 reuse-boundary adjudication, and this decision post-dates it under ADR 0013; `ui-attachment` was already in the wholesale-reuse cluster, and `ui-reference` joins the roster as a post-#37 row whose record is this note.
