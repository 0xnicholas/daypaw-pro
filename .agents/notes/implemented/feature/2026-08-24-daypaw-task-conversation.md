# Agent Note: daypaw task conversation (new-task dialog, task list, business-language view)

Status: implemented

English | [中文](2026-08-24-daypaw-task-conversation.zh.md)

## Problem

Issue #56 turns the [shell IA skeleton](2026-08-24-daypaw-shell-ia-skeleton.md)'s group counts, new-task stub, and conversation placeholder into the working task surface: create a task from the nav dialog (agent picker + first prompt), list an inbox group's tasks, and read one task's conversation in business language. The constraints inherited from [the settings ticket](2026-08-24-daypaw-settings-first-run-card.md) — upstream `packages/client/` untouched, host as the single fact source, zh as the copy key-set authority — meet three new questions: what a "task" is when the product has no task engine yet, how the conversation column renders business language without forking the upstream chat, and how the assembled fork composition gets the snapshot coverage both predecessor notes deferred.

## Decision

A new fork client UI plugin `packages/daypaw/ui-tasks` (`@daypaw/ui-tasks`, private, 0.0.0) occupying the three child seats ui-inbox declares, plus the fork's assembled-web snapshot lane (`apps/daypaw-web/tests/`, `vitest.web.daypaw.config.ts`, root `test:web:daypaw` scripts):

- **A task IS a session, projected** — `projectInboxBoard` in ui-inbox (`src/client/task-projection.ts`) is the single projection from the sessions list: non-blank + running → 进行中, non-blank + settled → 已完成, pending always empty. The nav counts and the task list share it, so the two surfaces can never disagree. List rows render each task's 最近动态 last-activity time against an owner-injected clock, so a crash-revival pause reads as an active, recently-moving task. The [task-progress board](2026-08-26-daypaw-task-progress.md) merges the engine's run ledger into this same projection; the word "task" never leaks a run/session/journal term (a locales spec rejects that vocabulary in both dictionaries).
- **The conversation view is a whitelist projection, not a chat fork** — `projectBusinessRows` (`src/client/chat-projection.ts`) walks the assembled Chat snapshot and keeps only user messages, steering, assistant text, and a localized terminal-failure marker; tool calls, commands, retries, metrics, and hidden nodes drop out by whitelist. `ConversationView` adds a 进行中 status row while the session runs (a crash-revival pause reads as ordinary progress; the revival stays invisible) and a disabled 追问 input seat.
- **Selection drives the runtime current session one-way** — ui-inbox's `InboxSelectionController` now takes `ctx.sessions.open`: picking a task sets the selection AND opens the session, so the session-maybe conversation seat resolves the selected task. Group and page selections never touch the runtime session.
- **Submit survives the create/list race** — `sessions.open` fails loud on an unlisted id and the host's session-added frame races the create response, so `NewTaskStore.submit` waits for the list projection to carry the new row (`whenListed` subscription) before open → `binding` → first prompt. Failures land inline on the dialog as generic localized copy — raw host error wording never reaches the business surface; only success calls the owner's `openTask`, which navigates and dismisses.
- **The assembled snapshot lane boots the fork roster from built bundles** — `apps/daypaw-web/tests/assembled-boot.ts` follows the apps/web precedent (AppWebEntry ModuleLoader + keyless FixtureApiClient, English pinned) with the cordis.patch.yml client rows. The roster includes `@deepseek-ai/dsh-client-ui-conversation` even though no upstream chat surface renders: the Chat node definitions (`user`/`assistant-step`/`turn-error`…) are registered into `ctx.conversationEvents` by that package, so without it the assembled Chat snapshot is empty and the whitelist projection has nothing to read. Its priority-0 `conversation`/`details` occupants stay shadowed by ui-inbox's -1.

Tests follow the [GUI testing system](../process/2026-07-20-gui-testing-system.md)'s zero-machinery path: store specs over a programmable wire fake (roster health filter, default preselection, latest-wins generations, submit guards, the whenListed wait, non-Error rejections), jsdom component specs (dialog flows, list rows, the whitelist projection incl. hidden/empty-text skips, the disabled follow-up seat), `toMatchSnapshot`s, an apply spec over a real `SlotRegistry` + `LocaleRuntime` pinning the three seats and teardown, and the assembled journey snapshot (dialog → submit → streaming echo → golden text shape). Package src sits at per-file 100% coverage. New core touches (tsconfig.client.json reference/include rows, knip workspaces + the web-app exemption, root test:web:daypaw scripts) are registered in [CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md).

## Alternatives considered

- **A dedicated conversation store per task** — rejected: the session-maybe seat already hands the occupant the current `ConversationSnapshot` through the standard `useSession` kit; a second store would fork the fact source. The view stays a pure projection module plus the standard hook.
- **Per-kind exclusion instead of a whitelist** — rejected: the chat assembles merge-extensible node kinds any installed plugin can add; enumerating what to hide silently leaks every future kind onto a non-technical surface. The whitelist fails closed.
- **Excluding ui-conversation from the snapshot roster** (the plan's original "不进图") — rejected on evidence: client-runtime ships only `EMPTY_CHAT_SNAPSHOT`; the node definitions that fill it live in ui-conversation's conversation-nodes registrations. The lane needs the package for data, not for its (shadowed) occupants.

## Consequences

The fork composition now boots to a working task loop: nav → new-task dialog → streaming business-language conversation, pinned end-to-end by a keyless assembled snapshot. The lane also closes the assembled-web coverage debt both predecessor notes carried. Costs: the session side of the task groups derives from the sessions list's `blank`/`running` bits (pending stays empty, crash-revival reads as progress; the [task-progress board](2026-08-26-daypaw-task-progress.md) merges the run ledger into the same projection); the follow-up input is an inert seat; and the conversation seat's session-maybe scope means an absent current session renders the owner placeholder, never the view.

## Deferred

The live 追问 input (follow-up ticket) and approval cards in the flow (approval ticket) remain later-ticket scope, mirrored in the package README's Known Limitations; the engine-backed query face, run retry, and the selected-task detail column shipped with the [task-progress board](2026-08-26-daypaw-task-progress.md).
