# Agent Note: Durable timers — `ctx.sleep`

Status: implemented

English | [中文](2026-09-19-daypaw-durable-timer.zh.md)

## Problem

Spec 01 §6 fixed `ctx.sleep` semantics and §3.4 designed the `timers` table, but the walking skeleton deferred both ("land on demand: implement when the first real workflow needs a sleep"), and the [gate note](2026-08-23-durable-gate-waitfor.md) covers `ctx.waitFor` only ([ticket #124](https://github.com/0xnicholas/daypaw-pro/issues/124)). A workflow that must wait for wall-clock time therefore had no durable primitive: a plain `setTimeout` re-executes on re-drive, and a process death loses the wait entirely.

Four things were still undecided. The primitive takes no name, so where its step-family idempotency key comes from. What a re-drive does with a deadline that was recorded but never reached — wait for it, or restart the count. Who writes the `fired` flag, and in what order relative to the body resuming. And where a deadline that passed while every process was down gets accounted for.

## Decision

- **`timers` is a store-owned table (migration 3)** — `(run_id, step_key)` primary key, `wake_at`, `fired` (0/1), `created_at`, with the spec's overdue query `fired = 0 AND wake_at <= ?`; `TimerRow` and `TIMERS_TABLE` join the store contract, and a golden `0003-v3.db` fixture covers the segment. A sleep occupies the step-family idempotency slot, so no `kind` value is added to `journal`.
- **The key derives from call order** — `ctx.sleep(durationMs)` takes no name, so the engine derives `sleep:<occurrence>` from the call's position in the body, exactly as step keys derive from `name#occurrence`. The `sleep:` prefix is reserved the way `steer:` is, and a re-drive that walks the same calls re-derives the same keys (spec 01 §10's determinism requirement).
- **A recorded deadline governs the re-drive** — a fired row returns without waiting again; an unfired row is waited for until its *recorded* `wake_at`, so a crash neither restarts nor extends a sleep (the duration a revived body passes is ignored); an unfired row whose deadline already passed returns immediately. That is "wakes at least once, a late wake is not dropped".
- **The wake is durable before it is delivered** — expiry flips the row (`UPDATE … WHERE fired = 0`, first-wins) and only then resumes the body, so a crash after the wake cannot re-wait. The in-process `setTimeout` deadline, the body's own overdue read, and the boot scan's sweep are the three callers of that one conditional write.
- **The park reuses the wait table** — `ctx.sleep` parks through the `WaitTable` seam (#117): deadline = the recorded `wake_at`, poll = the run row (a cross-process cancellation or a terminal row ends the park), abort = `RUN_CANCELLED` (cancellation) or `ENGINE_DISPOSED` (disposal). A sleeping run keeps the ledger status `running`: a sleep is not a gate, `waiting_gate` records gates only, and boot revival covers `running` and `waiting` alike.
- **The boot scan records passed deadlines as its last step** (spec 01 §5 step 4) — after the overdue-promise sweep and the run-revival loop, every unfired timer with `wake_at <= now` is fired, including timers of runs whose definitions nobody revived, so the ledger carries the passed deadline even when nothing consumes the wake.
- **The SDK inherits the primitive** — `WorkflowCtx extends EngineStepCtx`, so `ctx.sleep` reaches workflow bodies through the engine's declaration; `enrichStepCtx` passes it through. No Remote endpoint, no Manager view: a timer read face belongs to the Manager subproject.

## Alternatives considered

**A `TimerScheduler` provider seam.** Spec 01 §7 names timer scheduling as one of three replaceable interfaces for the daemon path. Rejected for now: one implementation exists and no second consumer is in sight, so the store methods plus the core's park are the seam — the same call the [gate note](2026-08-23-durable-gate-waitfor.md) made for `PromiseResolver`, and the extraction condition is unchanged (a second implementation).

**Recording the sleep in `journal` with `kind = 'timer'`.** The journal's `kind` column carries no timer/sleep value. Rejected: §3.4 gives timers their own table with the `wake_at` and `fired` columns the two readers need (the body's dedup read, the boot sweep's overdue scan), a journal row would add a second dedup authority for one call, and `journal` readers (step timeline, steer segments) would have to filter a third kind. Spec 01 §3.2 routes sleeps to the `timers` table.

**`ctx.sleep(name, duration)`.** A name would give each sleep a hand-written key with no derivation assumption. Rejected: the spec and ADR 0003 fix the signature as `ctx.sleep(duration)`, the step precedent already derives keys from call order, and a reserved prefix keeps derived keys out of user keys — the `steer:` precedent.

**A bare `setTimeout` plus an abort listener.** The cheapest park, and the deadline is a timestamp either way. Rejected: a run sleeping for hours would not observe a cross-process `cancel` until its deadline, a leftover timer would need its own driver-exit cleanup, and the `WaitTable` park already provides the poll, the deadline, the abort meanings, and the teardown (the seam #117 landed for exactly this third suspension).

**Firing only in the boot sweep, or only in the body's read.** One write site would be simpler to reason about. Rejected: the body's read must answer "is my deadline recorded" anyway to dedup, and a revived run whose sweep had not run yet would park on a deadline that already passed; both sites writing through one `fired = 0`-guarded update keeps them convergent instead of order-dependent.

**Marking the run `waiting` while it sleeps.** It would make sleeping runs visible through the same status discriminator gates use. Rejected: `waiting_gate` holds a gate name and `RunStatus.waiting` carries that name; the steer park already keeps `running`, and revival claims `running` runs too.

## Consequences

- A workflow can wait across wall-clock time durably: killed mid-sleep, revived after the deadline, it resumes past the sleep without re-running the steps around it, and the ledger shows one fired timer row (`sleep:0`) plus the completed steps.
- Timers stay deliberately unpunctual — nothing wakes a process — so a sleep's wake happens at the next boot after its deadline when no process was running (spec 01 §10's operations note, now backed by shipped behavior).
- `fired` records that the deadline passed, not that a body consumed it: the boot sweep fires a timer whose run nobody revived, and the later re-drive returns immediately. A cancelled or disposed run leaves its timer unfired, because the sleep never woke.
- The engine keeps its per-file 100% coverage bar: `tests/sleep.spec.ts` carries 14 behavior cases (record/wake, overdue re-delivery, recorded-deadline wait, fired dedup, unrevivable-run sweep, zero duration, concurrent sleeps, same-process and cross-process cancellation with and without a cause, terminal row, disposal, mid-sleep re-drive, abandoned wait) and the fault-injection suite gains 9 timer cases (lookup/insert/expiry-write/overdue-write/scan faults, park-poll faults, and the injected-clock restart that re-delivers an overdue timer without doubling effects).
- The example's SIGKILL proof line grows the timer scenario: the skeleton workflow takes an `sleepMs` input, and `tests/sigkill.spec.ts` kills the host while it sleeps, returns after the deadline, and asserts exactly-once steps around a fired timer.
- `JournalStore` reads grow by three timer methods plus the overdue scan; the `SqliteJournalStore` implementation and the store migration are mechanical beside them.
