# Agent Note: daypaw product-shell scaffold — route-B frontend and glue bundle

Status: implemented

English | [中文](2026-08-23-daypaw-product-shell-scaffold.zh.md)

## Problem

[Spec ch.5](../../../../docs/spec/05-product-shell.md) §4 ruled route B for the product shell: the fork hosts its own built frontend dist through its own glue bundle, mirroring the upstream `apps/web` + `packages/bundle/web-app` pair. The open implementation question was exactly how much of the upstream pair the scaffold carries — a full copy drags the developer-facing browser roster into the product shell, while a trimmed copy breaks the composition before the board epics (#56–#60) that own roster removal exist.

## Decision

Two new workspace packages land as fork carriers:

- **`apps/daypaw-web` (`@daypaw/web-frontend`)** — a private vite entry mirroring `apps/web`: same aliases, chunking, and `window.__DSH_BOOT__` rejection, with fork identity only (package name/repository, `daypaw` title and manifest, daypaw-context standalone-serve error). The upstream e2e/stress lanes are not copied; they stay upstream-owned.
- **`packages/daypaw/web-app` (`@daypaw/web-app`)** — a private glue bundle mirroring `packages/bundle/web-app`. Three of the four diffs spec §4 rules land as written: `resolveDistIndex()` resolves `@daypaw/web-frontend/dist/index.html`; `webSurfacePrompt()` speaks daypaw context (and states no rebuild watcher is wired for this shell); the URL line prints `daypaw web:`. The fourth — the `DAYPAW_WEB_URL` rename — is **deferred**: managed shell variables live in the reserved `DSH_*` namespace (`shell-env` rejects other prefixes at registration and `dsh-subprocess` strips ambient `DSH_*` from child environments), so the rename cannot pass that registry without widening an upstream contract; `DSH_WEB_URL` stands meanwhile (package README, Known Limitations). Observable keys the two bundles never live-load together with keep upstream values: plugin names `web-app`/`web-startup`/`web-app-invariant`, prompt section `app:web-surface`, shellEnv registration `web-runtime`, services `webStartup`/`webRuntime`.
- **Roster placeholder ruling** — the fork `cordis.patch.yml` keeps the upstream browser roster as placeholders so the composition boots end to end; the ui-sidebar row has since been replaced by the fork's `ui-inbox` (issue #55, [shell IA skeleton](../feature/2026-08-24-daypaw-shell-ia-skeleton.md)), and removing the remaining rows the shell does not ship and swapping in rewritten ones stays scoped to the board epics (#56–#60), with `DAYPAW_PROFILE_BUNDLES` untouched until the profile wiring epics (#61/#62).

Shared upstream files take additive edits only, each registered in [CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md): the `apps/daypaw-*` release-member exclusion in `scripts/check-workspace-constraints.ts`, one `@daypaw/web-app/startup` paths entry in `tsconfig.base.json`, one references row in each aggregate, the `build:web` extension, and two knip workspace entries.

Duplication handling: the jscpd gate scans `packages` and `scripts` only, so `apps/daypaw-web` needs no exemption; the three glue sources are deliberate mirrors and carry `jscpd:ignore-start/end` blocks with the fork-carrier reason, following the `packages/daypaw/*/src/invariant.ts` precedent. The pre-existing red baseline (the `app-boot/profile.ts` vs `daypaw/cli/index.ts` clone recorded by #47) is unchanged by this work.

## Alternatives considered

- **Trim the roster at scaffold time** — rejected: removals are the board epics' own decisions (#56–#60); cutting rows here would both preempt those rulings and leave the scaffold unbootable where upstream rows interdepend.
- **Rename the observable keys** (plugin names, prompt section, shellEnv registration) — rejected: the two bundles never load in one composition, so the keys cannot collide, and renaming buys nothing while costing drift from the upstream glue the fork tracks.
- **Wrap only the identical stretches in jscpd ignores** — rejected: the four diffs sit inside the mirrored bodies, so partial blocks would fragment into per-function exemptions; a whole-file block with the carrier reason names the relationship once, matching the existing daypaw invariant companions.

## Consequences

- `pnpm run build` now also emits `apps/daypaw-web/dist`, and the glue resolves it through package exports; the three mirrored specs (startup provider over a real Loader tree, LAN-trust sampling, runtime glue) run green with per-file coverage on the new package.
- The fork web surface is not yet reachable from the `daypaw` CLI: profile wiring (`DAYPAW_PROFILE_BUNDLES`) belongs to #61/#62, so the shell boots only when a composition mounts `@daypaw/web-app` explicitly.
- Every future upstream sync replays the four-point diff against `packages/bundle/web-app`; the fork carrier must re-apply them when the upstream glue moves.
