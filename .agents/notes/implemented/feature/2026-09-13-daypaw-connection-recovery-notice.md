# Agent Note: the connection-recovery notice enters the daypaw shell

Status: implemented

English | [中文](2026-09-13-daypaw-connection-recovery-notice.zh.md)

## Problem

Upstream hardened the browser wire's recovery loop (`ccfbbb443a`: centralized websocket recovery, the `ConnectionStateSource`/`ConnectionLoop` export face) and then surfaced it in the shell (`19b4d7f26c` + `84c7ae3398`: a connection indicator beside the dsh settings trigger). Wayfinder [#85](https://github.com/0xnicholas/daypaw-pro/issues/85) verdict ③ ruled the fork should take the indicator as a business-language port ([#93](https://github.com/0xnicholas/daypaw-pro/issues/93)): the fork's redrawn single-page settings (#59) has no equivalent surface, and after the recovery hardening a visible 「正在重连」 is real value for business users. The ticket left the placement (settings page / top of the chat stream) to implementation.

## Decision

**Placement: the workspace column top, above every selection** (`@daypaw/ui-inbox` `WorkspaceSwitch`). Both candidate placements are dominated by the column top: the notice is visible in the chat stream, on the settings page, in the group lists, and on the agents catalog alike — an outage is visible wherever the user stands. `WorkspaceSwitch` is already the fork-owned container for all five selection kinds, so the chrome lands in one owner with no new seam.

**The port reuses the upstream pill, not its shell.** `ConnectionNotice` (`packages/daypaw/ui-inbox/src/client/ConnectionNotice.tsx`) wraps the reused `ui-primitives` `ConnectionIndicator` and owns only the state derivation — disconnected/connecting pills, the click-to-reconnect command, and the two-second 「连接已恢复」 confirmation after a return from an outage (never on the first connect). Copy is daypaw business language in the `inbox` locale dictionary (网络连接已断开 / 立即重连 / 正在重连 / 连接已恢复 plus the two aria labels), so the pill follows the brand tokens like every reused primitive. The shell consumes the wire kernel through its hardened export face exactly: `WorkspaceSwitchInjected` gains `hooks.connectionState` (bound as `useConnectionState`, the `ConnectionStateSource` observable) and `reconnect` (the `ConnectionHandle` command); `apply` injects `connection.state` and `connection.reconnect()` verbatim — no package-local mirror of wire state exists.

## Consequences

A business user mid-conversation now sees transport health in product vocabulary instead of a silent stall. The `startChat` dispatcher's warn-only failure policy (its README comment anticipated 「the connection indicator already owns transport health」) now has its referenced surface.

Landing the assembled golden (`apps/daypaw-web/tests/connection-recovery.golden.ts` — offline event → outage pill → pill click → recovery confirmation → settled, through the real `ConnectionController` over the fixture transport) exposed that the **daypaw browser boot was broken at HEAD**, and not by this change: the 2026-10-09 sync missed two reconciliation items. First, upstream `11d6bd05f3` made `ui-chat`/`ui-skill`/`ui-reference` hard-wait a new `sidebarRight` service (and `api-workspace-files` wait on `resources`), but the fork's `@daypaw/web-app` roster mirror never took the provider rows — the boot assertion failed with 4 entries pending, and no CI lane runs the daypaw goldens to notice. The mirror now carries `resources` + `ui-sidebar-right` (the latter as service host and `'rightbar.session'` declarer; the fork's `TaskDetail` shadows its occupant at priority -1, the established shadow-not-remove pattern; the document/file tabs stay deliberate fork trims). Second, ui-inbox's shadowed-seat registrations were direct `slots.register` calls gated only on the `layout` service, but `'main.conversation'`/`'rightbar.session'` are declared by ui-conversation/ui-sidebar-right whose fiber activation is unordered against that gate — the code's own comment already promised 「registrations depend on each seat through `slots.inject()`」, and the registrations now do. The `'sidebar'` seat keeps its direct register (ui-layout declares it in the same effect that provides `layout`, so the absent-frame failure stays loud). Both fixes are registered in [docs/fork/CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md); the `task-progress` golden's stale `detailsCol` class lookup rolled to the upstream-renamed `rightbarCol` with byte-identical expected outputs.

## Alternatives considered

**Placement on the settings page**: rejected — the page is open exactly when the user is configuring, not when a conversation stalls; the indicator's value peaks in the chat stream, and the column top covers both.

**A fork-drawn pill**: rejected — `ui-primitives`' `ConnectionIndicator` is presentation-only (labels as props), already synced, and token-driven; owning a second pill implementation duplicates a reused-kernel surface for zero product vocabulary gain (the copy, not the pixels, is the business-language part).

**A package-local connection-state mirror (a store republishing `connection.state`)**: rejected — the hardened export face is an observable already; copying it would add a second source of transport truth behind the renderer boundary for no consumer benefit.

**Registering the roster gap as its own ticket without fixing it here**: rejected — the golden lane is this change's pinned verification surface and the served product fails the same boot assertion; the two rows are mechanical composition mirroring (upstream's web bundle carries both), not a product intake decision, so they ride this ticket's enabling fix with their own CORE_TOUCHES entry.
