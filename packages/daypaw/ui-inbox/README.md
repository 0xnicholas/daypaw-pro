# @daypaw/ui-inbox

English | [中文](README.zh.md)

The daypaw shell IA skeleton (inbox workbench), a fork client UI plugin in the shape of upstream [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.md). It implements the three-column IA of [docs/spec/05-product-shell.md §3](../../../docs/spec/05-product-shell.md) over the wholesale-reused [`ui-layout`](../../client/ui-layout/README.md) frame, with presentation-layer vocabulary only (任务/新任务/等待你确认/进行中/已完成/设置/任务详情 — engine words never appear in the copy). Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

Three registrations in one `apply`, all pure-props components with zero ctx:

- `InboxNav` occupies `'sidebar'` (root scope), replacing the upstream ui-sidebar roster row in [`@daypaw/web-app`](../web-app/cordis.patch.yml). Expanded: the wordmark, the big primary 「+ 新任务」 button (opening a minimal closable dialog stub), the three inbox groups 等待你确认/进行中/已完成 with count slots, and the Agents/设置 secondary nav pinned at the foot. Collapsed: the compact control rail (sidebar toggle + new-task icon button) the `'sidebar'` occupant contract requires.
- `WorkspaceSwitch` occupies `'conversation'` (session-maybe scope) at priority -1, shadowing ui-conversation's priority-0 placeholder occupant while its declared seats stay live for the dormant ecosystem. It switches the middle column by selection: an inbox group's task container (empty state), the Agents placeholder page, or the 设置 placeholder page.
- `TaskDetail` occupies `'details'` (session scope) at the same shadowing priority: the selected-task detail container as an empty-state placeholder (「选择任务查看详情」).

Shared selection state (`{ kind: 'group', group } | { kind: 'agents' } | { kind: 'settings' }`, default the 进行中 group) crosses the three slot scopes through one apply-closure `InboxSelectionController`: a store handle cannot mount under two scopes, so the bare snapshot source travels in each register call's inject `hooks` compartment and the renderer binds it as each component's `useSelection` hook. The new-task dialog's open state is component-local. Copy rides the typed `t` seat of the plugin-owned `inbox` locale namespace (zh product copy plus the mechanically required en dictionary). Styling is CSS Modules over `--dsw-alias-*` semantic tokens only.

## Model Experience

### Inbox workbench UI

#### What the model sees

Nothing. This package renders task-facing UI only; `InboxNav`, `WorkspaceSwitch`, and `TaskDetail` contribute no prompt, tool, or schema, and nothing here reaches a model request.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Group counts and task entries are unwired** — count slots render placeholder zeros and every group container shows its empty state; the board tickets own the run/approval data wiring.
- **The new-task dialog is a stub** — the agent-selection content belongs to the agent-catalog ticket; the dialog is a minimal closable shell.
- **The Agents and 设置 pages are placeholders** — the secondary nav switches the middle column to static placeholder containers.
- **The detail column is a placeholder** — `TaskDetail` renders only the empty state until the board tickets wire selected-task data.
- **Upstream conversation/details occupants are shadowed, not removed** — ui-conversation's roster row stays mounted (its declared seats serve the dormant placeholder ecosystem); this package wins both cells at priority -1, and removing the upstream row is a later board decision.
