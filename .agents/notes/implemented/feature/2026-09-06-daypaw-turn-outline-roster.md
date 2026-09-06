# Agent Note: session-turn-outline joins the daypaw web roster

Status: implemented

English | [中文](2026-09-06-daypaw-turn-outline-roster.zh.md)

## Problem

Upstream `7e2eacb1fe` (carried by the 2026-09-06 sync to `d347e70390`) added `packages/session/session-turn-outline`: a whole-log `turnOutline` projection unit serving every started turn with its `turn/start` seq and bounded prompt/response previews, enabled by default in the upstream web bundle. The fork's `@daypaw/web-app` roster mirror had to decide whether to take the row (wayfinder #85 verdict ②), and the fork already serves long-session navigation facts from a different seam — the durable engine's `durable/journalTimeline` Remote feeding the task detail pane's right column — so the two read models had to be shown to coexist rather than assumed to.

## Decision

The roster takes the `session-turn-outline` row enabled, mirroring upstream placement beside `session-stats`, and mirrors the upstream `ui-schedule` row at its shipped `disabled: true` state (wayfinder #85 verdict ④'s mechanical consequence of the verdict-① hold). Both rows join `packages/daypaw/web-app/package.json`'s closure manifest so `verify-cordis-config` resolves them. Coexistence is proven by an executed spec (`packages/daypaw/web-app/tests/roster-coexistence.spec.ts`): the roster facts compose through the real `dsh-app-boot` patch layering, and one host tree — the fork's `DurableEngine` plus the session store, projection registry, and turn-outline plugin — answers `durable/journalTimeline` from the engine seam and `turnOutline` from the session-projection seam side by side, distinct keys, no shared surface. Business-language-ization (ticket #92 task ③, per #40's vocabulary mapping) is deliberately not applied: no fork-visible surface renders turn-outline nodes today — the fork's ConversationView shadows the upstream ChatView that owns the turn rail — so the projection ships as data, and the #40 mapping binds whichever fork surface first renders entries (the fork's CONTEXT.md already carries "turn/轮次" as an engine term).

## Consequences

The daypaw surface serves the outline projection to any future consumer at zero presentation cost, and the roster's take/don't-take decisions for the drift window's two new upstream rows are pinned by an executed test rather than by yaml alone. The golden lanes are unaffected: `session-turn-outline` is host-only (no `dsh.client` half) and `ui-schedule` is disabled, so the assembled jsdom graph skips both. When a fork surface starts rendering outline entries, the projection key is already on the wire and the seat decision (rail placement, business wording) is a product-surface change, not a roster change.

## Alternatives considered

**Hold the row like `ui-schedule` (wayfinder #85 verdict ①)**: rejected — the outline is a pure read model with no interaction surface to walk through, upstream enables it by default, and taking it costs one roster row while a hold would re-litigate the same take after the schedule walk-through.

**Fork or re-wrap the projection**: rejected — the unit is a pure upstream session-domain fold; the roster row plus the projection registry the base bundle already mounts is the whole integration, and a wrapper would duplicate the fold the seam already owns.

**Apply #40 vocabulary mapping now**: rejected as premature — no fork surface renders the entries, so any mapping written today would bind a surface that does not exist; the mapping's home is the first rendering surface (see Decision).
