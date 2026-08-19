# Agent Note: fork CI execution — the realized linux main gate

Status: implemented

English | [中文](2026-08-19-fork-ci-execution.zh.md)

## Problem

ADR 0007 §5 decided the fork's CI posture — disable inherited heavyweight lanes via repository settings, keep a linux main gate of test / coverage / snapshot / typecheck / lint, add fork-specific gates as purely-new workflow files — but the execution facts were unknown: every push to `main` failed the inherited `E2E (real DeepSeek API)` preflight (the workflow fail-louds without the `DEEPSEEK_API_KEY_EXTERNAL` secret and also schedules nightly), every issue event failed `Issue lifecycle` (its `create-github-app-token` step needs upstream's GitHub App, which a fork can never hold), and the "kept" gate `ci.yml` never ran at all.

## Decision

- **`ci.yml` cannot serve the fork and stays untouched.** Its substantive matrix jobs are `pull_request`-conditioned and resolve to enterprise labeled runners (`dsh-ubuntu-24-04-16core`, `dsh-windows-2025-16core`) or the self-hosted failover pool — infrastructure this fork does not have; its push face is only master-conditioned self-hosted drills and `if: false` lanes. Adding `main` to its push filter would fire a contentless run, and the fork's no-core-touch posture for it stands.
- **The main gate is realized as `daypaw-gate.yml`** — a purely-additive fork-owned workflow on `push` to `main` (plus `pull_request` / `workflow_dispatch`): immutable install, `typecheck`, `lint`, `test:coverage` (the CI coverage gate, not plain `test`), `test:snapshot` (replay is the default without `DSH_SNAPSHOT`, so CI never writes expected outputs). Standard `ubuntu-latest`, node 24, `DSH_TELEMETRY_DISABLED: '1'`.
- **Twelve inherited workflows disabled in repository settings** (reversible, zero file changes): `e2e`, `issue-lifecycle` (the two actively failing), plus the doctrine-named or infra-coupled heavy lanes `docs-pages`, `e2b-e2e`, `pi-ai-provider-e2e`, `landlock-run`, `landlock-run-release`, `python-release`, `release-vendor`, `release`, `build-exe-for-python-sdk`, `sandbox`. Left enabled: `ci.yml` (dormant without PRs or master pushes; doctrine keeps it), `issue-policy` and `expected-filenames` (pull_request-only, inert in a direct-push repo), Dependabot.
- **Real-API e2e stays local.** Configuring the key secret to un-fail `e2e` was rejected: testing policy keeps real verification local and keyless CI green; a keyed lane would also bill every push and the nightly schedule.

## Alternatives considered

- **Configure `DEEPSEEK_API_KEY_EXTERNAL` and keep `e2e`** — rejected: converts every push and nightly run into billed real-API calls; the fork's verification contract is keyless gates plus local with-key runs.
- **Core-touch `ci.yml` to add `main`** — rejected: the push face holds only master-conditioned drills; the matrix the fork wants is pull_request-conditioned on runners the fork lacks. The edit would fire empty runs and register a core touch for nothing.
- **Disable `ci.yml` too** — rejected: ADR 0007 keeps it; it is inert on `main` pushes and harmless if the fork ever opens PRs (which would also require runner labels, so direct pushes remain the working flow).

## Consequences

- Pushes to `main` get one keyless gate run (typecheck, lint, coverage, snapshots) instead of a guaranteed E2E failure; issue events no longer trip `Issue lifecycle`.
- Actions-minute cost per push is one standard runner job (~15–30 min coverage-dominated); the nightly E2E burn is gone.
- The sync ritual replays this only as repository settings — after each upstream merge, re-verify the disable list in Settings → Actions and the presence of `daypaw-gate.yml` (file, merge-safe).
- If the fork ever adopts PR flow, `daypaw-gate.yml` already covers `pull_request`; `ci.yml`'s matrix would still need upstream runner labels and stays out of scope.
