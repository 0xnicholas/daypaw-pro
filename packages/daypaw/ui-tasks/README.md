# @daypaw/ui-tasks

English | [中文](README.zh.md)

The daypaw task surfaces, a fork client UI plugin occupying the three child slots [`@daypaw/ui-inbox`](../ui-inbox/README.md) declares on its nav and workspace registrations: the new-task dialog, one inbox group's task list, and the selected task's business-language conversation view. It implements the task half of [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) — a task is the product word for a session, and this surface keeps run/session/journal vocabulary off the screen. Facts come through the connection wire face (`agentPresets.list`, `sessions.create`) and the sessions service (list projection, `open`, `binding`); the host stays the single fact source.

Three registrations in one `apply`, all pure-props components over apply-closure stores and the standard slot kits:

- `NewTaskDialog` occupies `'inbox.new-task.dialog'` (single, root; the Modal chrome stays with `InboxNav`). An agent picker over the healthy preset roster (a broken preset can never compose a task, so it is filtered, not shown; the deployment default is preselected), the task text area, and the submit row. Submit runs create → wait-for-list → open → first prompt: `sessions.open` fails loud on an unlisted id and the host's session-added frame races the create response, so the store waits for the list projection to carry the new row before opening it. Failures land inline on the dialog as generic localized copy — raw host error wording never reaches the screen; success hands the new session id to the owner's `openTask`, which navigates and dismisses.
- `TaskList` occupies `'inbox.workspace.tasks'` (single, root). It renders the owner's projected rows — title, the agent running the task, and a 最近动态 last-activity line (the owner injects the clock) — and opens a row's conversation on click. The projection itself lives in ui-inbox (`projectInboxBoard`), so the nav counts and this list share one fact source; an empty group renders the list's own 暂无任务.
- `ConversationView` occupies `'inbox.workspace.conversation'` (single, session-maybe; the current session is already the selected task, driven one-way by ui-inbox's selection). It renders `projectBusinessRows`, a whitelist projection of the assembled Chat snapshot: user messages, mid-task steering, assistant text, and a localized terminal-failure marker. Tool calls, commands, retries, metrics, and hidden nodes stay off by whitelist, not per-kind exclusion. A 进行中 status row shows while the session runs (a crash-revival pause reads as ordinary progress), and a disabled input marks the 追问 seat until its own ticket lands.

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

- **Tasks are a sessions projection, not a task engine** — groups derive from the sessions list's `blank`/`running` bits (pending is always empty); the task-source ticket replaces this with the engine's query face.
- **追问 is a disabled seat** — the follow-up input renders 追问即将上线 until the follow-up ticket lands.
- **The failure marker has no retry** — a terminal turn error renders 出错了 with no recovery affordance.
- **Approvals stay off this surface** — the business-language flow has no approval card slot; that belongs to the approval ticket.
