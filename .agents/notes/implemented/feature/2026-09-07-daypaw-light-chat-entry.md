# Agent Note: the light-chat entry returns to the daypaw inbox

Status: implemented

English | [中文](2026-09-07-daypaw-light-chat-entry.zh.md)

## Problem

The dsh web shell upstream always had a direct-conversation entry; the daypaw IA redo folded every conversation into the task surface (the 「一切皆任务」 stance from map #1). Usage evidence ([#102](https://github.com/0xnicholas/daypaw-pro/issues/102), the 2026-09-02 usage-evidence inventory) showed the owner's daily chats happening entirely outside daypaw and the task surface logging 3 runs in 10 days: the stance retained neither the conversations nor the task habit. Ruling [#98](https://github.com/0xnicholas/daypaw-pro/issues/98) (map #95, gap ② from map #77) decided to bring the light-chat entry back as the cheapest daily-residency experiment; the formal spec-05 §1 impact of loosening the stance is owned by the positioning ruling (#99) and the spec revision (#101), not by this change.

## Decision

The inbox nav carries 「直接和助手聊」 beside 「+ 新任务」: a full-width outline button in the expanded column and a chat icon on the collapsed rail (`@daypaw/ui-inbox` InboxNav, copy in the `inbox` locale namespace). The entry opens a **plain session** through `ctx.sessions.create()` — no engine run, no definition pick, no `startRun` — and selects it through the existing `kind: 'task'` selection path, so the conversation renders through the existing middle-column occupant with zero new selection plumbing. A create failure only warns (the nav is stateless pure props; the upstream ui-workspace New Session failure precedent), and never moves the selection.

The conversation seat (`@daypaw/ui-tasks` ConversationView) now keeps its input live for run-less sessions: while a task's durable run is unfinished the seat steers as before (#94), and a run-less session — the light-chat case — sends ordinary queued session prompts through the same sender the approval reject note rides (`binding.session.prompt(..., 'queue')`), never a steer. Copy for the chat seat lives in the `daypaw-tasks` namespace (`conversation.chat.*`).

Run-less session rows were already projected by `taskInboxBoard`'s session-rows path; a freshly created blank session stays an invisible draft until its first accepted prompt flips the blank bit, after which it lists by its status group and rebuilds from the durable sessions list on every projection pass — the same face a refresh rebuilds.

## Consequences

Chatting starts without the task dialog, and a settled chat appears as a run-less row in the 已完成 group that survives refresh through the durable sessions list. The seat-liveness rule widened from 「unfinished run only」 to 「unfinished run or run-less」, so the transient window where a just-started engine task's ledger row has not loaded yet renders the chat placeholder briefly before the board tick lands the steer seat; a prompt sent in that window rides the queue channel, which the engine session consumes as steering — the same semantics the reject note already relies on. Repeated entry clicks mint fresh blank sessions that the inbox hides (blank drafts never row); the host keeps them as ordinary empty sessions. The daypaw product vocabulary gains its first non-task conversation word (聊天), held in the locale dictionaries beside the task vocabulary.

## Alternatives considered

**Keep the entry out (挂账观察 or 明确不做)**: rejected by ruling #98 — the usage evidence showed the task-only stance retaining neither conversations nor task habits, the inbox already renders run-less rows and the session-selection path, so the entry is the cheapest possible experiment toward daily residency.

**Reuse an existing blank draft on click (the upstream New Session reuse rule)**: rejected — upstream reuse matches on cwd plus workspace membership, facts the daypaw create path does not carry, and a matching rule loose enough to work could steal an engine twin's blank birth window; minting a fresh invisible draft per click is the smaller hazard.

**A dedicated `kind: 'chat'` selection**: rejected — the `kind: 'task'` path already drives `sessions.open` one-way and resolves the conversation seat; a parallel kind would duplicate the selection plumbing for no behavioral difference, since the projection treats a chat exactly as a run-less session row.

**An inline create-failure surface on the nav**: rejected — InboxNav is stateless pure props today; introducing dialog-less error state on the column for a host-down edge case costs more than the warn path (the upstream New Session failure precedent) that keeps the component contract unchanged.
