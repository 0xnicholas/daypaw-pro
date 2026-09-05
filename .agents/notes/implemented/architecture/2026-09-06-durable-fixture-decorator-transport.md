# Agent Note: durable/* fixture answers as a decorator transport

Status: implemented

English | [中文](2026-09-06-durable-fixture-decorator-transport.zh.md)

## Problem

The daypaw fork's `durable/*` Remote answers lived inside the upstream browser fixture (`packages/client/connection/src/client/fixture.ts`): six rpc arms, three mutable tables, and the rerun/start serials — roughly 370 lines of fork code in an upstream file, replayed by hand at every sync and mirroring every durable contract change (frontend debt audit §2.1, wayfinder #81 ruling 1). The open spike question was whether a fork-owned decorator could also drive `durable/startRun`'s session twin, which the fixture arm drove through fixture internals (`sessionApi.prompt`, `emitRemote('api-session/added')`).

## Decision

The answers now live in `apps/daypaw-web/tests/durable-rpc.ts`: `decorateDurableRpc(base)` intercepts the six `durable/*` endpoints over decorator-owned tables and passes every other call and stream through. The assembled boot mounts it through the connection plugin's existing carrier-override seam (`__DSH_TRANSPORT__`): unary calls cross the real ClientRequest/ServerResponse envelope through a fetch bridge, streams delegate to the fixture's in-process opens, and mounting with the `?fixture` query switch fails loud. The session twin is driven through the fixture's public face — `session/create` registers it (sessionId ≡ runId, the model default, and the `api-session/added` remote event) and `session/prompt` drives the first turn — so the narrow `ClientConnectionRpc` face is sufficient and no fixture internals are reached (the spike's first question, answered). The one upstream addition is a public re-export of `createFixtureConnectionRpc` from the client entry: the hooks carrier needs the factory, and `./src/*` subpath imports cannot survive the emitting client face.

## Consequences

The upstream fixture keeps only the registered fx-world seed adjustments (approval pairs, the turn-75 todo sample, the question on fx-gamma, `flipGammaRunning`, the approvalHistory fold); the durable mirror obligation lives entirely in fork territory, and the assembled lanes now exercise the same request envelope the served web app's HTTP carrier uses. Fixture scenario switches still apply, read from the mounted search when the bridge mints the world. The five golden lanes' output stays byte-identical. The spike conclusion is affirmative, so the migration is complete in this change: no follow-up filing, and the audit's reversal option closes this debt item (the fx seed adjustments stay registered as the item's residue).

## Alternatives considered

Keeping the arms registered was the status quo the audit retired: the block grows with every durable feature and the mirror obligation has no sync answer. A fork connection plugin overriding `ctx.connection` was rejected: it duplicates the whole plugin apply body, a wider replay surface than the arms. Importing the fixture module through its `./src/*` subpath was rejected: non-relative `.ts` imports cannot be rewritten under `rewriteRelativeImportExtensions` in the emitting client face (TS2877). Importing the fixture from built artifacts was rejected: the built client entry did not export the factory, and a source re-export is the one-line form of the same fix.

## Testing

`apps/daypaw-web/tests/durable-rpc.spec.ts` (moved out of the connection package as `fixture-durable.client.spec.ts`) drives the decorator directly: ledger queries, lineage, journal, the rerun append, startRun's registry resolution with the `durable/*` failure vocabulary, and the twin's first user message over the public session face. The five assembled golden lanes boot the decorated transport and compare byte-identical against their committed goldens.
