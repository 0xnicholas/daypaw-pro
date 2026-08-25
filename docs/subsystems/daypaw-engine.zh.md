# Durable Engine（daypaw）

[English](daypaw-engine.md) | 中文

fork 自有的 durable 执行服务（`ctx.durable`，包 [`@daypaw/engine`](../../packages/daypaw/engine)）：run 生命周期、step 去重续跑、单写者认领与 boot 扫描复活，落在 [`@daypaw/store`](../../packages/daypaw/store) SQLite ledger 之上。语义见[spec 第 1 章](../spec/01-durable-execution.md)；走骨决策记录在[走骨 Agent Note](../../.agents/notes/implemented/architecture/2026-08-19-daypaw-walking-skeleton.md)；可调用 API 与配置归包 [README](../../packages/daypaw/engine/README.md)。

来源：[`packages/daypaw/engine/src/index.ts`](../../packages/daypaw/engine/src/index.ts) 与 [`packages/daypaw/engine/src/core.ts`](../../packages/daypaw/engine/src/core.ts)。

## Service 面

`ctx.durable` 登记不透明定义记录、启动或 attach run；`@daypaw/sdk` 是应用调用的类型化 facade。

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
 * Read-only registry entry returned by {@link DurableEngineCore.listDefinitions}:
 * identity and display metadata, never the body.
 */
interface DefinitionView {
  /** Definition family. */
  readonly kind: RunDefKind
  /** Definition name; with version, the registry identity. */
  readonly name: string
  /** Definition version; with name, the registry identity. */
  readonly version: string
  /** Declared display metadata; undefined when the definition declares none. */
  readonly display: DefinitionDisplay | undefined
}
```

Attach 永不夺权：他处驱动的 run 按 `pollMs` 轮询，复活归 boot 扫描——由登记触发，因为新服务的注册表在构造期必空。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdurable--durableengine"></a>

### `ctx.durable` — `DurableEngine`

The `ctx.durable` service. Opens the ledger on construction (methods await readiness), runs the boot scan once the database is open, and on context disposal stops driving without writing terminal run states — unfinished runs stay revivable by the next process.

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
 * one read face, so hosts never reach into the core's private Map.
 * @returns the registry entries in registration order.
 */
async listDefinitions(): Promise<DefinitionView[]>

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
```

Source: [`packages/daypaw/engine/src/index.ts:63`](../../packages/daypaw/engine/src/index.ts)
<!-- END GENERATED cordis-surface -->
