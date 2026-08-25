# Durable Engine (daypaw)

English | [中文](daypaw-engine.zh.md)

The fork-owned durable execution service (`ctx.durable`, package [`@daypaw/engine`](../../packages/daypaw/engine)): run lifecycle, step-dedup re-drive, single-writer claims, and boot-scan revival over the [`@daypaw/store`](../../packages/daypaw/store) SQLite ledger. Semantics live in [spec ch.1](../spec/01-durable-execution.md); the walking-skeleton decisions are recorded in the [walking-skeleton Agent Note](../../.agents/notes/implemented/architecture/2026-08-19-daypaw-walking-skeleton.md); the package [README](../../packages/daypaw/engine/README.md) owns the callable API and configuration.

Sources: [`packages/daypaw/engine/src/index.ts`](../../packages/daypaw/engine/src/index.ts), [`packages/daypaw/engine/src/core.ts`](../../packages/daypaw/engine/src/core.ts), and [`packages/daypaw/engine/src/types.ts`](../../packages/daypaw/engine/src/types.ts).

## Service surface

`ctx.durable` registers opaque definition records and starts or attaches to runs; `@daypaw/sdk` is the typed facade applications call.

```ts type-equiv
/** Opaque definition record the engine can execute and revive (ADR 0006 §2). */
interface EngineDefinition {
  /** Definition family; the engine stays blind to what a kind's body does (ADR 0010: agent bodies are SDK-compiled closures). */
  readonly kind: RunDefKind
  /** Definition name; with version, the registry identity. */
  readonly name: string
  /** Definition version; with name, the registry identity. */
  readonly version: string
  /**
   * Display metadata for host catalog views (spec 05 §5): a business-facing
   * name and description. Metadata only — never execution semantics.
   */
  readonly display?: DefinitionDisplay
  /**
   * Steer channel opt-in (issue #53): `steer()` accepts follow-up input for
   * runs of this definition, whose body is expected to consume recorded
   * segments through `EngineStepCtx.steers`/`awaitSteer`. Undefined or false
   * means steering a run of this definition fails loud.
   */
  readonly steerable?: boolean
  /** Opaque body thunk; the engine calls it with a step ctx and the run input. */
  readonly body: (ctx: EngineStepCtx, input: unknown) => Promise<unknown>
}
```

```ts type-equiv
/** Display metadata a definition declares for host catalog views (spec 05 §5). */
interface DefinitionDisplay {
  /** Business-facing name. */
  readonly title: string
  /** Business-facing description. */
  readonly description: string
}
```

```ts type-equiv
/**
 * Read-only registry entry returned by `listDefinitions`: identity and
 * display metadata, never the body.
 */
interface DefinitionView {
  /** Definition family. */
  readonly kind: RunDefKind
  /** Definition name; with version, the registry identity. */
  readonly name: string
  /** Definition version; with name, the registry identity. */
  readonly version: string
  /** Declared display metadata; the key is absent when the definition declares none (wire-safe: no undefined values). */
  readonly display?: DefinitionDisplay
}
```

Attach never claims: a run driven elsewhere is polled at `pollMs`, and reviving is the boot scan's job — registration-triggered, since a fresh service's registry is necessarily empty at construction.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdurable--durableengine"></a>

### `ctx.durable` — `DurableEngine`

The `ctx.durable` service. Opens the ledger on construction (methods await readiness), runs the boot scan once the database is open, and on context disposal stops driving without writing terminal run states — unfinished runs stay revivable by the next process. `listDefinitions` doubles as the browser catalog's wire face: the TypertRemoteService binding lets the API gateway claim `durable/listDefinitions` (spec 05 §5; the GoalService precedent) without any upstream apiproxy edit.

```ts cordis-catalog
/**
 * Register a definition for execution and boot-time revival.
 * @param def - opaque definition record (see `@daypaw/sdk`).
 */
async register(def: EngineDefinition): Promise<void>

/**
 * Start a run, or attach to an existing one (idempotent start-or-attach).
 * @param def - registered definition to run.
 * @param input - JSON-serializable run input.
 * @param opts - run identity and caller cancellation.
 * @returns the run handle.
 */
async run(def: EngineDefinition, input: unknown, opts?: EngineRunOptions): Promise<EngineRunHandle>

/**
 * Resolve when this process drives no run (boot scan included).
 */
async idle(): Promise<void>

/**
 * List run rows from the ledger, newest first (spec 05 §5).
 * @param filter - optional status restriction.
 * @returns matching run rows.
 */
async listRuns(filter?: RunListFilter): Promise<RunRow[]>

/**
 * Read one run's parent/child lineage in one call: its own row, its
 * parent, and its direct children.
 * @param runId - run identity.
 * @returns the lineage; every field is empty when the runId is unknown.
 */
async runLineage(runId: string): Promise<RunLineage>

/**
 * Enumerate one run's journal steps in start order (spec 05 §5).
 * @param runId - run identity.
 * @returns the run's journal steps in start order.
 */
async journalTimeline(runId: string): Promise<JournalRow[]>

/**
 * Enumerate the registered definitions in registration order (spec 05 §5):
 * identity and display metadata, never the body — the definition registry's
 * one read face, so hosts never reach into the core's private Map. Served
 * to the browser as the Remote endpoint `durable/listDefinitions`.
 * @returns the registry entries in registration order.
 */
@Remote('listDefinitions') async listDefinitions(): Promise<DefinitionView[]>

/**
 * Settle a gate (first-wins): the one resolve seam for SDK direct calls,
 * Manager UI, and (deferred) webhooks. See {@link DurableEngineCore.resolveGate}.
 * @param runId - run identity.
 * @param gate - gate name.
 * @param settlement - resolved value or rejection reason.
 * @param source - who settled, recorded on the row.
 * @returns whether this call won the settlement.
 */
async resolveGate(runId: string, gate: string, settlement: GateSettlement, source: GateResolutionSource): Promise<boolean>

/**
 * Append a steer segment to an unfinished steerable run (issue #53):
 * durable before delivery — a body parked in this process wakes
 * immediately, elsewhere the parked poll or the next boot scan observes the
 * segment row. Served to the browser as the Remote endpoint
 * `durable/steer` (the `listDefinitions` precedent). See
 * {@link DurableEngineCore.steer}.
 * @param runId - run identity.
 * @param input - JSON-serializable follow-up input; validated by the SDK face.
 * @returns the assigned segment sequence (1-based).
 */
@Remote('steer') async steer(runId: string, input: Json): Promise<number>
```

Source: [`packages/daypaw/engine/src/index.ts:69`](../../packages/daypaw/engine/src/index.ts)
<!-- END GENERATED cordis-surface -->
