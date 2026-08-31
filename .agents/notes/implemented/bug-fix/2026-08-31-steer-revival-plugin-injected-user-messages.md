# Agent Note: steerable revival stranding — delivered-ordinal counting swallowed plugin-injected user messages

Status: implemented

English | [中文](2026-08-31-steer-revival-plugin-injected-user-messages.zh.md)

## Problem

A steerable agent run parked with a recorded-but-undelivered segment never delivered it after a process death and revival, and a later segment skipped past it (ticket #73, first real product-shell run). The delivered ordinal in `@daypaw/sdk`'s `countDeliveredSteers` counted every `user/message` event, assuming user messages could only be the initial input, RESUME wakes, and steer deliveries. Host compositions that inject producer context — the agent-loop runtime-context snapshot carries `source: {kind: 'plugin', …}` — add user messages the body never delivered, inflating the ordinal by one per injection. Pure-SDK test hosts inject nothing, so every existing steer and revival test stayed green.

## Decision

`userMessageText` accepts only user-sourced messages (`source.kind === 'user'`), so the delivered ordinal counts exactly the messages the body delivered: initial input, RESUME wakes, and steer segments. Producer-injected context (runtime-context snapshots, relays, recalls, tool results) never counts. The message-source discriminated union is the structural marker; counting and delivery read the same field, so no text heuristic or marker message is involved.

## Alternatives considered

**Content-matching segments against session texts.** Rejected: two identical follow-ups are legitimately distinct; ordinal identity exists precisely because content is not identity.

**Tagging steer deliveries with a private marker in the message source.** Rejected: `MessageSourceMap` already discriminates producers; a second, SDK-private axis would duplicate it.

## Consequences

- The regression test parks a run, injects a plugin-sourced snapshot into the live session, kills the process, records a segment while dead, and asserts the revival delivers it (red without the fix: the parked revival never wakes).
- Runs stranded under the old counting stay stranded (their ordinals are already wrong in the log); steer them once to a terminal state or rerun.
