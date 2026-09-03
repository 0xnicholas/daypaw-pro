# Agent Note: Mid-run task conversation reachability in the daypaw inbox

Status: implemented

English | [中文](2026-09-03-daypaw-midrun-conversation-reachability.zh.md)

## Problem

The #94 walkthrough reported that a task row could not open its conversation while the run was live, blaming sessions-list supply lag. Live-gateway reproduction (the assembled browser client over a real `dev:daypaw` server and a real model run, extending the [#75 wire-contract lane](2026-08-31-daypaw-start-run-args-envelope.md)) attributed the symptom differently: the wire feed is healthy — the twin session lists about half a second after `durable/startRun` (`api-session/added`, then `running:true`), and clicking the row mid-run re-enters the conversation. Two real breaks matched the acceptance gaps. First, the follow-up seat was a hardcoded disabled placeholder (`追问即将上线`), so mid-run steering did not exist. Second, when a run settles, the SDK body's agent-handle disposal emits `api-session/removed` for the twin; the client applied the removal and nothing re-pulled the list, so the persisted twin stayed unlisted and the done row degraded to a bare run link — only the frozen staged conversation kept showing history, and a page refresh was the accidental recovery.

## Decision

Three seams carry the fix. The engine gains a `durable/steerText` Remote: it resolves the run's definition and validates the free text through its wire face before recording the segment — the same starter-text rule `durable/startRun` applies, so the browser follow-up seat sends the bare text the dialog sends and the consuming body's `def.input.parse` re-check passes; the raw `durable/steer` Remote keeps recording as given, because in-process SDK callers pass validated values and cross-process steers land before the definition registers. The conversation seat goes live: ui-inbox passes the ledger run status (sessionId ≡ runId over the board store) as the seat's owner props, and the seat enables while the run is unfinished, submits `durable/steerText`, clears the draft on success, and shows an inline failure on wire or contract rejection. And the client SessionManager applies a removal frame immediately, then issues one reconciling `session.list` re-pull: a live-session disposal is not a durable deletion, so a persisted twin re-lists while a genuinely deleted session stays absent. The reconcile window also exposed a strict-slot hazard the live run caught: the conversation child seat is strict-session under a session-maybe parent, so WorkspaceSwitch now renders the placeholder — never the strict slot — while the selected task's session binding is masked, because an outlet rendered without a scope binding crashes its seat until a remount.

## Alternatives considered

**Gate the follow-up seat on the session's agent running bit.** Rejected: a steerable run parked at a segment boundary reads `running` on the ledger while its agent sits idle between turns, so the session bit would disable the seat exactly when steering matters; the ledger row is the gate.

**Route the follow-up through the queued session prompt (`sendNote`).** Rejected: the engine body parks on `ctx.awaitSteer`, and a queued session prompt does not wake it — the durable steer segment is the only channel the body consumes.

**Validate the raw `durable/steer` Remote through the wire face.** Rejected: that Remote also serves in-process SDK callers, whose input is already contract-validated, and cross-process steers that land while no definition is registered must still record (the consumption-side cross-writer defense owns them); a dedicated free-text endpoint keeps both contracts separate.

**Keep the host from emitting `api-session/removed` for persisted sessions.** Rejected: disposal of the live session is correct host semantics and persistence is not synchronously knowable there; the client list is a projection of a pull plus live frames, so convergence belongs at the pull.

**Link agent-run rows to sessions unconditionally in the board projection.** Rejected: `sessions.open` fails loud on unlisted ids, so the row must reflect list truth rather than paper over the gap.

## Consequences

A json-kind definition rejects free-text follow-ups at the boundary; the seat shows the inline failure instead of the run failing later at consumption-side validation. Every `api-session/removed` frame now costs one single-flight list re-pull, and the removal-then-relrow window briefly flickers a resurrected row. Post-settlement, the done row re-opens the conversation from the persisted twin without a reconnect. The live-gateway harness (cookie-authed `/api` HTTP plus the `/api/remote.mux` WebSocket over the `ws` package, injected through `__DSH_TRANSPORT__` into the assembled jsdom boot) remains the only lane that exercises the real client against the real gateway with a real model round; it is a scratch workflow, not a committed lane, because it needs a running server and an API key.
