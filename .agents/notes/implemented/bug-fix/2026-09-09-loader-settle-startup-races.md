# Agent Note: Composition-settled configured startup and ACP serving

Status: implemented

English | [中文](2026-09-09-loader-settle-startup-races.zh.md)

## Problem

The Loader applies sibling entries in one tree concurrently (`EntryGroup.update` runs `Promise.allSettled` over the rows), so a plugin constructor that samples another entry's service with a non-waiting `ctx.get` races that entry's registration. Two shipped surfaces lost that race on the tsx source-launch path (`node --import tsx`, the default `DSH_EXAMPLE_MODE=src`), where per-entry TypeScript transpilation makes sibling imports slow enough to reorder startup:

- `dsh-agent-loop` created configured agents in its constructor and sampled `ctx.sessionPersistence` immediately. When the `dsh-session-persistence-jsonl` entry had not registered yet, `createStoredSession` took no write handle, so the configured agent ran memory-only and `.sessions` never appeared; the process still exited 0 with a complete event stream (ticket #106, six `test:expected` cases red on macOS src mode).
- `dsh-acp` connected its stdio transport in `apply`, so a client could create a session while a provider entry was still importing. `llm/adapters-updated` then fired after the first session record existed and emitted a `config_option_update` notification that the recorded fixtures (captured on compositions where the adapter registered before serving) do not carry.

Built-`lib` boots resolve imports fast enough that both races resolved the recorded way, which is why CI (`DSH_EXAMPLE_MODE=lib`) stayed green while src-mode runs were deterministically red on slower transpilation. Instrumentation ruled out the ticket's competing hypothesis of a split `sessionPersistence` instance in a preset realm: exactly one backend instance constructs, and the same context resolves it — the miss is registration timing, not identity.

## Decision

Both startup decisions now read the composition only after it is final, using the Loader service's settle barrier (`ctx.get('loader')` read structurally as `{ await(): Promise<void> }`, the same read the api-gateway client and the web boot already perform):

- `AgentLoop` routes configured (non-resuming) agents through `startConfiguredAgent`, which samples `sessionPersistence`, and — when the sample misses and a Loader owns the plugin — waits for `loader.await()` before sampling again. After the tree settles, absence is final and the agent runs memory-only, exactly like a composition that mounts no backend; outside a Loader tree the constructor sample is already final. The settle barrier is best-effort: a rejecting `loader.await()` (a sibling entry failed to apply) proceeds with current visibility and leaves the process outcome to the Loader's tree failure. The resume path was already correct (`ctx.inject(['sessionPersistence'])` waits for registration) and is unchanged.
- `dsh-acp` builds its app and registers handlers as before but connects the transport only after `loader.await()` settles, or immediately when no Loader exists (unit tests injecting `config.stream`). A tree that failed to settle never serves. Wire-dependent bindings (`notify`, permission requests) read the client through one guarded accessor, since agents exist only for wire-created sessions and therefore only after serving started.

## Alternatives considered

**Make `createStoredSession` itself settle-aware.** Rejected because every create caller — web, ACP, subagents — runs post-boot with services present; only the composition-declared configured agents start during tree application. Embedding a Loader wait in the shared create flow would widen the change to callers that cannot hit the race.

**Declare `inject: [sessionPersistence]` on the agent-loop entry or in the base bundle.** Rejected because injection is an unconditional wait: compositions that configure agents without any persistence backend (the unit-test surface, `sdk-minimal`-style hosts) would never start their configured agents, and the dependency belongs to the composition, not to the generic loop package.

**Suppress the redundant initial `config_option_update` in `dsh-acp`.** Rejected because the notification is honest mid-session topology reporting; the defect was serving before the composition was final, not the notification itself. Filtering by content equality against an in-flight `session/new` response would couple the bridge to response timing it does not own.

## Consequences

Configured agents deterministically persist whenever the composition mounts a backend, regardless of sibling import timing, and deterministically start memory-only when it does not; the six src-mode `test:expected` cases are green and lib-mode fixtures replay unchanged. ACP answers its first request only after the composed application settles, so the served catalog and capabilities are final — clients of a Loader-owned boot see a bounded startup delay before the `initialize` response instead of racing topology notifications. Both waits are floating startups (tracked through `FactoryOwnership` / plugin effects), so tree teardown during the wait abandons them without deadlocking the Loader's own task drain.

`packages/core/agent-loop/tests/config-session-id.spec.ts` pins the settle arms (late backend persists fresh and exact ids, settled-without-backend starts unpersisted, failed settle proceeds, teardown during the wait abandons) and `packages/acp/acp/tests/startup.spec.ts` pins serving deferral (pending barrier, already-settled barrier, failed settle, teardown before settle); both changed source files hold 100% coverage under the owning suites. The upstream-carried defect and fix are registered in `docs/fork/CORE_TOUCHES.md` as upstream PR candidates for the next sync.
