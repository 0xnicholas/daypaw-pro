# Agent Note: daypaw task progress board (hybrid feed, detail pane, rerun)

Status: implemented

English | [中文](2026-08-26-daypaw-task-progress.zh.md)

## Problem

Issue #57 (spec 05 §2/§5, shell increment ②) turns the inbox board into the task-progress surface: the 进行中/已完成 groups feed from the durable engine's query face, the right-hand detail pane carries four sections (progress / subtasks / artifacts / approval history), and a failed run offers 重试. The [engine query face](2026-08-25-daypaw-engine-query-face.md) already gives the host `listRuns`/`runLineage`/`journalTimeline`, but the browser reaches only the gateway's Typert Remote channel (the [agent catalog](2026-08-25-daypaw-agent-catalog.md) constraint), and the [task conversation](2026-08-24-daypaw-task-conversation.md) board knows only sessions — a workflow run has no session, so a sessions-only board can never list one.

## Decision

- **Hybrid feed: board rows = top-level runs ∪ run-less sessions** — `projectInboxBoard` (ui-inbox `task-projection.ts`) merges the ledger rows from `durable/listRuns` with the sessions list: child runs never row (they live under their parent's lineage), an agent run claims its session twin (its runId IS the session identity, so the same id would double-list), and a blank session is a draft, not a task. A run row carries `sessionId` only when the twin is actually listed — `sessions.open` fails loud on unlisted ids — so clicking a listed agent run opens its session while an untwinned or workflow run goes through the new run selection (`{ kind: 'run', runId }`) into the detail column.
- **`rerun` is a real engine verb, not a UI stub** — `DurableEngineCore.rerun(runId)` guards four ways (unknown run, non-terminal status, child run, unregistered definition all throw), then inserts a fresh row with the same definition identity and input — `attempt = source + 1`, `retried_from_run_id = source` — through the `insertAndDrive()` extraction it shares with `run()`'s start branch, and drives it. The child-run guard is load-bearing: a child rerun would detach the attempt chain from the parent's step journal, so retry the top-level run instead. The service carries `@Remote('rerun')` (the `listDefinitions` precedent), and the three query methods gained the same markers, so the browser reaches `durable/listRuns` / `durable/runLineage` / `durable/journalTimeline` / `durable/rerun`. Wire boundary: `RunLineage` members are `... | null`, never `undefined` — Typert Remote types must survive JSON, which drops undefined-valued keys; and `@daypaw/store` gained a runtime-free `./types` subpath re-exporting the row types because the Typert analyzer scans the exports subpaths of the package that owns the declaration.
- **Approval history is a session projection unit, fed by session events** — the new host package `@daypaw/approval-history` folds the `approval/asked` + `approval/decided` audit pair into the `approvalHistory` unit (`stateVersion: 1`) on `ctx.sessionProjections`; the detail pane's 审批历史 section reads it through the standard `useProjection` seat. The audit pair is already the model-visible ⟺ logged record, so the projection adds no new event.
- **DEVIATION from spec §5: the browser polls the Remote endpoints** — the spec's literal design is host-poll plus a mux projection. Session projections are strictly per-session, so neither they nor the session-scoped mux channel can carry the cross-run board. Instead ui-inbox's `RunsBoardStore` polls `durable/listRuns` every `RUNS_BOARD_POLL_MS` (2000 — the WebBootEntry boot graph has no per-plugin config channel, so the cadence is a product constant), and `TaskDetailStore` loads lineage plus timeline on selection. The fixture answers all four `durable/*` endpoints, keeping every client lane keyless.
- **The detail pane keys off the selection, never the session seat** — the `'details'` slot is strict-session scope and may carry a stale session while a session-less workflow run is selected, so `TaskDetailView` derives from the workbench selection and session-bound sections read the seat only when its sessionId matches. ui-inbox's `TaskDetail` renders the header (run title, strict status copy, the 重试 button on failed runs) and delegates the body to the new `'inbox.detail.body'` slot, which ui-tasks' `DetailBody` occupies with the four sections: workflow progress is the journal step timeline, agent progress is the last three business rows of the conversation; subtasks are the lineage children; artifacts are the parsed `output_json`. `ctx.spawn` is unimplemented, so the spec's separate "spawn child runs" section folds into the single subtasks section.

## Alternatives considered

- **Sessions-only board** — rejected: workflow runs have no session; the board would silently drop the spec's second run kind.
- **Spec §5's host-poll + mux projection literally** — rejected as impossible today: session projections are strictly per-session and no cross-session mux projection exists, so the cross-run board has no session to hang on. The browser poll is the recorded deviation; if a cross-session projection channel lands, the board can move to it without touching the endpoints.
- **UI-side retry that re-submits the input** — rejected: retry is engine semantics (attempt chain, `retried_from_run_id`, revival on boot scan); a client-side re-create would fork the fact source and lose the lineage the detail pane renders.
- **`RunLineage` absent members as `undefined`** — rejected: JSON drops undefined-valued keys, so the wire value would disagree with the declared type; `| null` keeps the Typert boundary honest.

## Consequences

The board lists both run kinds plus run-less sessions from one projection, the detail pane shows progress/subtasks/artifacts/approvals for the selection, and retry creates a visible attempt chain — all pinned keyless by the `task-progress` snapshot lane. Costs: a new host package plus its wiring (tsconfig reference and paths mapping, knip entry, cordis.patch roster row, web-app dependency, CORE_TOUCHES registrations), one upstream fixture touch, the 2s browser poll (no push channel), and a public `@daypaw/store` `./types` outlet that exists only for the Typert analyzer.

## Testing

ui-inbox specs cover the wire-boundary parser (all rejection branches), the board and detail stores (generation races, poll lifecycle, the retry board-kick), the hybrid projection merge, the status vocabulary, and the detail column; engine `rerun.spec.ts` drives the four guards and the attempt chain through the service; the fixture spec pins the four `durable/*` endpoints; `apps/daypaw-web/tests/task-progress.snapshot.ts` records the board and detail goldens through the assembled web app.

## Deferred

The 等待你确认 group stays a placeholder zero until the approval board ticket (#58) wires pending interactions; `ctx.spawn`'s child-spawn surface lands with the primitive itself; a push-based board refresh waits for a cross-session projection channel; a workflow run has no session, so its 审批历史 section renders only the empty state — workflow-level approval surfacing waits for a run-scoped (not session-scoped) approval channel.
