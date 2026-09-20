# Agent Note: DurableEngine disposal awaits the ledger open before closing

Status: implemented

English | [中文](2026-09-14-durable-engine-dispose-awaits-ledger-open.zh.md)

## Problem

The advisory coverage lane's first nondeterministic red ([#115](https://github.com/0xnicholas/daypaw-pro/issues/115)): `packages/daypaw/sdk/tests/agents-dir.spec.ts`'s empty-roster case failed `ENOTEMPTY` rmdir-ing the file-shared `mkdtemp` root. The engine's teardown disposer was synchronous while `this.ready` (`openLedgerDatabase`) is an async open: a dispose that runs before the open resolves finds `this.db === undefined` and closes nothing, and the pending open then creates `ledger-N.db` plus WAL/SHM sidecars *after* teardown returned — under hosted 4-vCPU load that write lands inside the teardown `rm`'s readdir→rmdir window. A local probe made the race deterministic on a quiet machine: immediately after `await ctx.fiber.dispose()` on a freshly booted engine, the ledger directory reads empty, and the three files appear 300 ms later. The same window also leaked an unclosed `DatabaseSync` handle.

## Decision

- `shutdown()` is async and the disposer awaits it (cordis awaits async disposers, so fiber disposal resolves only once it settled): `core.dispose()` stays in the disposer's **synchronous prefix**, then the open is awaited (a failed open owns nothing to release), the possibly-late core is disposed again (idempotent; a core created after disposal started owns no drivers or timers), and the database closes.
- Driver abort deliberately keeps its synchronous-prefix position: an earlier draft awaited `ready` before disposing the core, and that single yield let already-queued sibling teardown (session inbox-projection unregistration) land before the driver abort, surfacing `ReactLoopAgent.cancel`'s inbox read as three unhandled exceptions in `agent.spec.ts`.

## Testing

- `behavior.spec.ts` gains a regression case that boots the engine, touches nothing on `ctx.durable` (the engine booted with no roster entries), disposes, and asserts the ledger directory is byte-stable across a bounded window and holds no `-wal`/`-shm` companions. Red before the fix (directory read empty, files appeared after), green after; the window only bounds the negative observation, it never gates the assertion.
- The surfaced `agent.spec.ts` unhandled errors disappeared with the synchronous-prefix ordering; `pnpm exec vitest run packages/daypaw/engine packages/daypaw/sdk` is 211/211 across three consecutive runs, and the originally failing spec stayed green through 10 runs under 8-way CPU load.

## Alternatives considered

**Bounded retry on the teardown `rm` (the issue's fallback direction).** Rejected: it masks the dispose-contract violation rather than fixing it — the retry bound would encode observed contention instead of quiescence, and every future dispose-then-clean fixture would re-inherit the race.

**Await `ready` first, then dispose and close.** Rejected: the first await admits sibling-fiber teardown continuations before the driver abort (see Decision); aborting drivers is the engine's own teardown moment and must not interleave with cleanup it does not own.

**Degrade `ReactLoopInbox.current` when the projection registration is inactive.** Rejected: `packages/core/agent-loop` is upstream-owned (a fork core touch for a workaround), and the synchronous-prefix contract makes the ordering unreachable from engine disposal.

## Consequences

- When `ctx.fiber.dispose()` resolves, the engine will not write the ledger again: teardown may remove the ledger directory immediately, and the quiescent directory holds at most the `.db` file (SQLite's last-connection close checkpoints and unlinks the sidecars).
- The dispose-before-open window no longer leaks an open `DatabaseSync`.
- Residual, unobserved in any lane: the SDK's abort path still assumes the composition outlives driver abort (`agent.cancel` reads inbox projections). Engine disposal preserves that by construction; explicitly disposing the AgentLoop fiber before the engine's could still throw through the abort dispatch.
