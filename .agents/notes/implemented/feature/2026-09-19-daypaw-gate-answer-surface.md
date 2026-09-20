# Agent Note: Answering a durable gate from the shell

Status: implemented

English | [中文](2026-09-19-daypaw-gate-answer-surface.zh.md)

## Problem

A human gate is one of pillar ①'s promises: ADR 0002 §3 fixes a single durable-promise seam whose resolve entries are SDK calls, a Manager UI, and (deferred) webhooks, and the shell's 等待你确认 triage presents a waiting run as a task that needs a person.

The browser plane carries no gate fact at all. `WireRun` omits `runs.waiting_gate`, and `resolveGate` carries no `@Remote` marker, so the seam's only settler is host code inside the product process. A workflow suspended on `ctx.waitFor` therefore reaches its timeout branch while its board row reads as awaiting confirmation ([ticket #128](https://github.com/0xnicholas/daypaw-pro/issues/128); the first real workflow load recorded the timeout with an empty `resolution_source`).

A gate's value contract is arbitrary JSON — the engine persists its `schema_json` for form rendering (ADR 0002 §3) — so an answer surface needs a caller-written value, not a fixed pair of buttons.

## Decision

- **The read face is the run row.** `WireRun.waitingGate` mirrors `runs.waiting_gate`; the ledger row already crosses `durable/listRuns`, so the browser plane keeps a field it was discarding instead of gaining a second read. A parked run's gate name is what both the triage and the card key off.
- **One triage, one marker.** `TaskRow.awaiting: 'approval' | 'gate'` feeds the 等待你确认 group: a session's pending approval and a run suspended on its own gate land together, told apart by kind. The row's status text stays the strict waiting copy either way.
- **The write face is `@Remote('resolveGate')`.** The browser omits `source` and the host records `'manager'` (ADR 0002 §3's Manager UI entry), while SDK callers keep passing theirs. The boundary type `WireGateSettlement` types the approval value as `Json` because a Remote parameter cannot carry unconstrained `unknown`; the host seam keeps `GateSettlement`'s wider value. first-wins stays observable — a `false` answer means the gate was settled by someone else, a timeout, or a cancellation.
- **The answer card lives in the detail column.** A session-less workflow run has no conversation seat to pin a card to, so the card renders above the run's sections: the gate name as the definition declared it, a JSON box for the approval value with local syntax validation (the gate's own contract validates host-side), an optional reason box for a rejection, and three outcome copies — answered, already settled elsewhere, and an inline failure that never echoes host wording. Drafts belong to one run and reset when the selection moves.
- **The engine keeps its silent first-wins semantics.** An unknown run or a stale gate answers `false` rather than throwing: that is the documented contract of the seam, and the card reads it as "someone answered or it timed out".

## Alternatives considered

**Schema-driven form rendering now.** It needs the promise's `schema_json` on the wire plus a form renderer, and ADR 0002 §3 already assigns that face to the Manager UI; the JSON box serves the technical-user surface in the meantime, and the platform's own new-task dialog answers arbitrary definition contracts the same way.

**A dedicated pending-gate endpoint.** `durable/listRuns` already returns the whole row, so the gate name rides the board's existing poll; a second endpoint would duplicate that cadence and give the same fact two homes.

**Making the host seam loud on unknown or terminal runs.** The seam's first-wins no-op is a documented contract for SDK callers, and the browser case it was meant to serve — a gate answered elsewhere, or one that timed out between render and click — is exactly what the no-op reports.

**A valueless approve/reject pair.** Every gate that declares a contract would reject an empty approval (the first real load's gate wanted `{approve:true}`), so the pair would ship a button that cannot succeed for the gates that exist.

## Consequences

- A person can answer a real workflow's gate, and the ledger records the shell's answer as `resolution_source = 'manager'`; the parked body resumes through the same delivery path an SDK settlement takes.
- Two facts stay off the wire: the gate's `schema_json` and its deadline. A gate author's expected value is discoverable from the definition, and a card therefore cannot show how long the gate has left. Recorded as a named gap on the Manager follow-up rather than a silent omission.
- Coverage: the engine's gate spec asserts the browser-default source; the client specs cover the run parser's gate field and the resolve call's envelope and answer typing; the projection spec covers the gate triage; the card's own spec covers approve, reject, malformed JSON, a lost settlement, a wire failure, and the draft reset; the assembled lane gains `gate-answer.golden.ts`, where the fixture parks a run on a gate so the triage, the card, and the round trip are proven against the built bundles.
- The fixture's ledger gained a waiting run, so the existing assembled goldens move with it: the 等待你确认 count carries two entries, and the parked run's row joins the pending list.
