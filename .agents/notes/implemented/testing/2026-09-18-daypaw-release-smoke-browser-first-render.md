# Agent Note: The release smoke executes the served shell in a browser

Status: implemented

English | [中文](2026-09-18-daypaw-release-smoke-browser-first-render.zh.md)

## Problem

The served shell's browser build never executed anywhere. The assembled goldens (the required `daypaw-web-goldens` gate) boot the tsdown `lib/client.js` artifacts in jsdom; the vite composition in `apps/daypaw-web/vite.config.ts` — source-plane aliases, the `node:module` stub, the `process.versions.node: "0.0.0"` define, vendor chunking — was validated only as HTML text: the cli smoke's dist probe was `body.includes('daypaw')` over a fetch. Playwright was installed only for the upstream shell's advisory, main-only browser replay. A browserization break that kills the served render reddens this lane. ([#121](https://github.com/0xnicholas/daypaw-pro/issues/121), architecture review two candidate ②).

## Decision

- **Vehicle: a headless-browser first-render wait inside the release cli smoke** (`scripts/release/daypaw.ts`, `browserFirstRender`). `Release (daypaw)` is the fork's only PR-triggered executable lane that assembles the real product — tarball, clean global install, real boot, token exchange, served dist — so it is the only vehicle whose red lands on the breaking PR; the required aggregate and the advisory job both run on main pushes only ([lane split](2026-08-30-coverage-gate-main-ci-lane.md)).
- **Marker: the first-run API-key banner's interpolated roster name** (`通用助手`, the seeded starter's display title). The card renders null while its checks are undecided, and its name arrives only through `durable/listDefinitions` answering with the starter, so the marker proves the full served chain — dist module graph executing, boot graph assembling, connection opening, engine roster, credential check deciding visibility. A blank or disconnected page cannot show it; the interpolation rides every locale's copy, so the wait is language-robust.
- **The browser walks the token exchange itself** (goto the printed launch URL, assert it lands on the bare origin); the manual fetch probe pins the 303-plus-cookie wire response fields with precise failure text — the two assert different facts.
- **Single attempt, generous budgets**: the probe timeout rises to 120 s (cold Chromium loading the dist over loopback) and the marker wait is 60 s; no retry machinery until a flake is observed — loopback page loads are the stable class of browser test, and retry-on-spec would mask real signal.
- **Playwright becomes a root devDependency**, imported dynamically only on the smoke path (the SDK smoke and `--skip-smoke` runs never load it); the workflow installs Chromium with the same plain `pnpm exec playwright install chromium` shape as CI (daypaw main).

## Verification

- Clean tree: the full pipeline is green and the smoke log carries `browser first render`.
- The marker wait (`getByText('通用助手')`) rejects a build whose `process.versions.node` define is absent, while the vite build still succeeds.
- The `node:module` alias is not render-load-bearing: the bundler soft-externalizes node builtins, and `ModuleLoader.fromInternal()` returns under the `"0.0.0"` define. The gate's contract is "any browserization break that kills the served render reddens the PR", not "each named composition line is load-bearing".

## Alternatives considered

**A jsdom lane over the real dist** — rejected: the vite dist is a plain ESM graph with `<script type="module">` and relative chunk imports; jsdom executes neither, so the lane means a hand-rolled ESM loader (the assembled-boot ModuleLoader path does not apply to the vite index chunk), and the required aggregate runs main-only, so the breaking PR would stay green anyway.

**An advisory-lane extension** — rejected: Playwright is already installed in the advisory job, but advisory lanes report without gating, and a seam breakable by one define typo wants a blocking owner.

**A second vehicle alongside** — rejected: one seam, one owner — the mirror-law discipline; a jsdom dist lane would be a second declaration of the same execution fact.

## Consequences

- Every PR and main push executes the served vite dist in a real browser inside `Release (daypaw)`; the lane gains roughly one to two minutes of Chromium install and the smoke's probe budget rises to 120 s.
- The complementary faces around the served shell now close: roster resolution gate = coverage, assembled golden gate = activation, release closure smoke = dependency closure, release browser boot = execution ([ADR 0019](../../../../docs/adr/0019-freeze-posture.md) §5).
- Residual: the fork product shell has no real-browser product-flow replay (the upstream `apps/web` e2e equivalent for fork flows); map fog, trigger = the first real-browser-only product break or the first flow jsdom goldens cannot express.
- The marker holds the starter's business name (`通用助手`), so the seeded starter's display title and the banner chain must keep that value; the timeout error names both the marker and the wait.
