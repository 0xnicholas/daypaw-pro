# Agent Note: One parameterized assembled-boot home for both web lanes

Status: implemented

English | [中文](2026-09-19-daypaw-assembled-boot-shared-scaffold.zh.md)

## Problem

`apps/daypaw-web/tests/assembled-boot.ts` (360 lines) and `apps/web/tests/assembled-boot.ts` (305 lines) were near-clones: the same bundle-map derivation, jsdom environment, and mount sequence, hand-copied at the 2026-08-28 sync and replayed by hand since. Two drifts had already landed in the fork copy — the `__DSH_TRANSPORT__` carrier transport ([ticket #90](https://github.com/0xnicholas/daypaw-pro/issues/90)) and the declaration-gated config forwarding ([ticket #105](https://github.com/0xnicholas/daypaw-pro/issues/105)) — and the fork copy also carried a dead `skipped` counter and an entry-emission form (`inject: declaration.inject ?? []`) that differed from the upstream body's conditional spreads for no behavioral reason. Upstream had touched its copy about fifteen times over May–August, so every sync risked another manual replay ([ticket #123](https://github.com/0xnicholas/daypaw-pro/issues/123)).

## Decision

One fork-local package, `@daypaw/assembled-boot`, owns the scaffold; each lane's `tests/assembled-boot.ts` is a thin entry passing lane options. The lane facts are three axes — bundle layers (base overridable, web layer required), transport assembly (a `ClientTransportHooks` carrier factory; omitted means the page self-selects the fixture transport through the `?fixture` search switch, and a carrier lane rejects that key), and the pinned document title. Config forwarding is a shared capability, not an option: a row's config reaches the graph only when its package declares `dsh.client.config`, which is a no-op for the upstream roster. The locale pin (`en-US`) is identical in both lanes — the fork copy's old header claim of a Chinese pin contradicted its own code — so it lives in the shared module; both lanes' goldens render the English dictionary. The emitted-entry form unifies to the upstream body's conditional spreads; both lanes' suites are green on the unified form, so the form difference carried no behavior.

`decorateDurableRpc` stays in `apps/daypaw-web/tests` and enters as the carrier's transport, so the shared module carries no daypaw vocabulary. The `ClientRequest`/`ServerResponse` bridge is exported as `connectionRpcCarrier` because it speaks only upstream types.

Timing: extract now rather than riding the next upstream refactor of the scaffold. The replay either way is a body swap plus re-threading the three seams; waiting only accumulates drift while fork-side work keeps evolving the consumers. Upstream has no acceptance channel ([ticket #118](https://github.com/0xnicholas/daypaw-pro/issues/118) established this), so the upstream-facing form is a shape promise, not a submission: the two core touches on upstream files are marked submittable, and the retirement trigger — upstream building its own parameterization, then swapping this home on the next sync — is recorded in the README and ADR 0015.

Coverage: the composition half is exported as testable units (`loadAssembledPlugins` / `buildBootGraph` / `buildBundleTable`), and a micro-roster fixture (one bootstrap plugin, one application plugin, plus a row matrix for every skip and the config passthrough) drives the branch matrix without booting a real roster. Mount and environment coverage runs in-package on the micro lanes under the per-file 100% gate; the two real lanes' own suites remain the end-to-end proof.

## Alternatives considered

**Wait for the next upstream refactor and extract then.** Bets that upstream rewrites the scaffold before the next replay is due; losing the bet pays the replay and keeps the drift growing. The seams are stable across a body rewrite, so riding buys almost nothing.

**Extract only the composition half, leaving env/mount glue per lane.** Keeps two copies of exactly the part upstream edits most, recreating the problem it claims to solve.

**A new subpackage under `packages/test-support/`, or a module inside an existing upstream test-support package.** The former breaks the family rule (`@daypaw/*` lives in `packages/daypaw/`) and needs a `families.ts` skip entry (itself another core touch); the latter plants fork needs inside an upstream package's source tree.

**`@daypaw/durable-client` or a `ui-*` package as the home.** Dilutes the wire-vocabulary home or drags a test scaffold into the GUI family's coverage-exemption semantics; the per-file gate is the honest posture for pure logic.

## Consequences

- Sync replay semantics changed: an upstream edit to `apps/web/tests/assembled-boot.ts` now conflicts with the stub; resolve by taking the upstream body into `src/composition.ts` / `src/index.ts`, re-threading the three option seams, and restoring the stub. Options unchanged means zero replay.
- The drift class is gone, not just this instance: a fork-only feature (the `durable/*` carrier, the config passthrough) now lands once and reaches both lanes through the options, and the dead `skipped` counter plus the divergent entry-emission form are retired.
- The package carries the per-file 100% coverage bar with the composition half exported as testable units and a micro-roster fixture driving the branch matrix, so the mode does not need a whole-roster boot to stay covered.
- Three upstream-file core touches are registered in [CORE_TOUCHES](../../../../docs/fork/CORE_TOUCHES.md): the stub rewrite, the `apps/web/tsconfig.json` reference, and the `apps/web/package.json` devDependency.

## Notes for future sessions

- The package resolves in every consumer through tsconfig paths to `src/`; its `lib/` build exists only for the workspace build layout (`clientLibrary` preset, `@deepseek-ai/*` deps declared as peers so they stay external — the `@deepseek-ai/dsh-client-test-runtime` declaration shape).
- [ADR 0015](../../../../docs/adr/0015-assembled-boot-shared-scaffold-home.md) records the decision.
