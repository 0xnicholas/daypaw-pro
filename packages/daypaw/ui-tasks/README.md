# @daypaw/ui-tasks

English | [中文](README.zh.md)

The daypaw task surfaces, a fork client UI plugin occupying the four child slots [`@daypaw/ui-inbox`](../ui-inbox/README.md) declares on its nav, workspace, and detail registrations: the new-task dialog, one inbox group's task list, the selected task's business-language conversation view, and the selected task's detail body. It implements the task half of [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) — a task is the product word for a session or a top-level durable run, and this surface keeps run/session/journal vocabulary off the screen. Facts come through the connection wire face (`agentPresets.list`, `sessions.create`) and the sessions service (list projection, `open`, `binding`); the host stays the single fact source.

Four registrations in one `apply`, all pure-props components over apply-closure stores and the standard slot kits:

- `NewTaskDialog` occupies `'inbox.new-task.dialog'` (single, root; the Modal chrome stays with `InboxNav`). An agent picker over the healthy preset roster (a broken preset can never compose a task, so it is filtered, not shown; the deployment default is preselected), the task text area, and the submit row. Submit runs create → wait-for-list → open → first prompt: `sessions.open` fails loud on an unlisted id and the host's session-added frame races the create response, so the store waits for the list projection to carry the new row before opening it. Failures land inline on the dialog as generic localized copy — raw host error wording never reaches the screen; success hands the new session id to the owner's `openTask`, which navigates and dismisses.
- `TaskList` occupies `'inbox.workspace.tasks'` (single, root). It renders the owner's projected rows — title, the agent running the task, a 最近动态 last-activity line (the owner injects the clock), and the strict five-state status copy when the row comes from a durable run (one `run-status.ts` home shared with the detail body) — and opens a row's conversation on click (a session-backed row opens its session; a session-less run row goes through the owner's `openRun`). The projection itself lives in ui-inbox (`projectInboxBoard`), so the nav counts and this list share one fact source; an empty group renders the list's own 暂无任务.
- `ConversationView` occupies `'inbox.workspace.conversation'` (single, session-maybe; the current session is already the selected task, driven one-way by ui-inbox's selection). It renders `projectBusinessRows`, a whitelist projection of the assembled Chat snapshot: user messages, mid-task steering, assistant text, and a localized terminal-failure marker. Tool calls, commands, retries, metrics, and hidden nodes stay off by whitelist, not per-kind exclusion. A 进行中 status row shows while the session runs (a crash-revival pause reads as ordinary progress), and a disabled input marks the 追问 seat until its own ticket lands. While an approval pends, `ApprovalCard` pins atop the flow (the session's pending list feeds it, mux replay restores it after a cold start, the resolved broadcast removes it): the 「<任务名> 请你确认：<业务动作摘要>」 headline with 同意/拒绝, an optional reject note queued back into the conversation, and the paired call's raw command folded into a details expander — tool names never render.
- `DetailBody` occupies `'inbox.detail.body'` (single, session scope; owner props key off the workbench selection, never the session seat — the seat is strict-session scope and may carry a stale session while a workflow run is selected, so session-bound sections read it only when its sessionId matches the selection's session identity). Four sections: 进度 (a workflow run's journal step timeline; an agent run's or session task's business-language tail — the last three rows plus the 进行中 line while running), 子任务 (the run's lineage children), 产出物 (the settled run's parsed `output_json`), and 审批历史 (the session's `approvalHistory` projection from [`@daypaw/approval-history`](../approval-history/README.md)).

Copy rides the plugin-owned `daypaw-tasks` locale namespace (zh product copy as the key-set source of truth, plus the mechanically required en dictionary; a locales spec keeps run/session/journal wording out of both). Styling is CSS Modules over `--dsw-alias-*` semantic tokens only.

## Model Experience

### Task dialog, list, and conversation UI

#### What the model sees

Nothing on this surface is model-visible chrome. The task text the dialog submits does reach the model as the session's first user message — through the ordinary `session.prompt` wire path, logged like any other prompt; the components themselves contribute no prompt, tool, or schema.

#### Token effect

Zero live-request tokens beyond the user's own task text.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **追问 is a disabled seat** — the follow-up input renders 追问即将上线 until the follow-up ticket lands.
- **The conversation failure marker has no inline retry** — a terminal turn error renders 出错了 with no recovery affordance there; failed runs retry from the detail pane's header (ui-inbox).
- **Workflow-run selections leave session-bound sections empty** — a workflow run has no session, so under the stale-seat guard its 进度 falls back to the journal step timeline and 审批历史 renders its empty state.
