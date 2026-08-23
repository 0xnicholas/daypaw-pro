# Agent Note: daypaw walking skeleton — three packages and the SIGKILL proof line

Status: implemented

English | [中文](2026-08-19-daypaw-walking-skeleton.zh.md)

## Problem

ADR 0008 defined the walking skeleton as the thinnest end-to-end durable slice — `@daypaw/store` + `@daypaw/engine` + `@daypaw/sdk`, `defineWorkflow` + `run()` only — with one proof line: a canonical example killed mid-run by a real `SIGKILL` resumes after restart and completes with a typed result. Spec ch.1 fixed the semantics (ledger schema, step dedup, claim, boot scan) but three implementation decisions were open: where the Cordis boundary sits, what "attach" is allowed to do, and when the boot scan runs.

## Decision

- **Core/service split inside `@daypaw/engine`** — `DurableEngineCore` owns every state transition over a `JournalStore` seam and holds no Cordis and no database handle; the `ctx.durable` `Service` is a thin adapter that opens/migrates the ledger and delegates. The fault-injection suite drives the core through Proxy-wrapped stores (per-method faults), which is the seam's second real consumer and keeps error-path tests free of process theater. Dispose-as-crash bridges in-process testing to the SIGKILL suite, which spawns the real example host via `node --import tsx/esm`.
- **Attach never claims; the boot scan revives** — `run()` on an unfinished foreign-claimed run polls at `pollMs` instead of claiming. Claiming is reserved for the boot scan, because a live-vs-dead foreign claimant is indistinguishable without heartbeats (ADR 0002 §2); a stolen claim from a live driver would double-drive. The boot scan runs at construction *and after every `register()`* — a service's registry is necessarily empty at construction, so registration is the earliest moment a revival can succeed; runs whose definitions are not yet registered stay unfinished and warn.
- **Terminal-race and disposal rules** — a body completing after its run was settled elsewhere (cancellation lands at step boundaries) rejects with the terminal row's outcome via `finalizeRun`'s conditional-update result; a body completing after engine disposal rejects `ENGINE_DISPOSED` without touching the ledger, leaving the run revivable. Result promises carry a handled-marker so boot-revived runs that fail never crash the process.

Supporting moves: `retry_policy_json` stays out of migration 0001 (issue #24); migrations are hand-written SQL in TS template strings so compiled `lib/` stays self-contained; `register`/`run` on the service are async because the ledger opens asynchronously (methods await readiness, storage-sqlite pattern); the invariant companions are explicit "No runtime invariant:" markers — the core holds no Cordis event stream to hook, and the fault-injection suite owns the run/journal/promise state-machine assertions.

## Alternatives considered

- **Run-attach claims revivable runs** — rejected: indistinguishable from stealing a live driver's claim; polling is the only semantics attach can promise.
- **Boot scan once at construction** — rejected: the registry is empty then; every revival would depend on a second, API-invisible trigger. Registration-triggered scans make "boot scan revives" true exactly when it becomes possible.
- **Dispose as failure** — rejected: writing terminal states on teardown would make unfinished runs unrevivable and couple process lifetime to run outcomes.
- **`.sql` files for migrations** — rejected for build self-containment: tsc does not copy assets, so compiled consumers would read a missing file; numbered TS template strings keep the review properties spec ch.1 §4 names.

## Consequences

- The proof line passes: kill after the first step's effect, restart, and the first step runs exactly once while the in-flight one re-executes (at-least-once execution, exactly-once step commits).
- Two live processes driving one ledger remain outside v1's envelope (documented in the engine README); the attach-poll path covers the ops scenario instead.
- The promise rows, `waiting` status, and gate resolution this note deferred landed with `ctx.waitFor` (issue #47, [gate note](../feature/2026-08-23-durable-gate-waitfor.md)); the timer table, `ctx.sleep`, and relational invariants remain demand-driven future work.
