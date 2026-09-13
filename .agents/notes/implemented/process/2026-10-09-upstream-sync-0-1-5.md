# Agent Note: Upstream sync to 0.1.5-rc.2 — port hazards and repairs

Status: implemented

English | [中文](2026-10-09-upstream-sync-0-1-5.zh.md)

## Problem

The 2026-10-09 sync merged 1301 upstream commits (0.1.3-alpha.1 → 0.1.5-rc.2). Four port hazards do not reduce to conflict resolution: each one leaves the tree green while a runtime surface breaks, so a future sync must recognize them on sight.

## Decision

**Archived notes are rename-graft targets.** Git's rename detection merged this fork's edits to an `implemented/` note into upstream's archived (frozen) copy, changing sealed content. Any sync that sees an archived note differing from upstream restores the upstream blob; live knowledge belongs in the owning script or a fresh note, never in the frozen twin.

**The vendored front door must call `runCli()` explicitly.** Upstream's dsh bin now guards self-execution behind `import.meta.main`, so `@daypaw/cli`'s `bin.mjs` — which seeds the profile, rewrites argv, then imports the dsh bin — silently exits 0 unless it calls the exported `runCli`. A packaged-CLI smoke that exits 0 with no output is this guard, not a dead composition.

**The npm closure drifts ahead of the fork patch.** The release restores missing closure packages from the registry, so upstream's newest published runtime rides the tarball even when the fork tree pins older semantics. New upstream rows that gain service dependencies (here: `ui-deliverables` waiting on `workspaceFiles`) must gain their provider row in `packages/daypaw/web-app/cordis.patch.yml` in the same sync; upstream's own web bundle is the reference for which rows a service needs.

**Golden names follow the corpus contract.** When `SESSION_FORMAT_VERSION` advances, refreshed owner-local goldens rename with the write face (`session.v2.jsonl` → `session.v3.jsonl`); the corpus spec fails on a filename/header generation mismatch before any replay does.

Slot migrations ride the declaring packages' contracts: `conversation` → `main.conversation` (ui-conversation) and `details` → `rightbar.session` (ui-sidebar-right) under the global-main-panels rework, with the shadow registrant taking a project reference and a `import type {} from '<pkg>/client'` merge on the foreign contract.

## Alternatives considered

**Treat each hazard as one-off conflict repair.** Every one of the four left the tree green; only named hazards make the next sync recognize the failure class before re-deriving it from a silent exit.

**Exclude new upstream rows from the daypaw composition instead of adding their providers.** Excluding rows forks the web surface away from upstream bundle parity, and the exclusion list would grow every sync; mounting the provider row keeps daypaw a mirror of the upstream bundle's row set.

## Consequences

Sync verification must include the packaged-CLI smoke (`CI=true pnpm run release:daypaw`), because three of the four hazards only manifest in the packaged closure or the vendored bin. The release script's documented deploy residue forces a clean `pnpm install` between local release runs. `scripts/release/daypaw.ts` owns the smoke; `docs/fork/CORE_TOUCHES.md` owns the registry rows this sync added and superseded.
