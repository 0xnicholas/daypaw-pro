# Agent Note: Durable child runs — `ctx.spawn` and the cancellation cascade

Status: implemented

English | [中文](2026-09-19-daypaw-spawn-child-runs.zh.md)

## Problem

`ctx.spawn` was the one primitive ADR 0003's five-member family left undesigned — ADR 0010's child-run composition covers the awaited form, and the primitive's compiled face belongs to the SDK ([ticket #125](https://github.com/0xnicholas/daypaw-pro/issues/125)).

The gap was narrower than it looked. Child runs already existed in two awaited forms (`ctx.agent`, and the bare `run()` inside `ctx.step`), the ledger already recorded `parent_run_id` / `parent_step_key`, `runLineage` already read both, and the boot scan already revived every unfinished run without asking who its parent was. Fire-and-forget even ran: start a child inside a `ctx.step` and drop the handle — both layers mark the result promise handled, so nothing crashes.

The primitive carries three requirements: an API that says "detach this work" rather than "forget to await"; a recorded dispatch fact presentation can read, since spec 05 §2 promises spawned children their own section in the parent's detail; and lifecycle decisions the awaited forms never forced — what a parent's end does to a child still running, what a child's failure does to its parent, and how many children an author may start at once.

Two adjacent defects belong to the same change. The reserved step-family keys counted flat calls per body execution, but a re-drive skips the `fn` of every completed step — so a primitive called after a skipped step re-derived an *earlier* occurrence: a spawn attached to the wrong child, and a sleep read an already-fired timer row and returned through a wake it never took. And cancelling a parent never touched its children: a run the operator cancelled could leave a child agent burning tokens, revived forever by the boot scan and unreachable from the UI, because the board hides child runs and `cancel` on a terminal parent returned early.

## Decision

- **`ctx.spawn(def, input): Promise<string>` is a first-class primitive, and its dispatch fact lives on the child run row** — the child starts under a reserved slot key (`spawn:<n>`, or `<stepKey>/spawn:<n>` inside a step) with `parent_run_id` / `parent_step_key` recorded, on the deterministic child runId the awaited idiom already derives. No new journal kind, no table, no migration, no wire change: the child row *is* the record, and a re-drive walking the same call order re-derives the same id, so start-or-attach attaches instead of spawning twice.
- **Awaiting a spawn covers the child's start, never its result** — the call returns only the child's runId. No handle, no `result`, no `cancel`: detaching is the point. Observing stays with the awaited forms, and observing or joining a spawned run is a future primitive, left open.
- **Cancelling a run cancels its unfinished subtree** — `cancel(root)` writes its own terminal row, settles its own pending gates, then recurses through every unfinished descendant; a finished descendant is left exactly as it is. `done` / `failed` never cascade: children are separate obligations that keep running, revived by the boot scan as before. A `cancel` on an already-terminal run still cascades, which is what makes "stop this work" reachable for a spawned child whose parent has already finished.
- **A child's failure never enters its parent's failure surface** — the parent's `status` and `output` are its own; the failed child is visible through the lineage its parent's detail reads.
- **No concurrency cap in v1** — spawn adds no resource class the awaited idiom did not already have (`Promise.all` over child runs), and a cap without a queue can only reject, not throttle. Recorded as a known limitation with its triggers.
- **Reserved slot keys count per scope** — the top level keeps `sleep:<n>` / `spawn:<n>`, a call inside a step keys under that step (`<stepKey>/sleep:<n>`), and each scope has its own counter, so a skipped step cannot shift an outer call's occurrence. `ctx.sleep` follows the same rule.
- **Presentation and the wire stay out of this change** — `WireRun` gaining `parent_step_key`, the shell's spawned-children section, and the board's list row are the shell's work; the ledger carries the fact they need.

## Alternatives considered

**A journal row `kind = 'spawn'` beside the child row.** It would put "dispatched here" on the parent's step timeline. Rejected: the child row already carries the same fact as its parent linkage, so this writes one fact twice, and the new kind flows into `durable/journalTimeline`, where the browser plane's closed `JOURNAL_KINDS` parser and the shell's rendering switch would have to ride along in the same change — plus a crash window between the two writes for a re-drive to reconcile.

**Thin sugar, or no primitive at all.** `ctx.spawn` as a step that starts a child and drops the handle adds no capability over hand-written code, and documenting "start it inside a step and do not await" as the idiom leaves spec 05 §2's presentation promise without a supply: nothing in the ledger would distinguish a spawned child from one the parent is waiting for.

**A read-only handle (`{ id, status(), cancel() }`).** Rejected: a `cancel()` on the spawn face quietly writes "the parent owns this child's lifetime" into the primitive, against the detachment the primitive exists for. If a parent must stop a child, the cancellation cascade — or a future primitive — is where that decision belongs.

**Rejecting a child start under a terminal or missing parent in the engine's `run()`.** This closed the race where a cancelled body could still insert a child, but it contradicts an existing contract: the engine deliberately allows recording lineage under a settled parent (the lineage read face and its tests record run lineage under a settled parent, exactly the case this guard would reject), and "parent finished, child still running" is a designed state, not an error. The SDK's `ctx.spawn` holds the guard, refusing a child start once the driver signal is aborted.

**A per-parent or per-engine concurrency cap.** The threshold has no consumer to calibrate it, and a global cap is an engine-level operational concern, next to the three replaceable seams a daemonized deployment swaps — not something the spawn definition should smuggle in.

**A `spawned` column on the run row.** Redundant with the `spawn:` prefix on `parent_step_key`, which is already the single fact.

## Consequences

- The five-primitive family is complete: `ctx.step` / `ctx.sleep` / `ctx.waitFor` / `ctx.agent` / `ctx.spawn`.
- Cancellation covers "this run and its unfinished subtree", which includes a cancelled parent's awaited child and a spawned child that has outlived its parent, so an operator has a stop path for both.
- `sleep` key derivation is scoped: a top-level sleep records `sleep:<n>`, a sleep inside a step records `<stepKey>/sleep:<n>`.
- Nothing model-visible changed: no session event, no `SESSION_FORMAT_VERSION` bump, no wire change. A spawned child of an agent-kind definition still gets its own session (sessionId ≡ runId), so it appears in the session plane exactly as any child run does.
- The driver-side cancellation path degrades the way its failure twin already did: a store outage while recording a cancellation is logged, never left hanging the run's result promise. The operator path (`cancel()`) stays loud — the caller learns the walk failed while the addressed run's stop stands, and a later cancel sweeps what the fault skipped.
- Coverage stays per-file 100%: `engine/tests/cancel-cascade.spec.ts` and `sdk/tests/spawn.spec.ts` carry the cascade and spawn cases; `sleep.spec.ts` and the fault-injection suite carry the scoped-key, misalignment, and subtree-walk cases.
