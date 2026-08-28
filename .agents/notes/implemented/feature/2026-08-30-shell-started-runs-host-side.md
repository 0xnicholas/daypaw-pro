# Agent Note: shell-started runs, host side — agents directory, startRun, starter seeding

Status: implemented

English | [中文](2026-08-30-shell-started-runs-host-side.zh.md)

## Problem

Issue #65 ruled that a task started in the browser shell must become a durable run, but the two halves were not welded: the shell host (the Node process `daypaw` boots) composed `@daypaw/engine` with an **empty** definition registry — `defineAgent` values existed only inside SDK authors' own processes — so the dialog offered only dsh presets, the catalog was structurally empty, and no wire path could start a run (the six `durable/*` endpoints were read/steer/rerun only). Ticket #66 lands the host side: a definition source for the shell host, a start endpoint, and a first-run starter so an empty workspace still has a roster.

## Decision

- **Registry source = `daypaw/agents/` directory scan, injected factories** (ADR 0012). `loadAgentFiles(ctx, dir)` (`@daypaw/sdk/agents-dir`, a new subpath export) imports every `.mjs`/`.js`/`.ts` file in name order, calls its default export with the SDK namespace — `export default ({ defineAgent, defineWorkflow, z }) => definition` (or an array) — and binds each product via `bindAgent`/`bind`. Files carry no bare imports: the delivered install links the daypaw family under `$DSH_HOME/profiles/node_modules`, invisible to a workspace's parent walk, and self-installing would load a second SDK/engine copy in-process. Absent directory = legal empty roster; a present file that imports badly, exports no factory, throws, or produces a non-definition fails loud naming the file. Composition lives in `@daypaw/web-app`'s glue: a new `agentsDir` config (default `daypaw/agents`, cwd-relative like the ledger path) loaded inside `ctx.inject(['durable'], …)` — an async plugin fiber whose rejection fails a Loader boot, which is the fail-loud channel; compositions without the engine row deliberately serve no roster.
- **`durable/startRun`** (`@Remote`, the `listDefinitions` precedent): `{ defName, defVersion?, input, runId? }` → `{ runId }`, start-or-attach aligned with SDK `def.run()`. Version resolution: exact version pins identity; omitted resolves the name's unique registered definition and rejects when several coexist — kinds share the name space, so a same-named agent and workflow are an ambiguity, not a precedence; rejections name the candidates. The handle's result is deliberately not awaited or returned: browsers observe runs through `listRuns`/`journalTimeline` (spec 05 §5's polling model), so `handle.result.catch(() => {})` keeps a failed run from surfacing as an unhandled host rejection.
- **Wire face compiled at bind time.** `bind`/`bindAgent` stamp `wire: { inputKind, parseInput }` onto the engine definition record: `inputKind` is structurally detected from the zod input contract (`z.string()` and `z.object({ task: z.string() })` are `text` — the dialog's free-text shapes; everything else `json`), and `parseInput` is the zod parse as an opaque thunk. The engine calls it at the `startRun` boundary before inserting a run and never inspects its interior — ADR 0010's engine-blind compile extends to the wire hook. `durable/listDefinitions` projects `inputKind` (`null` without a wire face; wire-safe, like `display` absence).
- **Starter seeding.** `seedStarterAgent(dir)` in `@daypaw/cli` writes `daypaw/agents/starter-assistant.mjs` only when absent (the #34 profile-seeding precedent): a steerable general assistant, starter input shape, routed to `deepseek-official/deepseek-v4-flash`. `bin.mjs` seeds it on every launch, so a fresh workspace's dialog has exactly one thing to pick.

## Alternatives considered

- **Preset yml as the declaration surface** — zod contracts are TS values; yml cannot carry them without a DSL subset. Rejected in #65.
- **Self-installed workspace dependencies with bare imports** — natural authoring but install friction plus the in-process duplicate-copy hazard. Rejected in #65.
- **Loader rewriting bare specifiers to host copies** — preserves syntax but breaks source maps, complicates cache keys, and hides failures. Rejected in #65.
- **`$DSH_HOME` global agent library / two-layer merge** — mixes personal tooling with per-workspace ledger data; no real need for layer resolution yet. Rejected in #65.
- **A dedicated `@daypaw/agents` plugin package** — a whole new package for one row; the web-app glue is already the product composition owner and the dependency direction (web-app→sdk→engine) stays clean.

## Consequences

- The shell host's registry is no longer structurally empty; the dialog/catalog read one roster (`durable/listDefinitions`), and preset stays an upstream compatibility layer (the #60 dual-roster Known Limitation retires with #67's dialog switch).
- Agent files are host-process code — the same trust as shell access, same as presets. `.ts` files load only under the source launch (tsx); delivered workspaces author `.mjs`.
- The EVO premise strengthens: a candidate variant is a new-version file in the workspace, and both data face (ledger definition versions) and author face (the agents directory) exist.
- Shell-side UI (dialog reads definitions, board switches to run-major feed, conversation projection over sessionId≡runId, #56 projection retirement) lands in #67; the daypaw web snapshot lane gets its golden refresh there. Host-side coverage: engine `start-run.spec.ts` (11), sdk `agents-dir.spec.ts` (10), web-app roster wiring (3), cli seeding (2).
