# Agent Note: the daypaw agent plane rides the host composition — full tool line under the approval guardrail

Status: implemented

English | [中文](2026-09-07-daypaw-agent-plane-tools.zh.md)

## Problem

The daypaw profile copied upstream's web overlay wholesale, including its 「agent plane moves behind agent presets」 block: every base model-side tool row (`tool-bash`/`tool-pwsh`/`tool-jobs`/`tool-fs`/`tool-fs-search`/`tool-str-replace-editor`/`skill-filesystem`/`tool-skill`/`tool-goal`/`plan-mode`/`compaction-basic`/`command-compact`/`tool-result-pruner`/`tool-subagent-*`/`workflow-worker-thread`/`tool-workflow`/`tool-ralph`/`agent-instructions`/`tool-todo`/`tool-web`) was `disabled: true` and the preset roster carried the surface instead. In daypaw that starves exactly the agents that matter: shell-started tasks are **engine runs** (ADR 0012) whose SDK agents never join a preset, and the seeded agents declare `tools: []` — so the product's primary surface ran bare models with `submit` only ([#97](https://github.com/0xnicholas/daypaw-pro/issues/97) §0.2). Five mounted UI faces (ui-jobs, ui-goal, ui-plan, ui-subagent, ui-workflow-run), the slash-command palette's tool-domain commands, and the approval surface had no producers — walkthrough gap ③ ([#84](https://github.com/0xnicholas/daypaw-pro/issues/84)): with no sensitive operations in existence, the inbox 等待你确认 group idled forever.

## Decision

ADR 0013 §3 rules the capability base open with the approval guardrail untouched, and [ticket #103](https://github.com/0xnicholas/daypaw-pro/issues/103) executes it: the daypaw `cordis.patch.yml` deletes the whole disable block, so the base rows flow through the overlay untouched and the full model-side tool line rides the **host plane** — every agent in the process (plain shell sessions and engine-run SDK agents alike) inherits the global tools layer, because `defineAgent`'s `tools` array adds to, never subtracts from, the host surface. Three accompanying rows keep the composition on one plane per row:

- **`agent-presets` insert disabled** (not removed — the upstream row stays visible for syncs). Sessions created after this change compose the host composition, the documented upstream fallback when the roster service is absent; mounting `standard` on top of live base rows would double every row on both planes (an `isolate` realm shadows the host instance for its own consumers; a host-singleton registration collides on the second session) — the exact failure modes `verify-cordis-config`'s preset-plane-separation gate encodes for upstream's own files.
- **`tool-ask-user` inserted host-plane** — the one standard-preset capability with no base row (upstream ships it only through presets); without it, retiring presets would silently drop `ask_user_question`, the producer of the mounted ui-user-questions face.
- **`subagent-model-selection-settings` insert dropped** (with its `@deepseek-ai/dsh-tool-subagent` dependency): its only sampler was the preset's `tool-subagent` rows (`modelSelectionSettings: true`); the base rows do not sample it and no fork surface edits the namespace, so the row was knowingly-inert composition.

The #46 conservative default — workspace-write sandbox, approval `ask`, both host-plane in the base — is untouched and is now the only defense line over the open surface, exactly as ruled.

## Consequences

The approval loop is live end to end for engine-run agents: a sandbox escalation (`sandbox_permissions` + justification, the sensitive-operation shape) fires the scoped `approval/request` waterfall — the seam `api-remotes` bridges to the gateway and the browser approval board answers — and writes the turn-enclosed `approval/asked` + `approval/decided` audit pair the inbox feed, the in-conversation card, and the fork's approval-history projection read. `tests/agent-plane.spec.ts` boots the real bundle composition (isolated profile home, web-transport rows off) and pins all of it keylessly: the bare-agent catalog (27 tools), no-ask in-workspace writes, the asked/decided pair on approve, the open-ask waiting state, and the closed rejection with nothing executed. `tests/roster-coexistence.spec.ts` pins the composed row states. The five starved faces and the tool-domain slash commands now have producers on every agent, including engine runs. A live round against the real shell and model (2026-09-07, ticket #103) walked the same loop on the wire: the model's first out-of-workspace write was sandbox-denied, it retried with the escalation request, the Gateway's Remote Event mux delivered the pending `approval/request` frame to a fresh stream generation (the cold-start replay a browser reconnect consumes), answering it through `$events/result` — the 同意 button's exact call — decided `allowed-once` and let the escalated write land.

Sessions composed with the `standard` preset before this change resume on the host composition (the preset service is absent, so the session-controller's bare-setup fallback applies); their logged preset identity stays stale but harmless, and the tool surface is equivalent minus the preset's `subagent` model-routing config (unreachable from any fork surface anyway). The upstream overlay diverges further — the fork now deliberately differs where ADR 0012/0013 rule, and the yml comments carry the one-plane reasoning with its home in `.agents/notes/implemented/architecture/2026-08-10-host-plane-ownership-after-presets.md`.

## Alternatives considered

**Enable the base rows and keep `agent-presets default: standard` mounted**: rejected — every standard row would mount twice (preset scope shadowing the global layer, plus a second workflowEngine worker thread, plan realm, and compaction stack per standing mount); a row belongs to exactly one plane.

**Give the seeded agents tools through their declarations**: rejected — dsh plugin tools are not importable `ToolDefinition`s from an agents file (the injected-factory form passes only the SDK namespace), and per-agent declarations would make the capability base a function of every agent author rather than a composition fact; the ADR's framing is the base, not the seed.

**Auto-join the standard preset in the SDK agent setup**: rejected — it would contradict `defineAgent`'s static composition contract (`tools: []` would no longer mean a bare surface plus `submit`) and bind the engine's agent plane to a preset roster the product already retired.

**Switch the preset default to `minimal`**: rejected — `minimal` ships its own complete persona and an isolated local-fs realm; it changes light-chat semantics far more than the host-plane fallback and still leaves one row family mounted on two planes.
