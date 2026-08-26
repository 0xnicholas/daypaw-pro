# Agent Note: daypaw approval board (pending group, in-conversation card, mux replay)

Status: implemented

English | [中文](2026-08-26-daypaw-approval-board.zh.md)

## Problem

Issue #58 (spec 05 §2/§3/§6, shell increment ③) turns the approval board from the [IA skeleton](2026-08-24-daypaw-shell-ia-skeleton.md)'s placeholder-zero group into the shell's security surface: pending approvals must aggregate into the 等待你确认 group across tasks with live counts, the selected task's conversation must pin an instant card (「<任务名> 请你确认：<业务动作摘要>」 + 同意/拒绝, reject optionally carrying a note back into the conversation, raw command folded into a details expander), and a cold start must restore the pending state. Issue #44 ruled the v1 backend face: dsh's interactive approval surface only — apiproxy pending aggregation plus mux replay — with no pending unary query, so every fact the board shows must come from the existing wire.

## Decision

- **The badge is the triage, and only the approval badge routes** — `projectInboxBoard` (ui-inbox `task-projection.ts`) moves any row — run-backed or run-less — whose runtime session summary carries `pendingInteraction: 'approval'` into 等待你确认 regardless of its status group, and flags it `awaitingApproval` so TaskList renders 等待确认 over the run status. The runtime collapses a session's pending interactions to one actionable status with questions winning over approvals, so a question-shadowed approval cannot route here; question and plan-review badges stay in their status groups because this board is the 审批待办 surface, not the ask-user one. Answering clears the badge (the resolved broadcast drops the wait), so the row falls back to its status group — the 板块联动 spec line needs no engine change: "task returns to 进行中" is the badge leaving.
- **Cold start is the mux-open replay, not a query** — the manager tracks pending-interaction badges for never-instantiated sessions from mux frames, and every mux open replays still-pending requests with stable rpcIds, so the group count survives a shell reopen with zero new endpoints (the #44 ruling). The resident fixture approval now pairs its `callId` with an open turn-75 tool/call so the card's details path reads through the real `runningCalls` window, and the resident question moved to fx-gamma — on the run-twinned session it would shadow the approval badge and the group could never fill.
- **The card is a ConversationView-internal component over the runtime's PendingWait carrier** — `ApprovalCard` narrows the session's pending list to the approval wait and answers through `wait.respond` with the domain encoding (`{ sessionId, approvalId, outcome: 'allowed-once' | 'rejected' }`); settlement is frame-driven (the resolved broadcast drops the wait, the parent stops rendering), and the buttons latch one-shot, re-arming with an error row only when the receipt is not accepted or the note send fails. Tool names never render (product vocabulary rule): the headline joins the task's display title with the ask's `reason` (generic 敏感操作 copy when absent), and the details expander shows the paired call's raw command, or its args pretty-printed, or the raw text when unparseable — the operator's verification channel. `callId`-less asks render no expander.
- **The reject note rides the ordinary queue prompt** — the registration's `sendNote` inject face resolves the session binding and prompts the trimmed note in `queue` mode, so a running task consumes it as steering (the #53 multi-segment run) and an idle one starts a new turn; no new wire face exists anywhere in the flow.

## Alternatives considered

- **A pending unary query (fetch pending approvals on demand)** — rejected by #44: mux-open replay is the cold-start baseline; a query endpoint would duplicate a fact the replay already carries.
- **Board triage off the run's `waiting` status** — rejected: 等待你确认 is a 派生态 join (spec 05 §2), not an engine state; the run stays `running` while the approval pends, and a run-less session carries no run status at all. The badge is the only cross-session aggregation the wire offers.
- **Routing question/plan-review badges into the group too** — rejected: the group's copy and counts promise approval work; a question row there would strand the user on a card that cannot answer it (the ask-user surface is the composer's, upstream).
- **A bespoke approval RPC for the answer** — rejected: `PendingWait.respond` is the runtime's answer carrier and already encodes the client-response envelope; a second path would fork the settlement race (respond is first-wins with a not-pending receipt).
- **Sending the reject note as steering mode** — rejected: steer mode fails on an idle session (the fixture degrades it to a queued turn, but the wire contract does not promise that); queue mode is defined for both states.

## Consequences

The board fills from replay alone, both answers close observably (card drops, badge clears, row returns to its status group, the reject note lands as a conversation row), and the whole surface rides existing upstream wire — the fork's additions are the projection rule, the card, the note path, and fixture/label wiring. Costs: one upstream fixture touch plus its spec (CORE_TOUCHES rows), the fx-gamma running flip became opt-in (`FixtureOptions.flipGammaRunning`) because an ambient flip races any golden that samples the sessions list, and the task-progress snapshot lane now reaches the fx-alpha conversation through the pending group (its board golden refreshed to the new boot board). The [task-progress note](2026-08-26-daypaw-task-progress.md)'s deferred item — the placeholder-zero group — is resolved here; its workflow-run caveat stands (a session-less run can still never badge, so a workflow run's approvals stay off this board until a run-scoped approval channel exists).

## Testing

ui-inbox specs pin the projection triage (approval badge routing for both row kinds, question/plan-review exclusion, the badge-clearing fallback); ui-tasks specs pin the card (headline join, tool-name absence, expander variants, one-shot latch and re-arm, the two-step reject with note ordering) and the `sendNote` queue path with both failure arms; the connection fixture spec pins the replayed approval/question homes and the opt-in flip; `apps/daypaw-web/tests/task-approval.snapshot.ts` pins the assembled loop keyless — cold-start replay (group count + row + status copy before any open), the card, the 同意 closure, and the 拒绝-with-note closure riding back into the conversation.

## Deferred

`ctx.waitFor` gate runs do not yet badge their runs (the engine primitive landed in #47 without a host bridge, so no run carries a gate-pending approval the wire would surface); a workflow run's approvals need a run-scoped approval channel; approval-strategy configurability stays out of v1 (spec 05 §6 fixed conservative default).
