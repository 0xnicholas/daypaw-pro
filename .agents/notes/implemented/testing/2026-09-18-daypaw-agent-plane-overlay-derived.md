# Agent Note: The agent-plane spec derives its web-transport-off overlay from the roster

Status: implemented

English | [中文](2026-09-18-daypaw-agent-plane-overlay-derived.zh.md)

## Problem

`tests/agent-plane.spec.ts` boots the daypaw surface's real bundle composition headless by writing a `cordis.patch.yml` overlay that disables the web-transport rows — but the overlay's `disabled` rows are a roster fact: a composed row rides the web plane when its package declares a browser half (`dsh.client`), the same key the roster mirror gate compares on. A literal `disabled` set makes each upstream browser-roster growth a spec edit: the 2026-09-13 sync's `ui-deliverables` row is the recorded instance, registered in `docs/fork/CORE_TOUCHES.md` as a recurring sync-coupled edit to a fork file ([#122](https://github.com/0xnicholas/daypaw-pro/issues/122), architecture review two candidate ③).

## Decision

The overlay file stays — a pure host-plane composition needs a finite domain, and the profile's patch order applies it last — but its content is derived at boot time inside the spec, from the two inputs below:

- **Roster**: `composeEntries(profile.layers.map(layer => layer.patches))` — the exact entry list the spec boots, not a second reading of patch files.
- **Browser halves**: a workspace-manifest scan for `dsh.client` (the mirror gate's existing pattern), so a composed row is disabled when its package declares a browser half.

Two literal edges remain, each entry carrying its reason in the spec:

- `HOST_TRANSPORT_OFF` — `directory-picker`, `web-startup`, `webserver`, `web-runtime`: the transport itself, mounted from host-only packages with no browser half to key the derivation off.
- `HOST_PLANE_KEEP` — `typert`: `dsh-typert-registry` declares a browser half, but its node half is the in-process type-graph registry that `typert-loader` (a host row) waits on. `typert` stays enabled because `typert-loader` (a host row) waits on that registry; the all-browser-halves derivation would stall `typert-loader` and `boot`'s activation assertion fails loud naming the waiting row, so a browser-half row whose node half serves the host plane needs a reasoned keep entry, not a silent mirror chase.

A stale literal id (a sync renaming a remainder or keep row) fails the spec's mounted-rows test instead of disabling nothing. The reverse-case test simulates a roster growth that adds a `dsh.client` browser-half row — a fixture workspace manifest declaring `dsh.client` plus the mirrored roster row — and asserts the derived overlay absorbs it with no edit to the spec.

## Verification

The five executed agent-plane facts (bare-agent tool catalog, no-ask in-workspace write, approve, waiting state, closed rejection) pass unchanged under the derived composition, pinning that the pure host plane keeps its semantics; the two derivation tests pin the absorption and the literal edges.

## Alternatives considered

**Keep the literal and chase it at each sync**: rejected — the fact has one home (the roster plus the manifests); the chase had already happened once and the mirror gate only guarantees the fork patch mirrors the growth, not the spec.

**Extend the roster mirror gate to also validate the spec's literal**: rejected — a gate over two copies of one fact catches the drift late (at gate time) instead of removing it; the red is the same chase with a different reporter.

**Leave the transport rows enabled and let them wait**: rejected — `boot`'s `assertEntriesActivated` fails when entries stay pending, and the enabled `webserver` would bind a real server inside the test.

**Disable the whole web-app patch layer, keeping only the base bundle**: rejected — the fork patch carries host rows the agent plane composes (`tool-ask-user`, the `tool-str-replace-editor` remount, `approval-history`, `session-turn-outline`); wholesale off changes the composition under test.

## Consequences

Upstream browser-roster growth flows through the derivation with no edit to the spec, and the CORE_TOUCHES row for this file is dissolved, so the sync ritual includes no edit here. The derived disabled set covers every browser-half row (e.g. `resources`, `ui-sidebar-right`, `workspace-files`), which on the pure host plane prunes browser-facing service chains (`resources` → `sidebarRight` → `ui-chat`) coherently instead of leaving them mounted unused; the executed facts own the proof that the agent plane is unchanged. What the derivation buys is the failure class it deleted: roster growth is absorbed silently, and the only remaining sync-sensitive edge (a browser-half row whose node half serves the host plane) fails the boot assertion with the waiting row named.
