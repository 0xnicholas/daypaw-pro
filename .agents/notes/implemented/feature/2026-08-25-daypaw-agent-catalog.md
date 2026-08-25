# Agent Note: daypaw agent catalog page

Status: implemented

English | [中文](2026-08-25-daypaw-agent-catalog.zh.md)

## Problem

Issue #60 (spec 05 §3/§5, shell increment ④b) wants the shell's Agents view to be a real catalog: a grid enumerating engine-registered agent definitions with title and description, and a detail page identified by `name@version`. The shell side already has the inbox workspace and its slot map (#58); the engine side already has the read view (#51 `listDefinitions`) but nothing exposes it across the wire — `ctx.durable` is a host-side service, and the web client only reaches the gateway's Typert Remote channel.

## Decision

- **Expose `listDefinitions` over the Typert Remote channel** — `DurableService` gains a `@Remote('listDefinitions')` declaration and the gateway claims the `durable/listDefinitions` endpoint at runtime, following the GoalService precedent. The root `tsdown.config.ts` typertPlugin generates the host/remote-client descriptors in `build:lib:host`; no upstream apiproxy change. The fixture (`packages/client/connection`) answers the same endpoint with two canned definitions so every client lane runs keyless.
- **Catalog reads definitions, not presets** — a definition carries `name@version` (the ticket's detail identity) and optional display metadata; a preset has neither version nor a stable roster identity. The new task dialog (#56) therefore keeps its preset roster, and the catalog page consumes the engine registry. The dual roster is a documented Known Limitation: the dialog offers presets, the catalog shows definitions, and they reconcile only when presets and definitions are registered in pairs.
- **New package `@daypaw/ui-agents` occupies a new ui-inbox slot `inbox.agents.page`** — `scope: 'session-maybe'` (catalog browsing needs no session; starting a run goes through the existing sessions.create path). The upstream ui-agent-preset row stays untouched: it occupies a different slot for a different surface. The package projects `DefinitionView` into a card model (`title = display?.title ?? name`, agent-kind filter, `name@version` key), validates payloads at the wire boundary, and renders grid + detail views behind the inbox WorkspaceSwitch fallback.
- **Snapshot lane pins the transcript** — `apps/daypaw-web/tests/agents-catalog.snapshot.ts` records grid and detail goldens against the fixture roster, keyless.

## Alternatives considered

- **Catalog reads `agentPresets`** — rejected: presets have no version, so the detail page could not honor the ticket's `name@version` identity, and preset metadata is deployment config, not engine truth.
- **HTTP/REST endpoint beside the gateway** — rejected: the client already speaks Typert Remote; a second channel duplicates auth, typing, and codegen infrastructure for one method.
- **Fold the page into ui-inbox** — rejected: the inbox package owns the workspace chrome; the catalog is its own surface with its own locales, store, and tests, and the slot map exists exactly for this.
- **Extend ui-agent-preset instead of a new package** — rejected: that package is preset-roster scoped; pointing it at the engine registry would blur both surfaces and its existing snapshot.

## Consequences

The shell's Agents view renders the live engine roster, and the wire contract for `durable/listDefinitions` is generated and pinned by snapshot. Costs: a new package plus its root wiring (tsconfig references, knip entry, cordis.patch roster, assembled-boot PLUGINS), one upstream fixture touch (registered in `docs/fork/CORE_TOUCHES.md`), and the engine service now carries a Typert Remote declaration, making the protocol package a peer of `@daypaw/engine`.

## Testing

`packages/daypaw/ui-agents/tests/` covers the wire-boundary parser (all rejection branches), the catalog store projection (filter, title fallback, generation race, orphan selection, unknown-key open), the page render, and locale key parity; package src stays at per-file 100% coverage. `packages/daypaw/engine/tests/queries.spec.ts` asserts the `display` key's absence when undeclared. `apps/daypaw-web/tests/agents-catalog.snapshot.ts` records grid and detail goldens through the assembled web app.

## Deferred

Reconciling the dialog's preset roster with the catalog's definition roster (e.g. presets referencing `name@version`) is future product work. The detail page does not yet offer a start-run action; runs start from the new task dialog.
