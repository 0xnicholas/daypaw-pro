# @daypaw/engine

English | [中文](README.zh.md)

The durable execution engine (`ctx.durable`): run lifecycle, step-dedup re-drive, durable gates (`ctx.waitFor`), single-writer claims, and boot-scan revival over the [`@daypaw/store`](../store/README.md) ledger. Load it as a Cordis plugin; applications call it through the typed [`@daypaw/sdk`](../sdk/README.md) facade. Semantics: [spec ch.1](../../../docs/spec/01-durable-execution.md); walking-skeleton scope: [ADR 0008](../../../docs/adr/0008-landing-order-walking-skeleton.md).

## Service API

`ctx.durable` (plugin `@daypaw/engine`):

- `register(def)` — record an opaque definition (kind/name/version + body thunk) for execution and boot-time revival. Same identity with a different body rejects; registering runs a boot scan that may revive unfinished runs left by a previous process.
- `run(def, input, { runId?, signal?, parent? })` — idempotent start-or-attach: unknown runId inserts and drives; a terminal run settles from its row; a run this process drives returns its live handle; anything else is polled (`pollMs`) — attaching never claims, reviving is the boot scan's job. `parent` (`{ runId, stepKey }`) records the caller's lineage on insert (`parent_run_id` / `parent_step_key`); an existing runId attaches without rewriting lineage.
- `idle()` — resolves when this process drives no run.
- `listRuns(filter?)` — run rows from the ledger, newest first, optionally restricted to one `status`.
- `runLineage(runId)` — one call for a run's own row, its parent, and its direct children (oldest first); every field is empty for an unknown runId.
- `journalTimeline(runId)` — the run's journal steps in start order.
- `listDefinitions()` — the definition registry's one read face (spec 05 §5): every registered definition in registration order as `{ kind, name, version, display }`, never the body. `display` is optional metadata a definition declares for host catalog views (`title` + `description`); it is `undefined` when undeclared and carries no execution semantics. Each call returns fresh copies, so the registry cannot be mutated through the result; `register` stays the only write surface.
- `resolveGate(runId, gate, settlement, source)` — the one settle seam for gates (first-wins): SDK direct calls, Manager UI, and (deferred) webhooks share it. When this process holds the waiter, the value contract validates before the write — an invalid settlement throws and records nothing; a second settler is a no-op returning `false`. A driver waiting in this process resumes immediately; cross-process writes are observed through the driver's `pollMs` poll fallback, and a dead process's waits revive through the boot scan.

The query methods (`listRuns` / `runLineage` / `journalTimeline`) are the ledger's one query home (spec 05 §5): hosts read runs, lineage, and step timelines through `ctx.durable`, never through host-side SQL, so query knowledge evolves with the schema. Presentation vocabulary stays above this seam — the rows keep engine names.

Configuration (schemastery): `path` (ledger file or `:memory:`), `pollMs` (attach poll interval, default 1s).

## Execution model

A run drives its body with a step ctx. `ctx.step(name, fn, { key? })` derives the idempotency key `name#occurrence` (or takes an explicit key); a completed step returns its recorded result without re-executing, an unfinished one (re)executes and records — at-least-once execution, exactly-once step commits. Cancellation writes the terminal row first and takes effect at the next step boundary. Disposal stops driving without terminal writes: unfinished runs stay revivable.

`ctx.waitFor(gate, { schema?, timeout? })` is the HITL suspension primitive (spec ch.1 §6): it registers a pending promise row keyed by `(runId, gate)`, moves the run to `waiting`, and yields the driver — waiting costs nothing, and a dead process revives through the boot scan, where the re-driven body reads the recorded outcome at the same `waitFor` without waiting again. The terminal outcome returns as a `GateResolution` union value (`resolved` / `rejected` / `timedout` / `cancelled`): timeout, rejection, and cancellation are programmable branches, never thrown. `timeout` is a millisecond duration; a live process writes `timedout` first-wins from `setTimeout`, and a deadline missed while dead is swept by the boot scan before re-driving.

The step ctx also exposes `runId` and the driver's `signal`. While a step's `fn` awaits, `currentStepScope()` returns the ambient scope `{ runId, stepKey }`; a child run started inside it derives its deterministic runId as `<runId>/<stepKey>/<kind>:<name>#<occurrence>` with the parent linkage recorded — a re-driven parent attaches to the child instead of re-opening it (the SDK's `ctx.agent` and the bare sub-workflow idiom both ride this).

## Extension points

- **`JournalStore` seam** (`./seams`) — the engine's one replaceable storage interface (including promise rows); the SQLite implementation is `SqliteJournalStore`. This is also the fault-injection surface for the crash suite. Promise settlement routing lives in the core (in-process push plus a poll fallback); the `PromiseResolver` / `TimerScheduler` seams extract when a second implementation appears.
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

- **Skeleton primitive set** — `ctx.step` and `ctx.waitFor` are landed; `sleep` / `spawn` land on demand with their state machines (the `agent` face lives in the SDK).
- **No write-side schema validation cross-process** — the persisted `schema_json` is only a rendering projection; a process without the live schema writes unvalidated settlements, and the waiting side always validates on delivery, failing the step loud on a mismatch.
- **No cross-process liveness** — a claim held by another *live* process is stealable at boot scan (dead-claim reassignment needs no heartbeats by design, ADR 0002 §2); two concurrently-driving processes on one ledger are outside v1's operating envelope.
- **Attach never drives** — a run found unfinished and not driven here is polled; revival happens in processes whose boot scan runs after the definition registers.
- **`RunOptions.meta` is not persisted** — the skeleton's `runs` table has no meta column; meta lives on the in-process handle only.
- **Runtime invariant companion is a placeholder** — the core deliberately keeps no Cordis event stream to hook; the run/journal/promise state machines are asserted by the fault-injection suite at every append point (spec ch.1 §9).
- **Not independently published** — the engine ships vendored inside the `@daypaw/sdk` tarball (ADR 0011); consumers import its faces through `@daypaw/sdk`.
