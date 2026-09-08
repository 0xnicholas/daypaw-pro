# Agent Note: the trajectory inspector tab lands the single-shell layering

Status: implemented

English | [中文](2026-09-08-daypaw-trajectory-inspector-tab.zh.md)

## Problem

Ruling [#100](https://github.com/0xnicholas/daypaw-pro/issues/100) verdict ③ fixed the dual-mode IA as single-shell layering: no global mode switch, professional surfaces expand on demand, and the trajectory event ledger gets the first seat as an inspector tab inside the conversation column (spec 05 §3, revised by #101). The fork roster had `ui-trajectory` mounted since the scaffold, but its registration targets the upstream `conversation.view` ring — a ring only the shadowed upstream ConversationRoot renders, so in the daypaw shell the ledger was mounted-but-invisible. Exposing it inside the fork's conversation seat hit two hard walls: the slot system's one-declarer-per-slot rule (an entry renders only the slots its own registration declares, and `conversation.view` is declared by ui-conversation's dormant shell entry), and the client-stack rules (a feature plugin neither runtime-imports another's values nor gains exports to unblock itself; UI crosses packages through slots only). On top of those, browser plugins had no config channel at all: a `dsh.client` row's cordis.yml config was silently dropped on the boot wire.

## Decision

The seam is an upstream config channel plus a retarget, both default-preserving:

- **Row-config channel** (`packages/client/modules` + `packages/client/web`): `WebBootEntry`/`BootPluginRow` gain an optional `config` field. A package opts in with `dsh.client.config: true` in its manifest — only then does the host half carry the loader row's cordis config over the boot wire, validating JSON serializability first (functions, symbols, `undefined`, bigints, non-finite numbers, and non-plain objects such as Map/Set fail composition loud; the wire is a JSON global). The web boot kernel passes it to `loader.create({ name, config })`, so cordis validates it against the plugin's `Config` schema and hands it to `apply`. The opt-in declaration keeps dual-face rows with host-only `!!js` configs (the fork's `connection` row reads `ctx.webRuntime`) entirely host-side, byte-for-byte as before.
- **Retarget** (`packages/client/ui-trajectory`): the client entry exports `Config` with `viewSlot` (default `'conversation.view'`) and declares config consumption; `apply` registers the ledger tab into the configured ring.
- **The fork seat** (`@daypaw/ui-tasks`): the conversation-seat registration declares the session-scoped list slot `inbox.workspace.conversation.inspector` (owner = ui-conversation's `ConvViewOwnerProps`, imported type-only), and ConversationView renders a two-tab strip — the 对话 business pane (default, unchanged) and the on-demand 检查器 pane rendering that ring. The retargeted ledger registers into it through the ordinary slot API; no cross-plugin imports, no re-declarations. The ring's owner face passes `viewRequest: null` with a real `openView` (a ring-bound request flips the pane open) and a no-op `completeViewRequest`: the fork seat originates no focus requests yet. The approval card and the follow-up seat stay mounted in both panes; a session switch resets to the business pane (pane state derived from the session identity, no effect).

The fork `cordis.patch.yml` sets the ui-trajectory row's `viewSlot` to the inspector ring key.

## Consequences

The middle column now carries the professional layer verbatim: the upstream turn-aware ledger, timing overview, and per-record inspector render inside the seat with zero reimplementation, and future upstream trajectory work rides the roster row for free. The row-config channel is a general browser capability: any client plugin can now declare config consumption and receive its row's cordis.yml config, closing the latent upstream gap where browser `Config` schemas never applied (ui-conversation's `maxConcurrentFileUploads` is the existing dormant example — still dormant upstream, since no upstream web row sets config). Three CORE_TOUCHES rows register the upstream files; all are upstream-PR candidates. Tests: upstream channel tests in modules/web (host forwarding, JSON-serializable rejection, undeclared-row exclusion, wire parse, boot apply receipt), a src-level retarget spec in ui-trajectory, unit coverage of the tab strip in ui-tasks, a roster-coexistence pin of the retargeted row, and an assembled golden (`trajectory-inspector.golden.ts`) proving the built-bundle lane end to end — the ledger's USER/ASSISTANT rows render from the fixture echo while the business pane steps aside and the chat seat stays live.

## Alternatives considered

**Fork-side re-registration of the upstream component** (require the trajectory bundle and re-register its view into the fork ring): dead on the bundle-purity gate — a disabled row never enters the module table (require throws), an enabled row's own registration already declares the `conversation.trajectory.images` child, so a second registration throws the one-declarer conflict.

**A `mountTrajectoryView(ctx, slot)` export** consumed by a fork host: violates the client export discipline (no new value exports to unblock a consumer) and the no-runtime-import rule; rejected without owner sign-off.

**Slot co-declaration** (upstream ui-slots allowing identical-spec second declarers to share render rights): the smallest fork diff but rewrites the slot core's load-time invariant, its docs, and its tests; the largest upstream arbitration cost for a fork-local need.

**A fork-reimplemented compact inspector** over the `useTrajectory` standard hook: zero upstream touch, but it rewrites exactly the layer ruling #100 decided to expose as-is, and every upstream ledger improvement becomes manual sync work.
