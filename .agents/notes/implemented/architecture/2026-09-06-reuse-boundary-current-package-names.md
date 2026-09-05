# Agent Note: fork reuse-boundary records speak current upstream package names

Status: implemented

English | [中文](2026-09-06-reuse-boundary-current-package-names.zh.md)

## Problem

The upstream 2026-08-28 sync carried a client-stack reorganization: `packages/client/runtime` split into `store` (store contract), `ui-conversation` (session domain layer: registries/assembler/contract), and `ui-chat` (chat model layer: partial nodes, steering history, tool-call tree); `render-service` became `ui-renderer` (absorbing `runtime`'s `slots.ts`); `web-react` merged into `ui-renderer` (`cf5e686408`); `schema-form` merged into `ui-settings` (`56dff07c4e`); and the old `ui-conversation` chat presentation moved wholesale into the new `ui-chat`, freeing the name for the domain layer. The fork's reuse-boundary records predate this: spec 05 §4 listed the wholesale-reuse cluster with `runtime`/`web-react`/`schema-form` and the rewrite cluster led with the old `ui-conversation`, while `docs/fork/CORE_TOUCHES.md` names only `connection` and `ui-theme` (both current). Reading either record against the current tree mixed eras — the same name `ui-conversation` denoted a rewrite target in one list and a reused package in the current roster, and the alias block of `apps/daypaw-web/vite.config.ts` still pointed `@deepseek-ai/dsh-client-schema-form` at a directory the sync deleted (a second row, `dsh-client-ui-attachment`, outlived the platform-module table entry that once consumed it).

## Decision

Per wayfinder [#80](https://github.com/0xnicholas/daypaw-pro/issues/80) adjudication 4, the records use the current package names only ([#89](https://github.com/0xnicholas/daypaw-pro/issues/89)):

- Spec 05 §4's wholesale-reuse cluster is the 14 current packages — connection, locale, modules, web, ui-slots, ui-settings, ui-theme, ui-primitives, ui-attachment, hmr, plus store, ui-conversation, ui-chat, ui-renderer — with the pre-reorg name mapping stated once at the cluster header; cluster membership totals 40 (14 + 15 + 11) over 39 distinct packages, ui-chat straddling both the reuse and rewrite clusters.
- The rewrite cluster's chat-presentation member is `ui-chat`, and its rewrite scope is only the chat presentation the old `ui-conversation` contributed; ui-chat's model and assembly-fed-data layers stay wholesale-reused (the fork roster ships ui-chat whole and `@daypaw/ui-tasks` draws the business-language view over it). The feeding sentence names `ui-conversation`'s ConversationNode assembler, the home of the former `runtime` assembler (`ui-conversation/src/client/conversation/assembler.ts`, consumed by `@daypaw/ui-tasks`).
- The two stale vite alias rows are deleted; nothing in the bundled shell graph (`apps/daypaw-web/src` + the aliased `packages/client/web/src` chain) imports either specifier, so the rows were inert.

Pre-reorg names remain only in dated research records (`docs/research/2026-09-02-upstream-drift-client-stack.md` §0 owns the rename evidence with SHAs) and in the spec's one bridging sentence, which needs the old names to keep the [#36](https://github.com/0xnicholas/daypaw-pro/issues/36)/[#37](https://github.com/0xnicholas/daypaw-pro/issues/37) provenance readable.

## Alternatives considered

- **Keep the adjudication text verbatim as a historical record** — rejected: spec 05 is current-state prose; a boundary list whose package names no longer resolve on the tree fails every future reader and grep.
- **Re-adjudicate the boundary while migrating** — rejected: wayfinder #80 adjudication 1 kept every cluster verdict ("存量边界全簇维持"); the dual listing of ui-chat (wholesale-reused layers + rewritten presentation) is the faithful current-name reading of that verdict, not a new decision.
- **Leave the inert vite alias rows** — rejected: the `schema-form` row's target directory no longer exists; dead config that names vanished packages is the same old/new mixing the migration removes.

## Consequences

Cluster membership, counts, and feeding statements in spec 05 §4 resolve against the current tree; `web-runtime` in §4's route-B line is untouched (it names the `bundle/web-app` glue plugin row, not a client package). Cost: the spec now carries one sentence of pre-reorg vocabulary so the old #36/#37 records stay derivable, and the next sync's CORE_TOUCHES replay must remember that "13 整包复用" in closed issues means the current 14. Bought: no current-state fork document names a client package that the upstream tree cannot resolve, and the alias block again lists only specifiers the shell graph imports.

## Verification

`grep` over `docs/spec/`, `docs/adr/`, `docs/fork/`, and `CONTEXT.md` finds no `runtime`/`render-service`/`web-react`/`schema-form` client-package mention outside the spec's bridging sentence (`web-runtime` excluded as the plugin-row id); `docs/fork/CORE_TOUCHES.md` names only `packages/client/connection` and `packages/client/ui-theme`. The frontend build (`pnpm --filter @daypaw/web-frontend run build`) passes with the alias rows removed.
