# @daypaw/engine

English | [中文](README.zh.md)

The durable execution engine (`ctx.durable`): run lifecycle, step-dedup re-drive, single-writer claims, and boot-scan revival over the [`@daypaw/store`](../store/README.md) ledger. Load it as a Cordis plugin; applications call it through the typed [`@daypaw/sdk`](../sdk/README.md) facade. Semantics: [spec ch.1](../../../docs/spec/01-durable-execution.md); walking-skeleton scope: [ADR 0008](../../../docs/adr/0008-landing-order-walking-skeleton.md).

## Service API

`ctx.durable` (plugin `@daypaw/engine`):

- `register(def)` — record an opaque definition (kind/name/version + body thunk) for execution and boot-time revival. Same identity with a different body rejects; registering runs a boot scan that may revive unfinished runs left by a previous process.
- `run(def, input, { runId?, signal?, parent? })` — idempotent start-or-attach: unknown runId inserts and drives; a terminal run settles from its row; a run this process drives returns its live handle; anything else is polled (`pollMs`) — attaching never claims, reviving is the boot scan's job. `parent` (`{ runId, stepKey }`) records the caller's lineage on insert (`parent_run_id` / `parent_step_key`); an existing runId attaches without rewriting lineage.
- `idle()` — resolves when this process drives no run.

Configuration (schemastery): `path` (ledger file or `:memory:`), `pollMs` (attach poll interval, default 1s).

## Execution model

A run drives its body with a step ctx. `ctx.step(name, fn, { key? })` derives the idempotency key `name#occurrence` (or takes an explicit key); a completed step returns its recorded result without re-executing, an unfinished one (re)executes and records — at-least-once execution, exactly-once step commits. Cancellation writes the terminal row first and takes effect at the next step boundary. Disposal stops driving without terminal writes: unfinished runs stay revivable.

The step ctx also exposes `runId` and the driver's `signal`. While a step's `fn` awaits, `currentStepScope()` returns the ambient scope `{ runId, stepKey }`; a child run started inside it derives its deterministic runId as `<runId>/<stepKey>/<kind>:<name>#<occurrence>` with the parent linkage recorded — a re-driven parent attaches to the child instead of re-opening it (the SDK's `ctx.agent` and the bare sub-workflow idiom both ride this).

## Extension points

- **`JournalStore` seam** (`./seams`) — the one replaceable interface landed by the skeleton; the SQLite implementation is `SqliteJournalStore`. This is also the fault-injection surface for the crash suite. Promise/timer seams land with their primitives.
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

- **Skeleton primitive set** — only `ctx.step` exists; `sleep` / `waitFor` / `agent` / `spawn` land on demand with their state machines, at which point `status()` stops rejecting on `waiting` rows.
- **No cross-process liveness** — a claim held by another *live* process is stealable at boot scan (dead-claim reassignment needs no heartbeats by design, ADR 0002 §2); two concurrently-driving processes on one ledger are outside v1's operating envelope.
- **Attach never drives** — a run found unfinished and not driven here is polled; revival happens in processes whose boot scan runs after the definition registers.
- **`RunOptions.meta` is not persisted** — the skeleton's `runs` table has no meta column; meta lives on the in-process handle only.
- **Runtime invariant companion is a placeholder** — relational checks land with the promise/timer states they guard; until then the fault-injection suite asserts the state machines (spec ch.1 §9).
- **Not independently published** — the engine ships vendored inside the `@daypaw/sdk` tarball (ADR 0011); consumers import its faces through `@daypaw/sdk`.
