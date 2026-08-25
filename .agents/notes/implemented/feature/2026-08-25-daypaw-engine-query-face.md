# Agent Note: daypaw engine query face (JournalStore read side)

Status: implemented

English | [中文](2026-08-25-daypaw-engine-query-face.zh.md)

## Problem

Issue #50 (spec 05 §5, backend increment 1) gives the product shell's task-progress board its data source: list runs with a status filter, read one run's parent/child lineage, and enumerate one run's journal step timeline. The ruling the ticket inherits is that query knowledge lives in the engine seam — one fact source that evolves with `SCHEMA_VERSION` — and host-side SQL scatter is rejected. The `JournalStore` seam carried only the write side plus point lookups, so the read face had to be designed: which methods, at which layer, with what ordering contract, and without letting presentation vocabulary ("task") leak below the seam (issue #40).

## Decision

The seam grows exactly three read methods, exposed unchanged through every layer:

- **`JournalStore` read side** — `selectRuns(filter?)` (newest first, optional single-status restriction), `selectChildRuns(parentRunId)` (oldest first), `selectJournalSteps(runId)` (start order). `SqliteJournalStore` prepares each statement once at construction; `rowid` tiebreaks equal-millisecond timestamps into true insertion order, so "newest first" stays stable for fast runs. No migration: the existing `idx_runs_status` serves the filter and every other lookup is a primary-key or single-column scan at self-host scale.
- **Core delegates, one composition** — `DurableEngineCore.listRuns` and `journalTimeline` forward to the store; `runLineage(runId)` is the one composite, answering "this run's parent and children" in a single call as `{ run, parent, children }` from `selectRun` plus `selectChildRuns`, with every field empty for an unknown runId. Query methods carry no disposal assert: reads after dispose match the `handle.status()` precedent, and database availability stays the owner's call.
- **`ctx.durable` wraps them async** — `listRuns` / `runLineage` / `journalTimeline` on the service, generated into the cordis catalog like every other method. Presentation vocabulary stays above the seam: rows keep engine names (`run`, `journal`), and the "task" wording is the UI projection's job.
- **Types at their owning layers** — `RunListFilter` in `seams.ts` beside the seam, `RunLineage` in `core.ts` beside the composition; rows remain `@daypaw/store` contract types. The catalog generator's `TYPE_LINK_EXEMPTIONS` points each at its README owner.

## Alternatives considered

- **Separate `getRun` plus `childRuns` service methods instead of the `runLineage` composite** — rejected: the acceptance query is "a run's parent/child lineage" as one question, and the composite answers it without exposing a raw row-lookup method the host would have to chain.
- **`assertNotDisposed` on query methods** — rejected: reads have no state machine to protect, and `EngineRunHandle.status()` already reads the ledger after disposal; an artificial guard would only break that symmetry.
- **A migration adding `idx_runs_parent`** — rejected: at self-host scale the children query is a bounded scan; the index lands when a measured need appears, as its own migration segment.
- **Exposing the face through `@daypaw/sdk`** — out of the ticket's scope: the consumer is the Cordis host, and the SDK facade can mirror the methods when a library consumer appears.

## Consequences

The board tickets (inbox grouping, right-panel detail) read everything they need through `ctx.durable` without touching SQL, and the ordering contracts (newest-first runs, oldest-first children, start-order steps) are pinned by tests rather than convention. Costs: the service surface grows by three methods whose rows expose raw engine column names to the host (accepted — the host is internal), and the children query is an unindexed scan until volume proves otherwise. `@daypaw/store` is untouched: the contract rows already carried every column the queries need.

## Testing

`packages/daypaw/engine/tests/queries.spec.ts` drives all three queries through the `ctx.durable` service (service → core → SQLite in one path): the five-status list with filter cases, lineage for parent/child/unknown runs, and a completed-plus-failed step timeline. Engine and store src stay at per-file 100% coverage.

## Deferred

A `parent_run_id` index and any pagination/limit on `listRuns` wait for measured volume; SDK facade mirrors wait for a library consumer.
