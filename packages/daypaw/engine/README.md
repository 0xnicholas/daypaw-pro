---
description: "The durable execution engine (ctx.durable): run lifecycle, step-dedup re-drive, durable gates (ctx.waitFor), the steer channel for opted"
kind: "package-reference"
---

# @daypaw/engine

English | [中文](README.zh.md)

## Summary

## Table of Contents



The durable execution engine (`ctx.durable`): run lifecycle, step-dedup re-drive, durable gates (`ctx.waitFor`), the steer channel for opted-in definitions, single-writer claims, and boot-scan revival over the [`@daypaw/store`](../store/README.md) ledger. Load it as a Cordis plugin; applications call it through the typed [`@daypaw/sdk`](../sdk/README.md) facade. Semantics: [spec ch.1](../../../docs/spec/01-durable-execution.md); walking-skeleton scope: [ADR 0008](../../../docs/adr/0008-landing-order-walking-skeleton.md).

## Service API

`ctx.durable` (plugin `@daypaw/engine`):

- `register(def)` — record an opaque definition (kind/name/version + body thunk) for execution and boot-time revival. Same identity with a different body rejects; registering runs a boot scan that may revive unfinished runs left by a previous process.
- `run(def, input, { runId?, signal?, parent? })` — idempotent start-or-attach: unknown runId inserts and drives; a terminal run settles from its row; a run this process drives returns its live handle; anything else is polled (`pollMs`) — attaching never claims, reviving is the boot scan's job. `parent` (`{ runId, stepKey }`) records the caller's lineage on insert (`parent_run_id` / `parent_step_key`); an existing runId attaches without rewriting lineage.
- `idle()` — resolves when this process drives no run.
- `listRuns(filter?)` — run rows from the ledger, newest first, optionally restricted to one `status`.
- `runLineage(runId)` — one call for a run's own row, its parent, and its direct children (oldest first); every field is empty for an unknown runId.
- `journalTimeline(runId)` — the run's journal steps in start order.
- `listDefinitions()` — the definition registry's one read face (spec 05 §5): every registered definition in registration order as `{ kind, name, version, display, inputKind }`, never the body. `display` is optional metadata a definition declares for host catalog views (`title` + `description`); the key is absent when undeclared (never undefined-valued, so the answer stays JSON-safe) and carries no execution semantics. `inputKind` is the wire presentation for browser-initiated starts (ADR 0012): `text` / `json` when the definition carries a `wire` face, `null` otherwise. Each call returns fresh copies, so the registry cannot be mutated through the result; `register` stays the only write surface. The method doubles as the browser catalog's wire face: the service carries a `TypertRemoteService` binding and the method an `@Remote` marker, so the API gateway claims `durable/listDefinitions` (the GoalService precedent) without any apiproxy edit.
- `startRun(request)` — start a run of a registered definition over the wire, or attach to an existing runId (idempotent start-or-attach, ADR 0012): `{ defName, defVersion?, input, runId? }` → `{ runId }`. An exact version pins the identity; an omitted version resolves the name's unique registered definition and rejects when several coexist (kinds share the name space — an agent and a workflow under one name are an ambiguity, not a precedence), naming the candidates. Input is validated through the definition's `wire.parseInput` when it carries one; a definition without a wire face records the input verbatim. The handle's result is deliberately not returned: browsers observe runs through `listRuns` / `journalTimeline`, so a failed run must not surface as an unhandled rejection on the host. The method carries the `@Remote` marker (`durable/startRun`, the `listDefinitions` precedent).
- `resolveGate(runId, gate, settlement, source)` — the one settle seam for gates (first-wins): SDK direct calls, Manager UI, and (deferred) webhooks share it. When this process holds the waiter, the value contract validates before the write — an invalid settlement throws and records nothing; a second settler is a no-op returning `false`. A driver waiting in this process resumes immediately; cross-process writes are observed through the driver's `pollMs` poll fallback, and a dead process's waits revive through the boot scan.
- `steer(runId, input)` — append a follow-up segment to an unfinished run (issue #53): throws on an unknown runId, a terminal run, or a locally registered definition that did not opt in with `steerable: true`. Durable before delivery: the segment row records first, then a body parked in this process wakes immediately; elsewhere the parked wait's `pollMs` poll or the next boot scan observes it. Returns the 1-based segment sequence. The method carries the `@Remote` marker, so the browser reaches it as `durable/steer` (the `listDefinitions` precedent).
- `rerun(runId)` — retry a terminal top-level run (issue #57): throws on an unknown runId, an unfinished run, a child run (a child rerun would detach the attempt chain from the parent's step journal — retry the top-level run instead), or a definition this process never registered. Otherwise inserts a fresh row with the same definition identity and input — `attempt = source.attempt + 1`, `retried_from_run_id = source.run_id` — through the `insertAndDrive()` extraction shared with `run()`'s start branch, and drives it, returning the new run id. Carries the `@Remote` marker (`durable/rerun`).
- `cancel(runId, cause?)` — request cancellation of an unfinished run (ticket #74): the terminal `cancelled` row with the cause is written first, pending gates settle cancelled, and a driver in this process aborts. Idempotent on terminal runs — a run that already ended satisfies the request, and a lingering driver still aborts (a fault between the terminal write and the abort can leave one) — and loud on unknown runIds. Carries the `@Remote` marker (`durable/cancel`, the `steer` precedent).

The query methods (`listRuns` / `runLineage` / `journalTimeline`) are the ledger's one query home (spec 05 §5): hosts read runs, lineage, and step timelines through `ctx.durable`, never through host-side SQL, so query knowledge evolves with the schema. Presentation vocabulary stays above this seam — the rows keep engine names. Each carries an `@Remote` marker (the `listDefinitions` precedent), so the browser board reaches them as `durable/listRuns` / `durable/runLineage` / `durable/journalTimeline` through the gateway without an apiproxy edit. Their wire types re-export through this package's `types.ts` from [`@daypaw/store/types`](../store/README.md) (and `seams.ts` / `core.ts`) because the Typert analyzer scans the declaring package's exports subpaths, and `RunLineage` members are `| null`, never `undefined` — JSON drops undefined-valued keys, so the wire value must agree with the declared type.

Configuration (schemastery): `path` (ledger file or `:memory:`), `pollMs` (attach poll interval, default 1s).

## Execution model

A run drives its body with a step ctx. `ctx.step(name, fn, { key? })` derives the idempotency key `name#occurrence` (or takes an explicit key); a completed step returns its recorded result without re-executing, an unfinished one (re)executes and records — at-least-once execution, exactly-once step commits. Cancellation writes the terminal row first and takes effect at the next step boundary. Disposal stops driving without terminal writes: unfinished runs stay revivable.

`ctx.waitFor(gate, { schema?, timeout? })` is the HITL suspension primitive (spec ch.1 §6): it registers a pending promise row keyed by `(runId, gate)`, moves the run to `waiting`, and yields the driver — waiting costs nothing, and a dead process revives through the boot scan, where the re-driven body reads the recorded outcome at the same `waitFor` without waiting again. The terminal outcome returns as a `GateResolution` union value (`resolved` / `rejected` / `timedout` / `cancelled`): timeout, rejection, and cancellation are programmable branches, never thrown. `timeout` is a millisecond duration; a live process writes `timedout` first-wins from `setTimeout`, and a deadline missed while dead is swept by the boot scan before re-driving.

The steer channel (spec ch.1 §5) turns an opted-in run (`steerable: true` on the definition) multi-segment: segment 0 is the run input on the `runs` row, and each `steer()` appends one journal row `kind='segment'` — step key `steer:<seq>` (1-based; the `steer:` prefix never collides with step keys), `completed` at insert, value the JSON input, never re-executed. Inside the body, `ctx.steers()` reads the recorded segment inputs in record order (a plain read — consumption dedup across re-drives is the body's business), and `ctx.awaitSteer(known)` parks the driver at zero compute until a segment beyond `known` is recorded, returning immediately when enough segments already exist and rejecting `RUN_CANCELLED` / `ENGINE_DISPOSED` on cancellation or disposal. A parked run keeps the ledger status `running`, and steering a gate-`waiting` run records the segment without waking the gate. Boot-scan revival re-drives the body over the recorded segments.

The step ctx also exposes `runId` and the driver's `signal`. While a step's `fn` awaits, `currentStepScope()` returns the ambient scope `{ runId, stepKey }`; a child run started inside it derives its deterministic runId as `<runId>/<stepKey>/<kind>:<name>#<occurrence>` with the parent linkage recorded — a re-driven parent attaches to the child instead of re-opening it (the SDK's `ctx.agent` and the bare sub-workflow idiom both ride this).

## Extension points

- **`JournalStore` seam** (`./seams`) — the engine's one replaceable storage interface (including promise and segment rows); the SQLite implementation is `SqliteJournalStore`. This is also the fault-injection surface for the crash suite. Promise settlement routing lives in the core (in-process push plus a poll fallback); the `PromiseResolver` / `TimerScheduler` seams extract when a second implementation appears.
- **Definition registry** — built in (ADR 0006 §2): boot revival needs bodies without their callers.

## Model Experience

### Stored domain records

#### What the model sees

Nothing. The engine contributes no prompt, tool, or schema; `ctx.durable` orchestrates model calls made elsewhere.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the ledger is never part of a live request prefix.

## Known Limitations and Deferred Work

- **Skeleton primitive set** — `ctx.step`, `ctx.waitFor`, and the steer channel (`steers` / `awaitSteer`) are landed; `sleep` / `spawn` land on demand with their state machines (the `agent` face lives in the SDK).
- **No write-side schema validation cross-process** — the persisted `schema_json` is only a rendering projection; a process without the live schema writes unvalidated settlements, and the waiting side always validates on delivery, failing the step loud on a mismatch.
- **`steerable` is checked only where the definition is registered** — a `steer()` through an engine instance that never registered the run's definition records the segment unchecked; the SDK face validates the input at steer time and the agent body re-validates at consumption, failing the run loud on a mismatch; the opt-in throw exists only where the body is known.
- **Concurrent cross-process `steer()` can collide on the segment key** — the seq is read-then-insert (`count + 1`), so two processes steering one run can race to the same `steer:n` primary key; the loser fails with a constraint error and retries. Same-process steers serialize on the event loop.
- **No cross-process liveness** — a claim held by another *live* process is stealable at boot scan (dead-claim reassignment needs no heartbeats by design, ADR 0002 §2); two concurrently-driving processes on one ledger are outside v1's operating envelope.
- **Attach never drives** — a run found unfinished and not driven here is polled; revival happens in processes whose boot scan runs after the definition registers.
- **`RunOptions.meta` is not persisted** — the skeleton's `runs` table has no meta column; meta lives on the in-process handle only.
- **Runtime invariant companion is a placeholder** — the core deliberately keeps no Cordis event stream to hook; the run/journal/promise state machines are asserted by the fault-injection suite at every append point (spec ch.1 §9).
- **Not independently published** — the engine ships vendored inside the `@daypaw/sdk` tarball (ADR 0011); consumers import its faces through `@daypaw/sdk`.

### Dev Note
