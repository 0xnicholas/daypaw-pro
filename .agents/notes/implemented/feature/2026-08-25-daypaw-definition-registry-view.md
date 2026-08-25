# Agent Note: daypaw definition registry read view

Status: implemented

English | [中文](2026-08-25-daypaw-definition-registry-view.zh.md)

## Problem

Issue #51 (spec 05 §5, backend increment 2) gives the product shell's agent catalog its core query: enumerate every registered definition with its display metadata. The registry is a private `Map` inside `DurableEngineCore` — the host cannot reach it — and the #44 gap-6 ruling assigns the fix to the engine: expose a read-only view while the core keeps its Cordis-free shape. The ticket pairs with #52 (`defineAgent` display fields), which declares the metadata this view carries, so the engine side needed both the carrier field and the read face.

## Decision

- **`EngineDefinition.display?: DefinitionDisplay`** — the definition record gains an optional display-metadata carrier (`title` + `description`, the #40 minimum set). It is metadata only: the engine never reads it for execution, and engine-layer vocabulary is unchanged.
- **`DurableEngineCore.listDefinitions()`** — enumerates the registry in registration order as fresh `{ kind, name, version, display }` copies (the `display` object is copied too), so no caller can reach the private `Map` or a stored record through the result, and the body never leaves the core. Like the [query face](2026-08-25-daypaw-engine-query-face.md), the read carries no disposal assert: reads after dispose match the `handle.status()` precedent.
- **`ctx.durable.listDefinitions()`** — the async service wrapper, generated into the cordis catalog like every other method. `DefinitionView` and `DefinitionDisplay` live in `core.ts` beside the registry; the catalog generator's `TYPE_LINK_EXEMPTIONS` points both at the engine README.
- **No persistence** — the registry is rebuilt by registration on every process start, so display metadata rides the in-process record and needs no ledger column or migration.

## Alternatives considered

- **Persist display metadata on a ledger table** — rejected: the registry is transient by construction (bodies are closures that exist only in-process), so persistence buys nothing; the host re-reads the live registry after every boot.
- **Return the registered `EngineDefinition` objects directly** — rejected: that would expose the body thunk and let a caller mutate stored records; a dedicated `DefinitionView` keeps the read face honest at the type level.
- **Defer the `display` carrier to #52** — rejected: #51's acceptance is enumerating definitions *with* their display metadata, and without the carrier field #52 would have to reopen the engine package anyway.
- **SDK facade mirror** — out of the ticket's scope, same as the query face: the consumer is the Cordis host, and `@daypaw/sdk` can mirror the method when a library consumer appears.

## Consequences

The catalog ticket enumerates definitions with their business name and description through `ctx.durable` without touching core internals. Costs: two more types and one more method on `ctx.durable`, and registration order (the `Map`'s insertion order) becomes a documented contract.

## Testing

`packages/daypaw/engine/tests/queries.spec.ts` drives `listDefinitions` through the `ctx.durable` service: the empty registry, registration order with and without `display`, no-op re-registration, and snapshot isolation (mutating a returned entry or its `display` never reaches the registry). Engine src stays at per-file 100% coverage.

## Deferred

SDK facade mirrors of the query/read faces wait for a library consumer. The `defineAgent` side of the pair landed with #52: [defineAgent display fields](2026-08-25-daypaw-define-agent-display-fields.md).
