---
description: "The daypaw browser plane's single wire-vocabulary home for the durable engine's Remote face: eight durable/* endpoint calls, hand-declared wire row types with fail-loud parsing, the five-value run-status vocabulary, and its zh/en copy"
kind: "package-reference"
---

# @daypaw/durable-client

English | [中文](README.zh.md)

## Summary

## Table of Contents



The daypaw browser plane's single wire-vocabulary home for the durable engine's Remote face ([spec 05](../../../docs/spec/05-product-shell.md) §5, [ticket #116](https://github.com/0xnicholas/daypaw-pro/issues/116)): the eight `durable/*` Remote endpoints the shell consumes today behind one client interface, plus the run-status vocabulary every surface shares. The four ui-* packages read the engine through this package and never import `@daypaw/engine` — endpoint strings, the `{ args }` envelope, snake_case row decoding, and ok/error unwrapping live here exactly once.

- **The client face** ([`api.ts`](./src/client/api.ts)): `createDurableClient(rpc)` answers a `DurableClient` with `listRuns` / `runLineage` / `journalTimeline` / `rerun` / `listDefinitions` / `startRun` / `steerText` / `resolveGate`. The structured `steer` and `cancel` endpoints have no browser consumer yet and join when one appears. `resolveGate` (ticket #128) settles a pending gate: `{ state: 'resolved', value }` approves with the value the gate's contract validates, `{ state: 'rejected', reason }` refuses; the answer is first-wins, so a `false` answer means the gate was already settled (another answer, a timeout, or a cancellation). `WireRun.waitingGate` carries the gate name a parked run is suspended on, which is what the board's 等待你确认 triage and the detail column's answer card read.
- **Hand-declared wire types** ([`wire.ts`](./src/client/wire.ts)): the row shapes are declared here, not aliased from the engine — an independent declaration is exactly the object the wire-boundary check validates, and serialization drift is proven out by the live-gateway execution test in [`@daypaw/web-app`](../web-app/README.md)'s wire-contract spec. Every field the browser reads validates fail-loud (wrong build, hand-rolled impostor endpoint); a tolerant consumer degrades on its own side of the call, never by weakening the parser.
- **The status vocabulary** ([`status.ts`](./src/client/status.ts), [`locales.ts`](./src/client/locales.ts)): the five-value run-status union, `isUnfinishedWireRun`, and the zh/en status copy in the self-held `'durable'` namespace — the status text never diverges between surfaces. Surfaces render it through a bound `ctx.locale.bind('durable')` translate plus `runStatusKey`.
- **The plugin half** ([`index.ts`](./src/client/index.ts)): one effect — registering the `'durable'` dictionaries. The node half provides nothing; the library is consumed directly through the connection's generic RPC channel.

## Model Experience

### Durable wire vocabulary

#### What the model sees

Nothing. The package carries the browser's `durable/*` RPC payloads and the `'durable'` locale dictionaries; no prompt, tool, or schema surface exists, and no wire row reaches a model request.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **`steer` and `cancel` are not collected.** No browser consumer exists for the structured steer or the cancel endpoint; they join this face when a real consumer appears (YAGNI, ticket #116 ruling 2).
- **Lineage members validate only on presence.** `runLineage` treats `null` run/parent members as absent, matching the engine's wire-safe shape; an unknown runId is the caller's condition to present, not a parse failure.
- **No `/testing` subpath.** Consumer fakes implement `DurableClient` directly; a shared fake module is worth extracting only once three packages repeat the same one (ticket #116 ruling 6).

### Dev Note

**Runtime invariant:** No companion is published. The package's only observable relationship — endpoint strings, envelope, and row decoding matching the engine's Remote face — is asserted by the live-gateway wire-contract spec in `@daypaw/web-app`; independent observations cannot diverge from what that execution already proves, so no `./invariant` companion is warranted.
