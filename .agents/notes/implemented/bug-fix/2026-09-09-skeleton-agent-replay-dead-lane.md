# Agent Note: Skeleton agent replay revived in the default vitest lane

Status: implemented

English | [中文](2026-09-09-skeleton-agent-replay-dead-lane.zh.md)

## Problem

The `#72` suffix rename (`5a2044cd2d`, 2026-08-29) moved the skeleton's `tests/agent.snapshot.ts` to `agent.golden.ts`, but no vitest lane's include ever matched the new name: the default lane takes `packages/*/*/tests/**/*.spec.{ts,tsx}`, and the web-daypaw lane's include listed only `apps/daypaw-web/tests/**/*.golden.ts` (that commit updated the pattern's suffix, not its directory). A vitest CLI path argument filters the include set rather than overriding it, so even an explicit `vitest run <path>` refused the file. From 2026-08-29 the defineAgent compilation replay never executed, and its unguarded state accumulated: the committed goldens stayed at Session format v0 while the writer emits v2 (per-event `seq`/`time` envelopes, chunks folded into the settled `assistant/message` stream), and the revive scenario's pre-kill wait polled for a per-chunk durable record — `'partial'` — that the folded-stream format writes only on attempt settlement, which `SIGKILL` preempts (ticket #108).

## Decision

The replay runs in the default lane as `packages/examples/daypaw-skeleton/tests/agent.spec.ts`, a `git mv` of the golden file. It shares its sibling `sigkill.spec.ts`'s execution shape — tsx source-launch spawns, a real `SIGKILL`, persisted-session-log and ledger assertions — needs no browser boot and no built bundles, and `docs/testing.md` already assigns package-owned expectations to `test`. The web-daypaw lane keeps the `.golden.ts` suffix exclusively for its assembled browser replays.

The three committed goldens were refreshed (`DSH_SNAPSHOT=refresh`) and now live as `session.v2.jsonl` in the repository's canonical packed fixture layout (`scripts/session-fixture-layout.ts`): version-named per the filename/header rule, persistence `seq`/`time` envelopes projected away, chunks folded into `stream` arrays inside the settled `assistant/message` events, and the `isSeeded` header field. The event-type order is otherwise unchanged in all three scenarios. Because the spec pins the request-header payloads (persona section, `submit` schema) inline, its comparison composes the newly exported `projectSessionSnapshot` with bare `normalizeSessionLog` from `dsh-session-snapshot` — the full `normalizeSessionSnapshot` pipeline tokenizes those payloads to `{{system}}`/`{{tools}}` (registered in `docs/fork/CORE_TOUCHES.md`).

The revive scenario waits for the durable `request/context` record before killing the host. Under folded streams that record is the last durable proof the model call is in flight; the same durable-log-marker idiom already governs `sigkill.spec.ts`'s park wait (`turn/end`). If the hang entry misbehaves and the host exits early, the subsequent `process.kill` fails with `ESRCH` and the scenario fails loudly.

## Alternatives considered

**Add `packages/examples/daypaw-skeleton/tests/**/*.golden.ts` to the web-daypaw lane's include.** Rejected: that lane boots from built browser bundles the CLI replay does not use, serializes behind browser boots (`fileParallelism: false`), and runs in no fork CI job — the advisory job replays the upstream web lane (`test:web:built`), not `test:web:daypaw:built` — so the file would remain unexecuted in CI.

**Keep proving the stream started through the llm-replay `readyFile` side channel** (runtime-derived hang override, as `apps/web/tests/subagent-interrupt.e2e.ts` builds). Rejected: it would prove the in-memory stream opened, but the durable log cannot carry that fact anymore and the sibling idiom is a durable-log wait; the committed hang fixture would also need per-run derivation because `readyFile` resolves against the host's cwd.

## Consequences

`pnpm exec vitest run packages/examples/daypaw-skeleton` runs both spec files (six tests) green in the default lane with no explicit path, and the file joins the coverage lane's include, which the fork's advisory CI job executes in full. The `.golden.ts` suffix now maps one-to-one onto the assembled web lane.

Pre-existing and unchanged: `packages/examples/daypaw-skeleton/src/**` scores 0% under the v8 per-file gate because those sources execute only as spawned tsx children vitest cannot instrument, so the fork's advisory coverage job has carried that red since the package landed. Closing it means excluding the runnable example's `src` in `vitest.config.ts` — an upstream-file touch needing its own `docs/fork/CORE_TOUCHES.md` row — and stays outside this fix.

Operational note for reruns: the spawned hosts load `fs-ext` (the POSIX session-lease face), so the lane must run under the Node major that built the workspace's native modules; a mismatched ABI fails every scenario with `ERR_DLOPEN_FAILED` before any assertion.
