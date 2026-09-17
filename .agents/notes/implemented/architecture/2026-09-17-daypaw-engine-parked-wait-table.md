# Agent Note: One parked-wait table and one settled-run decode in the engine core

Status: implemented

English | [中文](2026-09-17-daypaw-engine-parked-wait-table.zh.md)

## Problem

`DurableEngineCore` told the same two stories twice each. Two suspensions — `suspendOnGate` and `suspendOnSteer` — hand-built the same parking sequence: a promise with captured resolve/reject, a handled marker for abandoned waits, a `setInterval` reading the ledger as the cross-process fallback, an abort listener meaning "cancellation or disposal", and teardown of entry, interval, and listener that had to be idempotent. `suspendOnSteer`'s own doc comment admitted it mirrored `suspendOnGate`, and both wait tables were hand-written maps keyed by hand-built strings.

The decode from a run row to its terminal outcome was written four times: `statusFromRow`, `settledResult`, `terminalRejection`, and the attach poll's inline switch. Two of the four — `settledResult` and the poll's switch — were the same decision table under different plumbing; the other two restated pieces of it (the cancelled cause, the failed error). Each copy was correct, and each could drift alone. Single-writer and first-terminal-wins live exactly there: `done` means the parsed `output_json`, `failed` means `RUN_FAILED` carrying the parsed `error_json`, `cancelled` means `RUN_CANCELLED` carrying `cancel_cause` ([ticket #117](https://github.com/0xnicholas/daypaw-pro/issues/117)).

## Decision

`WaitTable<T, E>` is the core's one parked-wait implementation. A suspension registers a `WaitSpec` — the table key, the driver signal, the message a duplicate park throws, the entry external writers deliver through, a `poll()` returning a `WaitVerdict` (`wait` / `deliver` / `fail`), what an abort means, and an optional deadline — and the table owns the rest: the promise, the abandonment marker, one delivery-or-failure ending behind an `ended` latch, the cross-process interval, the deadline timer, the abort listener, and teardown of all of them with the first ending. `gateWaiters` and `steerWaiters` are two instances of it.

What a suspension still supplies is what makes it itself. The gate's entry carries the live value contract `resolveGate` validates a same-process settlement against, and releases its run out of `waiting` when it delivers. The steer entry carries the segment count the body had already consumed, wakes its body without a payload, and rejects an abort. The gate's timeout keeps its own shape: expiry records `timedout` first-wins, then delivers through the same strict reader the push paths use, so a ledger that reports a row as still pending right after settling it fails the wait loud rather than parking it forever.

`settledOutcome(row)` is the one decode of a run row into a `SettledOutcome` — `done` with the recorded output, `failed` and `cancelled` with the payload a rejection reports — and `undefined` while the row is in flight. Every reader goes through it: `statusFromRow` projects the outcome onto the public status union (dropping the output of `done`), `run()`'s attach branch asks whether an outcome exists instead of testing `isTerminal` and decoding again, `settledResult` and the attach poll turn it into resolve-or-reject, and `terminalRejection` takes its cancelled arm from it. One `rejectionOf` builds every `EngineRunError` a settled row reports, so no reader can disagree with the row it read.

The driver-exit sweep selects parked entries by their own `runId` rather than scanning composite keys for a prefix, so it no longer depends on the key format `gateWaiterKey` produces.

The public face is unchanged: no export, no `@Remote` endpoint, no ADR 0002/0006/0010 statement.

## Alternatives considered

**Two hand-written twins and a comment saying so.** That was the state this decision removes. The second implementation was correct, but only derivable by reading the first: a change to poll wiring, abort semantics, or teardown discipline had to be made in both, and nothing in the file said which parts were the shared mechanics and which were the suspension's own.

**A subclass per suspension over a shared base.** A `GateWait` / `SteerWait` pair would need the running core (store, poll interval, disposal flag) to implement its ledger read, coupling each wait object to the engine's private face. The spec object keeps the table ignorant of both, and the suspension's own additions stay visible at its call site.

**A terminal-only decode that throws on in-flight rows.** It reads well at the settled call sites and fails on the in-flight ones, but that throw is unreachable — `run()` and the poll decode only rows they have already seen leave the in-flight states — and the per-file 100% coverage bar rejects an arm no test can execute. Returning `undefined` for those states keeps the decode total and gives both callers a real branch.

**Narrowing the settled readers to a settled row type.** TypeScript narrows `row.status`, not the `RunRow` interface, so a settled-row predicate with a narrowed parameter would need either a cast or a second decode of the same row. The `undefined` arm carries the same information with neither.

## Consequences

- `handle.status()` on a `done` run now parses `output_json`, because the status face is a projection of the one decode. A row whose output cannot be parsed fails loud at `status()` instead of reporting `done` — accepted: the ledger is the authority for how a run ended.
- The completion race reads its cancelled arm through the decode, so a raced `failed` row with an unparseable `error_json` surfaces that parse error in place of the `reached terminal state … before completion` message.
- Mutation probes over the new seam — deleting the delivery's release, either driver-exit sweep, the poll's pending arm, the deadline write, the abort ending, and the decode's cancel cause — found three facts the suite executed but never asserted: the gate delivery's `waiting` → `running` release and the effect of both driver-exit sweeps. `tests/gate.spec.ts` gains the release assertion, `tests/fault-injection.spec.ts` gains the abandoned gate wait and strengthens the abandoned steer wait to assert the rejection its name already promised.
- The `ended` latch is redundant-work protection, not an observable guarantee: the first ending unregisters the entry, so a second ending is unreachable in practice, and a probe that deletes the latch leaves the suite green.
- `core.ts` holds its per-file 100% coverage bar, and `pnpm run duplication` still reports zero clones.
