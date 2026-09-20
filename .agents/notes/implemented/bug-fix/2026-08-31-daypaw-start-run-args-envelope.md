# Agent Note: The dialog start payload nests under the `request` parameter

Status: implemented

English | [中文](2026-08-31-daypaw-start-run-args-envelope.zh.md)

## Problem

Submitting the daypaw new-task dialog failed inline every time, on every instance, while the roster loaded fine and the engine ledger never gained a row. The Typert gateway rejected `durable/startRun` with `args fields do not match the descriptor: missing "request"; unexpected "defName", "defVersion", "input", "runId"`: the gateway validates args keys against the Remote method's named parameters, and `startRun(request: StartRunRequest)` names its single parameter `request`, The gateway's key check therefore rejects `{ args: request }`, which places `defName`, `defVersion`, `input`, and `runId` where it expects a single `request` key. Descriptor validation runs only at the gateway: the daypaw web goldens boot against the keyless fixture transport, which answers scripted payloads without validating args keys, and the tarball smoke covers only the URL line and dist serving.

## Decision

`new-task-api.ts` posts `{ args: { request } }`, and a wire-contract spec in `@daypaw/web-app` boots the real Typert registry, gateway, and durable engine: the roster lists through `listDefinitions`, a dialog-shaped `startRun` writes the ledger row from the wire face's wrapped input, and flat-spread args fail descriptor validation with no run written. The spec is the executed proof of the args envelope; the fixture-transport lanes remain the model-visible golden surface.

## Alternatives considered

**Rename the engine parameter to defName-and-friends so a flat spread matches.** Rejected: multi-parameter endpoints (`steer(runId, input)`) already pin named-args dispatch, so the client must nest named parameters regardless.

**Validate the dialog's `args` keys against a hand-copied descriptor.** Rejected: a copy drifts exactly like the bug it guards; the gateway is the descriptor's single fact source.

**Extend the fixture transport to run descriptor validation.** Rejected: the fixture's job is deterministic canned answers for goldens; duplicating gateway validation there builds a second gateway.

## Consequences

A dialog submit writes the run row and opens the conversation. `@daypaw/web-app` dev-depends on `dsh-typert-registry` and `dsh-api-gateway` for the contract spec. Any future `durable/*` client call whose args keys the golden lane cannot check (the fixture never rejects) needs the same gateway-backed contract case or an args mismatch will ship silently.
