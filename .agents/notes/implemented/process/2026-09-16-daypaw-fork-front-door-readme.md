# Agent Note: daypaw fork front-door README as a fork-only root file

Status: implemented

English | [中文](2026-09-16-daypaw-fork-front-door-readme.zh.md)

## Problem

The repository front door on GitHub is `README.md`, an upstream-owned bilingual pair that introduces DeepSeek Harness only. A visitor to the fork learns nothing about daypaw from it, and the fork corpus that does describe daypaw (`CONTEXT.md`, `docs/adr/`, `docs/spec/`, `docs/fork/`) is Chinese-first with no entry point visible from the front door. The `AGENTS.md` fork-layer note carries pointers, but it addresses coding agents, not human visitors.

## Decision

- The fork front door is `README-daypaw.md`, a new fork-only, Chinese-only root file: a positioning statement, a package-family table, the fork/upstream relationship, verified quick-start commands, and navigation links. It restates no glossary, ADR, or spec content — every fact keeps its existing home and the page links to it.
- The file stays outside every documentation gate by construction. The pairing gate's discovery matches README artifacts whose entire stem is `readme` (`README_ARTIFACT` in [scripts/translation-pairing.ts](../../../../scripts/translation-pairing.ts); scope rules owned by the [bilingual pairing gate](2026-07-02-bilingual-docs-and-pairing-gate.md)), so `README-daypaw.md` is out of pairing scope without a manifest exclusion, adds no core touch, and carries no word-count ceiling.
- Discoverability rides the already-registered `AGENTS.md` fork-layer core touch: the fork-layer note gains a `README-daypaw.md` pointer, and the `AGENTS.md` row in `docs/fork/CORE_TOUCHES.md` states the extension.
- Every command and default the page states was checked against the checkout (`scripts/dev-daypaw.sh`, root `package.json`); the page claims nothing that was not read from those sources.

## Alternatives considered

- **Append a fork section to root `README.md`** — rejected: it core-touches the upstream file with the highest churn and pair obligations (EN, ZH, and sidecar must move together), so every sync ritual re-plays a three-file conflict over marketing prose the fork does not own.
- **`docs/fork/README.md` as the entry** — rejected as a front door: the docs tree is invisible from the repository landing page, and `docs/spec/README.md` already serves that index role inside the corpus. A new root file costs the same and is reachable from the repository root listing.
- **A bilingual EN/ZH pair like `packages/daypaw/README.md`** — rejected: the fork design corpus is Chinese-first by wayfinder map #1, and the current audience (the owner and coding agents) reads Chinese; pairing buys alignment enforcement for a page whose facts live elsewhere.
- **A full architecture overview as body content** — rejected: it would duplicate `CONTEXT.md`, the ADRs, and the specs, violating one-home-per-fact and rotting at the first sync.

## Consequences

- The fork gains a maintained entry page whose only sync exposure is its own facts going stale; no upstream file can conflict with it.
- Being outside the gates is a two-edged sword: no ceiling or pairing check guards the file, so accuracy is a review responsibility. The naming is load-bearing: moving this content into any file whose stem is exactly `readme` (a directory-level `README.md` or `README.zh.md`) silently enters pairing scope and then requires a manifest exclusion.
- Upstream syncs and package-family growth are the moments to re-check the page's commands and package table.
