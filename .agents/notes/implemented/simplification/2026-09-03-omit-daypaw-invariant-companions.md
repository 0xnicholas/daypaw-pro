# Agent Note: Omit the daypaw invariant companions per the upstream criterion

Status: implemented

English | [中文](2026-09-03-omit-daypaw-invariant-companions.zh.md)

## Problem

Every fork-owned package published a `src/invariant.ts` companion with an empty installer explained by a comment — eleven under `packages/daypaw/` plus the `daypaw-skeleton-example`. Upstream commit `15f2997bcb` judged that shape an anti-pattern and deleted 207 explained-empty companions: a companion earns publication only when it compares observations that may independently diverge (cross-event protocols, events against authoritative state, multi-producer assembly, durable data consumed elsewhere), and service presence, plugin effects, or pure-package reasons never qualify. Wayfinder #80 ruling 2 adopted the criterion and required the fork audit before the next sync.

## Decision

- **The audit found no qualifying package, so all twelve companions are omitted.** Each package's reason moves into its README as the gate-checked omission sentence (`**Runtime invariant:** No companion is published. …`), per-package specific: `engine` is deliberately Cordis-free (no event stream to hook; the fault-injection suite asserts the state machines), `store` is data-shape only, `sdk` and `cli` own no state (the closure owns the state machines), `approval-history`'s fold is validated at the projection registry with the event relation owned by dsh-user-approval, the five `ui-*` plugins are pure presentation asserted by their own specs, `web-app`'s contributions are registry-disposed with each owning registry carrying the relation, and the skeleton demo owns no independent observations.
- **All publication wiring is removed with the source**: the `./invariant` export, `lib/invariant.js` file entry, dsh-invariants peer/dev dependency (the `@daypaw/cli` closure `dependencies` entry stays until the closure members drop their own peers), TypeScript project references, the five `ui-*` tsdown entries, the five registration specs, and the `@daypaw/*/invariant` mapping in `tsconfig.base.json`.
- **The shared gates adopt the upstream conditional shape now**: `package-invariants` accepts a companion-less package with a README reason, rejects export/publication/build wiring left behind after omission, and `verify-built-package-invariants`, the Vitest host (`test-invariants.ts`), and `check-workspace-constraints` skip absent companions. One transitional fork delta remains until the next sync: the gate still accepts explained-empty installers with the `No runtime invariant:` marker, because the pre-cleanup upstream tree in this checkpoint still publishes 208 of them; upstream's own gate version deletes that branch together with the companions. ADR 0007 §2 (companion as hard convention) and the ADR 0011 sdk-peer addendum are amended accordingly, and the release script drops the retired dsh-invariants peer from `SDK_EXTERNAL_PEERS` and the sdk smoke consumer.

## Alternatives considered

- **Keep the companions with real checks.** Rejected: no fork package owns a relationship whose observations can independently diverge; writing a check would duplicate a spec or probe the same mutation it claims to verify — exactly the anti-pattern upstream named.
- **Wait for the sync to resolve convention drift passively.** Rejected: the ruling requires the fork side settled before the sync so the sync carries no daypaw decisions; merging wholesale would also leave the `@daypaw/*` wiring incompatible with the incoming stricter gate.
- **Port the full strict gate now (empty installers rejected everywhere).** Rejected: it would fail on the 208 pre-cleanup upstream-owned companions still in this checkpoint and force rewriting upstream-owned packages ahead of the sync.

## Consequences

- Fork packages carry no companion source, export, dependency, reference, build entry, or registration test; their READMEs own the omission reason and the gate enforces its presence and package specificity.
- Daypaw package tests mount the invariant service only (service-only roots); the exhaustive topology test still mounts every published companion in the tree.
- When a fork package later gains a qualifying relationship (for example a cross-event lifecycle or durable projection), the companion returns with a real check and a negative test, and the README sentence is replaced — mirroring upstream's reintroduction condition.
- The next sync deletes the transitional marker branch with upstream's gate version; the CORE_TOUCHES row for `scripts/package-invariants.ts` records that the delta dissolves there.
