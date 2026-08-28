# Agent Note: 2026-08-28 upstream sync — the architecture-rewrite window

Status: implemented

English | [中文](2026-08-28-upstream-sync-architecture-rewrite-window.zh.md)

## Problem

Completing the 2026-08-18 → 2026-08-28 upstream sync (`daypaw-sync/2026-08-28`, upstream `deepseek-ai/deepseek-harness@cd5ef81481`) landed in the middle of upstream's client architecture rewrite: the apiproxy package retired entirely (Typert migration complete), `dsh-client-runtime` split, top-level `examples/` retired, and the interaction model rewritten from mux/rpcId to Remote Event waterfalls plus declaration-merged StandardProps. The fork's shell line (#54–#62) was built on the old architecture, so 49 conflicted files, ~100 test type errors, and 5 assembled-snapshot files all needed porting, not merging.

## Decision

- **Dependency surface**: apiproxy → `dsh-api-{session,settings,workspace}-controller`; `dsh-client-runtime` → `dsh-client-store` + `dsh-api-session-controller` + `dsh-client-ui-session`; `dsh-client-web-react` → `dsh-client-ui-renderer`/`dsh-client-test-runtime`; `dsh-acp-snapshot` → `dsh-session-snapshot`; all 32 `dsh-client-runtime/client` imports remapped.
- **Fork UI shell port** (every #54–#62 code surface): `ctx.slots` → ui-renderer; session standard kit → `useChat`/`useSession`/`useSessionPendingInteraction` (declaration merges); pending approvals → ui-approval's `PendingApproval` class (`answer()` channel); `IApiClient` → `ctx.remote` namespaces (with subpath injects); `host.describe` → `session/modelCatalog`; `agentPreset` row field retired; conversation seat session-maybe → session scope.
- **fixture.ts rewrite**: upstream's mux model → Remote Event waterfall model; the fork's `durable/*` endpoints, approval-history projection, and turn-75 pairing replayed on the new architecture (`fixture-durable.client.spec.ts` now drives the control stream).
- **web-app roster**: removed storage family/session-projection-cache/client-runtime/api-gateway; added session-reference/file-reference-local/subagent-model-selection-settings/the three controllers/ui-renderer/ui-session/ui-approval/ui-chat.
- **skeleton move**: `examples/daypaw-skeleton` → `packages/examples/daypaw-skeleton` (upstream's new examples home), with `src/index.ts` (`createSkeletonWorkflow` factory), invariant companion, and tsdown build inclusion.
- **Assembled-snapshot harness rewrite**: `apps/daypaw-web/tests/assembled-boot.ts` mirrors the new upstream protocol (WebBootGraph + bootInjections + bootstrap batch), PLUGINS derived from the bundle patches; 5 goldens refreshed.
- **Docs**: doc-sync fully green (2026-08-28 pairing rules tightened — 687 zh notes got switcher/link alignment, fork corpus excluded via manifest, generated-doc zh synced, AGENTS budget 1975→1990).
- **Hygiene**: rescope-vendor dropped 6 upstream-absorbed EXACT_EDITS and added inspector exemptions; verify-application-entrypoints registers the fork CLI exception; skeleton and fork README frontmatter brought fully compliant.

## Alternatives considered

- **分批小步 sync**：上游该窗口的破坏面（client 架构重写）无法拆分——单次 merge 必然整体面对；分批只会把移植工作摊到多轮且每轮都红。
- **冻结上游基线**（ADR 0001 已否决）：与「保持 merge 可能性」矛盾，且吃不到 dev-preview 的密集修复。

## Consequences

- The fork UI shell now rides the new upstream client architecture; future syncs in this area are incremental rather than porting-scale.
- The #64 `ensureSymlink` core touch dissolved (upstream rewrote the heal surface; the fork consumes the public `healProfilesModuleFallback`).
- Known environmental baseline red (not sync-introduced): `packages/session/session-projection-cache/tests/cache.spec.ts` disposal case fails under node 26 (reproduced on a clean upstream worktree; CI runs node 24).
- Follow-ups: generated-doc zh updates continue via the standard bilingual workflow (`dsh-translate-docs` requires explicit invocation).
