# Agent Note: The daypaw RemoteMock world (`apps/daypaw-web/tests/daypaw-remote.ts`)

Status: implemented

English | [中文](2026-09-23-daypaw-remote-mock-scenario.zh.md)

## Problem

The fork's ten golden lanes booted against the shared upstream browser fixture (`packages/client/connection/src/client/fixture.ts`, 4,136 lines in-tree), so the fork's world facts — the approval pair with its `callId`, the turn-75 `todo_write` sample behind the resident pending approval, the question waterfall parked on fx-gamma — lived as seed edits inside an upstream file, registered as core touches. Upstream replaces that fixture with `@deepseek-ai/dsh-remote-mock` (endpoint rule table, stream scripts, call log, `assertNoUnmatched()`) plus the client-test-runtime assembly tier; the deletion commit lands with the 2026-09-27 sync window. Until the fork's world moved onto the replacement surface, every sync rehearsed a dead fixture and the lanes had no home that survives the deletion.

## Decision

The fork's keyless world is a single TS module, `apps/daypaw-web/tests/daypaw-remote.ts` ([ADR 0018](../../../../docs/adr/0018-remote-mock-scenario-home.md)): `RemoteMock.create()` layered over the assembly tier's `remoteDefaultResponses`, with the fx-world facts as typed literals and rules. The seed facts (fx-alpha's 76-turn history, the projection folds, the `$events` waterfalls, the prompt echo generator with assistant growth frames and `turn/end`) moved from the retired fixture verbatim, so committed goldens stay byte-stable — the landing ran all ten lanes green with zero golden delta.

The carrier axis stays fork-side: `connectionRpcCarrier(decorateDurableRpc(world.mock.rpc))`. `durable/*` remains answered by the `durable-rpc.ts` decorator (its ledger, journal, and registry tables are untouched); because the decorator is a pass-through wrapper, `assertNoUnmatched()` coverage is undiminished. The teardown in the lane's `assembled-boot.ts` runs `assertNoUnmatched()` after the lane's own unmount hook (vitest's reverse-registration afterEach order), so an undeclared endpoint any lane reaches fails loud instead of being silently absorbed as the fixture did.

The world's live-path controls return as a typed handle: `createDaypawRemote()` returns `{ mock, appendApproval }`, and `durable-rpc.spec.ts` drives the live approvalHistory frames through it. The `__fxTiming` global the fixture installed is gone.

Two config prerequisites make cross-package source imports resolve under pnpm strictness and `tsc -b`: `apps/daypaw-web` declares `@deepseek-ai/dsh-remote-mock` and `@deepseek-ai/dsh-client-test-runtime` (plus the value-imported `dsh-llm`/`dsh-session`/`dsh-brand`/`dsh-tool-todo`) and carries matching tsconfig project references. Without the references, `tsc -b` fails TS6307/TS6059 and emits `*.js` pollution into `packages/test-support/*/src`.

Landing the acceptance line also required pinning `@deepseek-ai/cordis` in the release sdk-smoke peer installs (`scripts/release/daypaw.ts` `externalPeerPins`): the registry serves cordis 4.0.4 under the sdk's `~4.0.1` peer range, and the consumer's cordis typings stopped unifying with the closure's (`ctx.durable` missing, `ctx.plugin` options degraded) — the same drift class the existing zod pin exists for. The pin resolves the workspace (vendored) version, as zod does.

## Alternatives considered

**Port the old fixture into a fork-private package.** Cheapest one-time move, but it permanently owns 4,136 upstream-derived lines plus a 1,782-line spec that drift with every production-face change, against ADR 0015's near-clone discipline. Rejected in ADR 0018.

**Fold `durable/*` into mock rules.** Would put the whole transport in one rule table; costs ~800 lines of rewrite (decorator plus its 277-line spec) for no technical need — `RemoteMock.rpc` and the decorator's `ClientConnectionRpc` are the same type. Kept as the decorator.

**Base on upstream's JSON world with a fork overlay.** The upstream fixture JSON is a test file with no compatibility promise, and the fork's seed differences (callId pairing, turn-75, question ownership) are large enough that the overlay would rival a full authoring.

## Consequences

- The lanes' world is fork-owned: upstream changes to its own JSON world cannot shift fork goldens, and every new fork world fact is authored in the scenario module.
- `assertNoUnmatched()` names every endpoint a lane reaches without a rule; during the landing the only such gap was `settings/mutate` (brand-theme's preference write), answered with the fixture's read-only rejection so preference writes fall back to local persistence.
- The scenario answers only what the ten lanes' journeys plus the durable decorator's twin drive reach (`session/*`, `workspace/create`, settings/credentials/model faces, composer faces). File-tree, directory-picker, goal, and search endpoints stay unregistered until a lane reaches them — a missing rule is a loud failure, not a silent gap.
- Remaining with the 2026-09-27 window (upstream files in-tree): swap `packages/daypaw/assembled-boot` to the upstream body (self-built mock, `__DSH_TRANSPORT__` install, `AssembledRemote`, teardown assertion) and reread its three lane axes; delete `createFixtureConnectionRpc`'s re-export; retire the two `apps/web` e2e fork-delta registration lines per ADR 0018 §4.
