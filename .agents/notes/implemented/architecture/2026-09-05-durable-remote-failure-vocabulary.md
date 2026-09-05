# Agent Note: durable/* Remote failure vocabulary

Status: implemented

English | [中文](2026-09-05-durable-remote-failure-vocabulary.zh.md)

## Problem

The fork's `durable/*` private Remote endpoints failed with plain `Error` messages: the gateway encoded them as code `internal`, so shell consumers (ui-inbox, ui-agents, ui-tasks) could only parse message text, and the fixture answered the browser with its own divergent message-only failures. Upstream `804b1ffbfc` (in the next sync window) converges the whole Remote failure vocabulary: one `RemoteError` class with a merge-extensible `RemoteErrorDetailsMap`, domain-prefixed codes (`gateway/*`), discrimination by code. Leaving the fork as-is turns that sync into a hard replay across engine, SDK, consumers, and fixtures.

## Decision

One closed `durable/*` code set with typed details, canonically declared in [`@daypaw/engine` `src/failures.ts`](../../../../packages/daypaw/engine/src/failures.ts). Owners throw at the failure point through this tree's wire failure vehicle `TypertRemoteFailure` (the gateway's `rpcFailure` passes `.failure` through unchanged), and consumers discriminate by `error.code`, never by message text. The sdk wire face folds zod rejections into `durable/input-invalid` carrying the zod issues; the engine's `startRun`/`steerText` boundary folds every other wire-face rejection into the same code while preserving the rejection's message, so hand-rolled faces keep their diagnostic under the stable code. Fixture failure answers carry the same codes, details, and the engine's message wording. When the sync lands `RemoteError`, `src/failures.ts` becomes that map's `durable/*` declaration and only the carrier class swaps — codes and details stay.

## Consequences

Wire-reachable engine failures are stable across message edits: twelve codes cover every failure path that crosses the Remote boundary (`run-not-found` serves steer, steerText, rerun, and cancel), each with typed details a consumer can act on without string parsing. Shell consumers surface the code next to the endpoint name in their fail-loud errors, so browser error states show the stable vocabulary. The engine's ledger-open failure keeps its message exactly (the cause stays in-process only, as before). The fixture's ambiguous-definition branch stays unreachable with the seeded roster, exactly as the pre-vocabulary code was — the roster has no name collisions by design.

## Alternatives considered

Keeping message-text discrimination was the status quo this ticket retires: every consumer rewrite and every sync replay re-parsed prose. Pre-building a fork `RemoteError` clone on this tree was rejected: the base class does not exist here, and a fork lookalike collides with the class the sync brings — the ticket exists to make that sync cheap. instanceof-based discrimination anywhere in fork code was rejected: upstream replaces instanceof with a structural marker precisely because module identity breaks across bundles; the one instanceof check that remains lives in upstream's `rpcFailure`.

## Testing

`packages/daypaw/engine/tests/failure-vocabulary.spec.ts` walks the whole code map — every wire-reachable path asserts code, details, and unchanged message text, ledger-unavailable included. `packages/daypaw/sdk/tests/agents-dir.spec.ts` pins the zod issues detail, and `packages/daypaw/web-app/tests/wire-contract.spec.ts` proves the code crosses the real gateway (its `gatewayRpc` helper now mirrors `rpcFailure`'s pass-through instead of flattening business failures to `internal`). `packages/client/connection/tests/fixture-durable.client.spec.ts` pins the fixture answers, and the three consumer specs pin the `(code)`-carrying failure format.
