# Agent Note: ensureSymlink shared from dsh-app-boot — the delivery closure's one registered runtime core touch

Status: implemented

English | [中文](2026-08-26-ensure-symlink-shared-from-app-boot.zh.md)

## Problem

`pnpm run duplication` fails on every clean checkout (issue #64): `@daypaw/cli`'s `ensureEngineLink` inlined the idempotent symlink heal of `dsh-app-boot`'s private `ensureSymlink` (42 lines / 72 tokens of clone). The copies had drifted the way copies do — error prefix (`daypaw:` vs `dsh:`), a missing Windows-unlink comment, a missing `v8 ignore` on the EEXIST race arm — so leaving them means watching the clone grow. Deduplication needs one home for the heal, and every candidate home edits an upstream file: `packages/boot/app-boot/src/profile.ts` is upstream-owned, and [the template-seeding note](2026-08-22-daypaw-profile-template-seeding.md) had kept the delivery line free of upstream runtime edits so ADR 0011 §1's zero-core-touch premise would hold for the published closure.

## Decision

- **`dsh-app-boot` exports the heal; the error text becomes parameters.** `ensureSymlink(binName, link, target, manages)` is public from `packages/boot/app-boot/src/profile.ts`; the two message deltas become the parameters and both call sites' errors stay byte-identical (`dsh`/`the installation fallback`, `daypaw`/`the profile's engine link`), pinned by exact-string assertions in `profile.spec.ts` and `seed-profile.spec.ts`.
- **`@daypaw/cli` deletes its inline copy**: `ensureEngineLink` computes `link`/`target` and delegates. Its spec still stages the EEXIST race through the `node:fs` mock, which intercepts the moved code the same way because the mock is keyed on the module, not the importer.
- **The profile.ts touch is registered, not smuggled**: `docs/fork/CORE_TOUCHES.md` carries the row, marked as an upstream PR candidate (an export plus parameterized diagnostics is self-contained upstream). ADR 0011 §1's premise gains one registered exception rather than being abandoned: the release pipeline already bundles the fork workspace's closure (`pnpm deploy` plus `bundleDependencies`), so the packed `@daypaw/cli` carries the fork's `dsh-app-boot` with no pipeline change, and upstream acceptance strikes the row at the next sync. The EEXIST arm keeps its `v8 ignore`: exporting the function does not make the lstat-to-symlinkSync window stageable from the public API.

## Alternatives considered

- **A jscpd ignore for the pair** — rejected: it certifies the clone as permanent while the copies keep drifting; the gate exists to force exactly this consolidation.
- **A fork-owned util package both sides import (issue #64 option B)** — rejected: consuming it from `app-boot` still edits the upstream file, so the core-touch accounting is identical, and a new package for one function widens the workspace without extra dedup.
- **A fork-added file inside `dsh-app-boot`** — rejected: still a core touch, and a harder upstream candidate than exporting an existing private function in place.

## Consequences

- The upstream-sync ritual (ADR 0001) replays this touch every sync; losing it fails loudly — `@daypaw/cli` no longer typechecks against an export-less `dsh-app-boot` — so drift surfaces at build time, never silently.
- The published CLI tarball bundles a fork-modified `@deepseek-ai/dsh-app-boot` under upstream's name; `bundleDependencies` keep it private to the tarball, so it cannot collide with an upstream npm copy a consumer installs separately. The template-seeding note's zero-core-touch statement now points here for the exception.
- Every future consumer of the heal passes its own `binName` and `manages`; the message contract is pinned byte-exact on both existing sides, so a wording change fails the pinning suites.
