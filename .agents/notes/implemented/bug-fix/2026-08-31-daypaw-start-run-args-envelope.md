# Agent Note: The dialog start payload nests under the `request` parameter

Status: implemented

English | [中文](2026-08-31-daypaw-start-run-args-envelope.zh.md)

## Problem

Submitting the daypaw new-task dialog failed inline every time, on every instance, while the roster loaded fine and the engine ledger never gained a row. The Typert gateway rejected `durable/startRun` with `args fields do not match the descriptor: missing "request"; unexpected "defName", "defVersion", "input", "runId"`: the gateway validates args keys against the Remote method's named parameters, and `startRun(request: StartRunRequest)` names its single parameter `request`, but `new-task-api.ts` spread the request fields flat into `args` (`{ args: request }`). Nothing caught the mismatch before shipping because every daypaw web golden boots against the keyless fixture transport, which answers scripted payloads without descriptor validation, and the tarball smoke only proves the URL line and dist serving.

## Decision

`new-task-api.ts` now posts `{ args: { request } }`, and a wire-contract spec in `@daypaw/web-app` boots the real Typert registry, gateway, and durable engine, drives `createNewTaskApi` through the gateway's unary dispatch (envelope decode, invoke, failure envelope), and asserts three things: the roster lists through `listDefinitions`, a dialog-shaped `startRun` creates the ledger row with the wire face's wrapped input, and the old flat-spread args still fail descriptor validation with no run written. The spec is the executed proof of the args envelope; the fixture-transport lanes remain the model-visible golden surface.

## Alternatives considered

**Rename the engine parameter to defName-and-friends so a flat spread matches.** Rejected: multi-parameter endpoints (`steer(runId, input)`) already pin named-args dispatch, so the client must nest named parameters regardless.

**Validate the payload shape inside the dialog against a hand-copied descriptor.** Rejected: a copy drifts exactly like the bug it guards; the gateway is the descriptor's single fact source.

**Extend the fixture transport to run descriptor validation.** Rejected: the fixture's job is deterministic canned answers for goldens; duplicating gateway validation there builds a second gateway.

## Consequences

Dialog submits reach the engine again (verified end to end in a real browser against the rebuilt bundle: run row written, conversation opens). `@daypaw/web-app` dev-depends on `dsh-typert-registry` and `dsh-api-gateway` for the contract spec. Any future `durable/*` client call whose payload the golden lane cannot shape-check (the fixture never rejects) needs the same gateway-backed contract case or a shape change will ship silently again.
