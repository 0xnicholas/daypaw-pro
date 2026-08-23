# Agent Note: Durable gate primitive — `ctx.waitFor` / `resolveGate`

Status: implemented

English | [中文](2026-08-23-durable-gate-waitfor.zh.md)

## Problem

Spec 01 §6 defines durable promises as the HITL gate: a workflow parks on a named gate, an external actor resolves it, and the run must survive process death in between. The [walking-skeleton note](../architecture/2026-08-19-daypaw-walking-skeleton.md) deferred promise storage and the `waiting` status to this demand-driven work (issue #47). Four decisions were open: land the gate alone or together with `ctx.sleep`, whether promise resolution gets its own seam package, where payload schema validation happens, and which settlement semantics apply when two resolutions race.

## Decision

- **Gate first, sleep deferred** — `ctx.waitFor` lands alone on `EngineStepCtx` (and as `WorkflowCtx.waitFor` in the SDK, whose zod option schema is adapted to JSON Schema via `adaptGateSchema`); `ctx.sleep`, the timers table, and any `PromiseResolver`/`TimerScheduler` seam stay unbuilt until a scheduling caller exists.
- **Resolution lives in the core, no new seam package** — promise rows move through seven new `JournalStore` methods (`insertPromise`, `selectPromise`, first-wins `settlePromise`, `selectOverduePromises`, `cancelPendingPromises`, `setRunWaiting`, `resumeRun`) over the store package's migration-2 `promises` table (primary key `(run_id, gate)`, five states pending/resolved/rejected/timedout/cancelled); with exactly one store implementation, a `PromiseResolver` abstraction would be speculative generality.
- **Two-level schema validation** — the write side validates only when a same-process waiter exists (fail the resolving caller, record nothing), because a cross-process resolver writing through another engine instance cannot be checked there; the delivery side always validates the recorded row before handing the value to a waiter, and a recorded-but-invalid resolution fails the run instead of delivering.
- **First-wins settlement** — `settlePromise`'s conditional UPDATE lets the first recorded settlement win, matching the dsh jobs-settlement precedent and Resonate's strict mode; a losing `resolveGate` observes the recorded row rather than overwriting it.
- **Three-way wakeup per waiter** — a same-process waiter is pushed directly out of `resolveGate`; a cross-process settlement is found by `pollMs` polling; a `setTimeout` armed from `timeoutMs` settles `timedout`. Abort delivers a `cancelled` *value* (a valid gate outcome the workflow may switch on), while engine disposal rejects `ENGINE_DISPOSED`; waiter promises are pre-marked handled so abandoned waits never crash the process.
- **Boot scan sweeps overdue promises** before reviving drivers, settling them `timedout` and notifying live waiters; `waiting` joins `EngineRunStatus` as `{ state: 'waiting', gate }` and is read back from the row's `waiting_gate` column, with a null gate on a waiting row reported as ledger/record mismatch; `cancelRun` (now async) and driver-side cancellation cancel pending promises, and the driver `finally` abandons orphaned waiters so a body dying mid-wait leaks no poll timer past `db.close()`.

Two latent bugs surfaced and were fixed in the same change: `finalizeCancelledFromDriver`'s `status !== 'running'` guard skipped finalization for waiting runs (now `isTerminal`-based), and pre-fix `cancelRun` threw synchronously, breaking its promise contract.

## Alternatives considered

- **Landing gate and sleep together** — rejected on scope: the timer side has its own open semantics (delay vs cron, missed-fire policy) and no caller yet; the gate primitive is independently useful for HITL.
- **A `PromiseResolver`/`TimerScheduler` seam package up front** — rejected: one implementation exists; the seven store methods are the seam, and extracting an abstraction now would invent a boundary without a second consumer.
- **Resolve-side-only validation** — rejected: a cross-process resolver (future Manager/webhook, or raw SQL) bypasses it; delivery-side validation is the only point every resolution must pass.
- **Last-wins or write-then-error settlement** — rejected: racing resolvers would flip a settled gate or leave the winner ambiguous; first-wins keeps the ledger authoritative and matches the jobs-settlement precedent.

## Consequences

Workflows can park on human input durably: a run suspended on a gate consumes no compute, revives after `SIGKILL` by re-anchoring on the promise row, and observes exactly one settlement. Cancelling a waiting run cancels its pending promises without touching a neighbour run's waiters on the same gate name. A cross-process resolver gets no write-side validation — documented as a known limitation in the engine README — because validity can only be enforced at delivery there. The invariant companion stays an explained-empty marker: the core holds no Cordis event stream to hook (gap-2 ruling), so the gate state machine is asserted by the fault-injection suite at every journal append point (14 cases) plus 19 behavioral cases; `ctx.sleep`, the timers table, and the Manager/webhook caller remain future work.
