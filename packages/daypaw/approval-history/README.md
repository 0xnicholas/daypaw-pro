---
description: "Session-projection unit approvalHistory for the daypaw browser shell. The plugin folds the approval/asked + approval/decided audit pair "
kind: "package-reference"
---

# @daypaw/approval-history

English | [中文](README.zh.md)

## Summary

## Table of Contents



Session-projection unit `approvalHistory` for the daypaw browser shell. The plugin folds the `approval/asked` + `approval/decided` audit pair (declared by [`@deepseek-ai/dsh-user-approval`](../../interaction/user-approval/README.md)) into the ordered per-session approval list the task detail pane's 审批历史 section renders, and registers it on `ctx.sessionProjections`. The plugin owns only the fold; the seam owns delivery (snapshot, change feed, persisted cache).

## Projection unit

- Key `approvalHistory`, `stateVersion: 1`.
- Value: the entries array (readonly), one entry per ask in log order — `{ id, toolName, reason?, outcome? }`. `id` is the ask's `ApprovalRequestId`; `outcome` lands when the `approval/decided` pairs by `id`. An ask without its decision stays outcome-less. `reason` is ABSENT (never undefined-valued) when the ask carried none; the event's `callId` stays in the log and is not projected.
- An `approval/decided` whose id matches no recorded ask folds to the same state reference (ignored): the approval service appends the ask before its decision in every valid log, so an unknown id has nothing to pair with.
- Unrelated events return the same state reference — the registry's `Object.is` no-op gate.

The `./types` outlet carries the `SessionProjectionMap` merge so browser consumers can call `useProjection('approvalHistory')` type-safely.

## Model Experience

### Stored domain records

#### What the model sees

Nothing. This package contributes no prompt, tool, or schema; it folds the log-only `approval/asked` + `approval/decided` audit events into the `approvalHistory` read model for the browser shell.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the projection is never part of a live request prefix.

## Known Limitations and Deferred Work

- **Rendering is out of scope** — this package serves the projection value only; the 审批历史 section UI lives in the fork's client layer (ui packages).
- **No per-call granularity** — one entry per ask; an ask spanning multiple tool calls (no `callId`) is a single row, and the `callId` of a specific call is recoverable only from the log itself.

### Dev Note
