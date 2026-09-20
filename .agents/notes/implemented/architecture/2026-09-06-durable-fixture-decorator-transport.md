# Agent Note: durable/* fixture answers as a decorator transport

Status: implemented

English | [中文](2026-09-06-durable-fixture-decorator-transport.zh.md)

## Problem

The daypaw fork's `durable/*` Remote answers lived inside the upstream browser fixture (`packages/client/connection/src/client/fixture.ts`): six rpc arms, three mutable tables, and the rerun/start serials — roughly 370 lines of fork code in an upstream file, replayed by hand at every sync and mirroring every durable change ([frontend debt audit §2.1](../../../../docs/research/2026-09-02-frontend-arch-debt-audit.md), wayfinder [#81](https://github.com/0xnicholas/daypaw-pro/issues/81)). A fork-owned decorator also drives `durable/startRun`'s session twin, which the fixture arm drove through fixture internals (`sessionApi.prompt`, `emitRemote('api-session/added')`).

## Decision

The answers live in `apps/daypaw-web/tests/durable-rpc.ts`: `decorateDurableRpc(base)` intercepts the six `durable/*` endpoints over decorator-owned tables and passes every other call and stream through. The assembled boot mounts it through the connection plugin's `__DSH_TRANSPORT__` override: unary calls cross the real ClientRequest/ServerResponse envelope through a fetch bridge, streams delegate to the fixture's in-process opens, and mounting with the `?fixture` query switch fails loud. The session twin is driven through the fixture's public face — `session/create` registers it (sessionId ≡ runId, the model default, and the `api-session/added` remote event) and `session/prompt` drives the first turn — so the narrow `ClientConnectionRpc` face is sufficient and no fixture internals are reached. The one upstream addition is a public re-export of `createFixtureConnectionRpc` from the client entry: the hooks carrier needs the factory, and `./src/*` subpath imports cannot survive the emitting client face.

## Consequences

The upstream fixture keeps the registered fx-world seed adjustments (approval pairs, the turn-75 todo sample, the question on fx-gamma, `flipGammaRunning`, the approvalHistory fold), the residue of the fixture-answers debt item ([frontend debt audit §2.1](../../../../docs/research/2026-09-02-frontend-arch-debt-audit.md)); fork territory owns the durable mirror obligation, and the assembled lanes exercise the same request envelope the served web app's HTTP carrier uses. Fixture scenario switches still apply, read from the mounted search when the bridge mints the world. The five golden lanes' output stays byte-identical.

## Alternatives considered

Keeping the arms registered grows the block with every durable feature and leaves the mirror obligation without a sync answer. A fork connection plugin overriding `ctx.connection` was rejected: it duplicates the whole plugin apply body, a wider replay surface than the arms. Importing the fixture module through its `./src/*` subpath was rejected: non-relative `.ts` imports cannot be rewritten under `rewriteRelativeImportExtensions` in the emitting client face (TS2877). Importing the fixture from built artifacts was rejected: the built client entry did not export the factory, and a source re-export is the one-line form of the same fix.

## Testing

`apps/daypaw-web/tests/durable-rpc.spec.ts` drives the decorator directly: ledger queries, lineage, journal, the rerun append, startRun's registry resolution with the `durable/*` failure vocabulary, and the twin's first user message over the public session face. The five assembled golden lanes boot the decorated transport and compare byte-identical against their committed goldens.
