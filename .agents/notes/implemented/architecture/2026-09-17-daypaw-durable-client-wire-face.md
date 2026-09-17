# Agent Note: The durable client face (`@daypaw/durable-client`)

Status: implemented

English | [中文](2026-09-17-daypaw-durable-client-wire-face.zh.md)

## Problem

The browser plane re-implemented the engine's Remote face once per consumer. `callEndpoint` — the `/api` channel, the `{ args }` envelope, the ok/error unwrap — stood byte-identical in `@daypaw/ui-inbox` and `@daypaw/ui-tasks`, differing only in the error prefix. `durable/listDefinitions` carried three independent parsers with two different tolerance policies (the catalog and the dialog failed loud, the first-run banner tolerated a malformed row). The five-value run-status vocabulary lived in eight places, including two `RUN_STATUS_KEY` tables in different packages that each claimed to be the one home, with no test comparing them. Hand-written literals in `runs-api.client.spec.ts` were the read endpoints' only coverage, so a column rename (`updated_at`, `def_kind`) kept unit tests green and broke the browser.

## Decision

`@daypaw/durable-client` is the browser plane's single home for the engine Remote face ([ticket #116](https://github.com/0xnicholas/daypaw-pro/issues/116)): the seven endpoints the shell consumes today (`listRuns`, `runLineage`, `journalTimeline`, `rerun`, `listDefinitions`, `startRun`, `steerText`) behind one `DurableClient` interface from `createDurableClient(rpc)`, hand-declared wire row types with one fail-loud parser per row kind, and the run-status vocabulary with its zh/en copy in the package's own `'durable'` locale namespace. The structured `steer` and `cancel` endpoints have no browser consumer and join when one appears.

Wire types are declared in the package, never aliased from `@daypaw/engine`. An alias cannot disagree with its source, so it proves nothing at the boundary; an independent declaration is what the parser validates, and drift is caught by execution. That execution is the extended live-gateway spec in `@daypaw/web-app`, which drives all seven endpoints through `createDurableClient` against the real Typert gateway and a real engine — the assembled golden lane answers from the fixture transport, which performs no descriptor validation. The browser plane keeps zero `@daypaw/engine` dependency edges.

Parsing is fail-loud everywhere. A consumer that needs tolerance degrades on its own side of the call: the first-run banner wraps the roster leg in a `try`/`catch` and falls back to `FALLBACK_AGENT_NAME`, so a malformed roster cannot hide the key-readiness banner while the parser stays strict. Package fakes implement the single `DurableClient` interface over hand-written literals; a shared fake module is worth extracting only when three packages repeat the same one.

## Alternatives considered

**Alias the engine's types.** `@daypaw/engine` exports `RunRow`, `JournalRow`, and `DefinitionView`; aliasing them in a browser package would remove the declarations. It also removes the only check that can fail: the browser reads a JSON projection with fewer fields than the engine returns, and a rename that a shared type would silently follow is exactly the failure the parser exists to catch.

**Keep the package inside `ui-inbox` or `web-app`.** `ui-inbox` owns the IA projections (`TaskRow`, `TaskDetailView`), so the wire vocabulary would sit under a surface that does not own it. `web-app` is the shell scaffold the UI plugins mount over, so the dependency direction would invert.

**Hand-written row literals in each consumer's spec.** They cannot fail when the engine's serialization moves — the defect this work removes. The wire contract's proof has to run against the engine.

**A `/testing` subpath exporting a shared fake.** Three packages currently repeat the same fake shape; extracting it now would publish a testing surface for consumers that already have narrower needs (the second consumer reads one endpoint). Revisit when the repetition is the third one.

## Consequences

- The four `ui-*` packages hold no `durable/*` endpoint strings and no wire row types; wire knowledge has one home. `runs-api.ts`, `task-status.ts`, `new-task-api.ts`, `run-status.ts`, and `definitions-api.ts` are gone, and `status.*` left both dictionaries.
- The unified copy changes two English strings on the task surfaces: `Done` becomes `Completed` and `Something went wrong` becomes `Failed` (the Chinese copy was already identical). The assembled golden records it.
- The empty `import type {} from '@daypaw/ui-inbox/client'` pulls from the #60 era were reviewed one by one: the three in `@daypaw/ui-tasks` were residue and are gone, while the pairs in `@daypaw/ui-agents` and `@daypaw/ui-settings` carry the ui-inbox `SlotMap` merge that types their slot names — deleting them fails typecheck — so one documented carrier per package remains, and module augmentations being program-global is stated where it is relied on.
- Two wire facts gained precision from writing the parser's contract down: a journal row's `occurrence` is 0-based (it was documented 1-based), and the default step key is `name#occurrence`.
- A new client package needs its built `lib/` before a profile boot resolves its roster row, and its row must be declared in the bundle's `dependencies` — the healed profile links row names from the bundle manifest, not from `devDependencies`.
