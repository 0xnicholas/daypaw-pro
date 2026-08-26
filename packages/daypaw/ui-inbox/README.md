# @daypaw/ui-inbox

English | [中文](README.zh.md)

The daypaw shell IA skeleton (inbox workbench), a fork client UI plugin in the shape of upstream [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.md). It implements the three-column IA of [docs/spec/05-product-shell.md §3](../../../docs/spec/05-product-shell.md) over the wholesale-reused [`ui-layout`](../../client/ui-layout/README.md) frame, with presentation-layer vocabulary only (任务/新任务/等待你确认/进行中/已完成/设置/任务详情 — engine words never appear in the copy). Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

Three registrations in one `apply`, all pure-props components with zero ctx:

- `InboxNav` occupies `'sidebar'` (root scope), replacing the upstream ui-sidebar roster row in [`@daypaw/web-app`](../web-app/cordis.patch.yml). Expanded: the wordmark, the big primary 「+ 新任务」 button (opening a Modal whose body is delegated to the `'inbox.new-task.dialog'` child hole — occupied by [`@daypaw/ui-tasks`](../ui-tasks/README.md), stub copy while absent), the three inbox groups 等待你确认/进行中/已完成 with live counts projected from the hybrid board feed (run ledger ∪ sessions list), and the Agents/设置 secondary nav pinned at the foot. Collapsed: the compact control rail (sidebar toggle + new-task icon button) the `'sidebar'` occupant contract requires.
- `WorkspaceSwitch` occupies `'conversation'` (session-maybe scope) at priority -1, shadowing ui-conversation's priority-0 placeholder occupant while its declared seats stay live for the dormant ecosystem. It switches the middle column by selection: an inbox group's container (its task list rendered by the `'inbox.workspace.tasks'` occupant from the owner's projected rows, empty state as the no-occupant fallback), one task's conversation rendered by the `'inbox.workspace.conversation'` occupant, the Agents catalog rendered by the `'inbox.agents.page'` occupant ([`@daypaw/ui-agents`](../ui-agents/README.md)), or the 设置 page. The remaining child holes: `'inbox.workspace.banner'` (list, session-maybe) renders atop every group container for first-run and workspace-level notices, and `'inbox.settings.page'` (single, session-maybe) carries the settings surface — occupied by [`@daypaw/ui-settings`](../ui-settings/README.md), with the owner's placeholder page as the empty-slot fallback.
- `TaskDetail` occupies `'details'` (session scope) at the same shadowing priority: the selected task's detail container. Content keys off the workbench selection, never the session seat — the slot is strict-session scope and may carry a stale session while a session-less workflow run is selected. A run selection renders the header (run title, strict status copy, and the 「重试」 button on failed runs) and delegates the body to the `'inbox.detail.body'` child hole (occupied by [`@daypaw/ui-tasks`](../ui-tasks/README.md)); anything else falls back to the empty state (「选择任务查看详情」).

Shared selection state (`{ kind: 'group', group } | { kind: 'task', sessionId } | { kind: 'run', runId } | { kind: 'agents' } | { kind: 'settings' }`, default the 进行中 group) crosses the three slot scopes through one apply-closure `InboxSelectionController`: a store handle cannot mount under two scopes, so the bare snapshot source travels in each register call's inject `hooks` compartment and the renderer binds it as each component's `useSelection` hook. Task selection also drives the runtime current session one-way through `ctx.sessions.open`, so the session-maybe conversation seat resolves the selected task; a run selection opens no session. Task rows and group counts share one projection (`projectInboxBoard`) over the hybrid feed — top-level durable runs ∪ run-less sessions, an agent run claiming its session twin (its runId IS the session identity), a blank session staying a draft. The ledger side comes from an apply-closure `RunsBoardStore` polling the gateway's `durable/listRuns` Remote endpoint every `RUNS_BOARD_POLL_MS` (2 s — a product constant, since WebBootEntry carries no per-plugin config channel), with every wire field validated at the boundary in `runs-api.ts`; a `TaskDetailStore` loads the selected run's lineage and journal timeline (`durable/runLineage` + `durable/journalTimeline`), and the retry dispatcher calls `durable/rerun` then kicks the board. The five run statuses share one copy home (`task-status.ts`) across nav counts, list rows, and the detail header. The new-task dialog's open state is component-local. Copy rides the typed `t` seat of the plugin-owned `inbox` locale namespace (zh product copy plus the mechanically required en dictionary). Styling is CSS Modules over `--dsw-alias-*` semantic tokens only.

## Model Experience

### Inbox workbench UI

#### What the model sees

Nothing. This package renders task-facing UI only; `InboxNav`, `WorkspaceSwitch`, and `TaskDetail` contribute no prompt, tool, or schema, and nothing here reaches a model request.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The board polls; nothing pushes** — the browser refreshes the run ledger every 2 s (`RUNS_BOARD_POLL_MS` is a product constant: the WebBootEntry boot graph carries no per-plugin config channel). Spec §5's host-poll + mux-projection design waits for a cross-session projection channel — session projections are strictly per-session and cannot carry the cross-run board.
- **等待你确认 keys on the session approval badge** — a row enters the group when its runtime session summary carries `pendingInteraction: 'approval'` (mux replay restores it on every open), so a question-shadowed approval stays off the count and a session-less workflow run can never badge (a run-scoped approval channel does not exist yet).
- **Upstream conversation/details occupants are shadowed, not removed** — ui-conversation's roster row stays mounted (its declared seats serve the dormant placeholder ecosystem); this package wins both cells at priority -1, and removing the upstream row is a later board decision.
