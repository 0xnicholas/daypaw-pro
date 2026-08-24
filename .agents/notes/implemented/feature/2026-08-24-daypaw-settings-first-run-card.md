# Agent Note: daypaw settings single page and the first-run API-key card

Status: implemented

English | [中文](2026-08-24-daypaw-settings-first-run-card.zh.md)

## Problem

Issue #59 turns the [shell IA skeleton](2026-08-24-daypaw-shell-ia-skeleton.md)'s 设置 placeholder into the real settings surface (通用/凭据/模型/关于) and adds the first-run yellow card that sends a keyless deployment to it. The fork layer's constraint — upstream `packages/client/` stays untouched — ruled out extending ui-settings-general in place, and the work had to answer: where the page and banner register when ui-inbox owns the middle column, how the dormant upstream `ui-settings-models` section wakes without its upstream declarer (`ui-settings-general`'s sidebar occupant) in the composition, what the banner's completion ledger is, and how the composer block is wired while the fork shell has no conversation column.

## Decision

A new fork client UI plugin `packages/daypaw/ui-settings` (`@daypaw/ui-settings`, private, 0.0.0), plus two child slots declared on ui-inbox's workspace registration (`packages/daypaw/ui-inbox/src/client/contract.ts`):

- **Fork-owned slot layering** — `WorkspaceSwitch` declares `'inbox.workspace.banner'` (list, session-maybe) atop every group container and `'inbox.settings.page'` (single, session-maybe) as the 设置 selection's content, with the owner's placeholder page as the empty-slot fallback. ui-settings occupies both through `ctx.slots.inject`, so activation order relative to ui-inbox is unconstrained (the [slot-declaration injection](../architecture/2026-08-05-slot-declaration-injection.md) path the skeleton note deferred to same-composition occupants; a cross-package occupant is exactly its case).
- **The settings page re-declares the upstream `'settings.section'` slot** (root scope) on its own entry and renders it with `only: 'models'`, waking ui-settings-models' section without ui-settings-general. The credentials tab duplicates the conventional-reference derivation (`deriveKeyRef`) and the error-message helper from ui-settings-models because the client bundle purity gate forbids a cross-plugin value import; both one-liners are rewritten in `provider-keys.ts` (named so because the tooling sensitive-file guard blocks paths containing "credential") and asserted by this package's tests.
- **The banner IS the completion ledger** — `ApiKeyCardStore` joins the default agent preset's display name (id fallback, `Agent` when none), the host's provider (`deepseek` fallback), and the credential state of the derived reference; configured state dismisses the card with no persisted flag, and pushed `credentials/updated` / `connection/reset` invalidations re-run the check unconditionally while the settings tabs refresh only once loaded. The card renders null while the check is undecided (loading or failed) — an unverifiable key must not paint a false alarm.
- **The composer block is lazy wiring** — while visible with a current session the card raises a localized block through `ctx.get('conversation')?.blocks.set`; the fork shell has no composer yet, so the service is an optional `ctx.get` and the effect is a no-op seat until the conversation column ticket lands.
- **One apply-closure `SettingsTabController`** shares the active tab between the page (reads) and the banner (presets 凭据 before navigating), following the skeleton's inject `hooks` compartment pattern. Copy rides the plugin-owned `daypaw-settings` locale namespace (zh as the key-set source of truth, en mirror); styling is CSS Modules over `--dsw-alias-*` tokens.

Tests follow the [GUI testing system](../process/2026-07-20-gui-testing-system.md)'s zero-machinery path: store specs over a programmable wire fake (joins, write-through reloads, latest-wins generations), jsdom component specs with real controllers and `bindSnapshotSelector` (tab rail, inline editor flows, clipboard diagnostics, banner visibility and the block seat), a `toMatchSnapshot` for the yellow card, and an apply spec over a real `SlotRegistry` + `LocaleRuntime` + `TestRemote` pinning occupancy, the child-slot declaration, pushed invalidations, and teardown. Package src sits at per-file 100% coverage. New core touches (tsconfig.base.json `@daypaw/*/client` paths mapping, web-app tsconfig/knip rows) are registered in [CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md).

## Alternatives considered

- **Extend ui-inbox with the settings UI instead of a second package (option B)** — rejected: the settings surface has its own wire domains (credentials/llm/host/presets), invalidation subscriptions, and store fleet that the inbox workbench never touches; one package would have fused two unrelated inject sets and put the first-run card's lifecycle inside the navigation plugin. The child-slot seam keeps ui-inbox a pure IA skeleton and lets the settings surface evolve (and be replaced) independently.
- **Persist a dismissed/completed flag for the banner** — rejected: the credential state already is the ledger; a flag would fork the truth (dismissed-but-still-keyless must re-block input on the next session anyway) and add a settings write path for zero behavioral gain.
- **Register the banner into the upstream `'settings.onboarding'` slot** — rejected: that slot's render context lives inside ui-settings-general's sidebar occupant, which the fork composition never mounts; the slot would stay dormant. The ui-inbox banner strip is the fork-visible carrier of the same onboarding-ledger mechanics.

## Consequences

A keyless daypaw deployment boots with the yellow card atop the workspace, one click lands on the 凭据 tab, and saving a key dismisses the card on the pushed invalidation with no reload. The settings page unifies locale switching, per-provider key management, the upstream models section, and host diagnostics in the middle column. Costs: two restated one-liner helpers drift from ui-settings-models until the purity gate or a shared kernel admits them; the banner check trusts the conventional-reference convention (a provider whose key reference is unconventional is misread); and the composer block is inert until the conversation column exists.

## Deferred

Theme/density sections, the composer block's live effect (conversation column ticket), and any reuse of the restated helpers are later-ticket scope, mirrored in the package README's Known Limitations. The assembled-web snapshot harness: [daypaw task conversation](2026-08-24-daypaw-task-conversation.md).
