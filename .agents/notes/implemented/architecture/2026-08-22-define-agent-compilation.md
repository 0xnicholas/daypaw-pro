# Agent Note: defineAgent compilation — engine-owned child runIds, bind-time persistence, pre-wake turn budget

Status: implemented

English | [中文](2026-08-22-define-agent-compilation.zh.md)

## Problem

The defineAgent face compiles a declarative spec into an opaque engine body with deterministic child runIds, `ctx.agent` sugar, and the bare sub-workflow idiom. Four decisions fix its implementation: which package owns child-runId derivation, how `maxTurns` is enforced when a session's events dispatch on the session store's scope rather than the agent's, how a re-driven body tells create from resume across the crash window between run-row insert and agent creation, and whether a session persistence backend is optional.

## Decision

- **The engine owns derivation** — `run()` without an explicit runId derives `<runId>/<stepKey>/<kind>:<name>#<occurrence>` from the `EngineStepScope` (`{ runId, stepKey }`) published for the body's await, and records `parent_run_id` / `parent_step_key` on insert (attach never rewrites lineage). The SDK consumes the scope in `startRun`. The step ctx also exposes `runId` and the driver `signal` — the signal exists because awaiting agent quiescence crosses no step boundary, so cancellation can only reach a mid-turn wait by racing it.
- **Persistence is mandatory at bind time** — `bindAgent` fails loud without `ctx.durable`, the agents/sessions services, or a `sessionPersistence` backend. Durability is the agent face's reason to exist; a silently ephemeral agent run is a misconfiguration, not a mode.
- **Create vs resume follows the persisted session** — the body resumes when a session with `sessionId ≡ runId` exists in the persistence list, covering the crash window after the run-row insert; the run row alone cannot distinguish them.
- **`maxTurns` is a pre-wake budget check** — one wake runs exactly one turn to quiescence, so before waking (or steering a resumed session) the body counts `turn/start` events and fails the run when the budget is already spent. No live listener: `session/event` dispatches on the session store's carrier scope, which a listener on the agent's context never receives.
- **One dsh step = one journal step** — each dsh step is journaled under `dsh-step:<turn>:<step>` with its event slice as the value; re-driving the same session log returns those recorded slices through the engine's dedup. The journal's `session_id` / `session_seq` columns stay unused in v1 — the step key plus `sessionId ≡ runId` already names the source; they enable when a consumer needs them.
- **SDK-injected `submit` tool** — args schema = the output schema (non-object roots wrap under a single `value` parameter); the tool accepts one submission, and the run resolves only after that value passes the output schema. Revival steers the resumed agent with a fixed English continuation message naming the restart (dsh has no contentless wake). `ctx.agent(def, input)` is one parent step `agent:<name>` awaiting the child on its derived runId; binding the same definition object twice returns the first face (WeakMap), whose closure stays captured on the first host context.

## Alternatives considered

- **SDK-side derivation (the ADR 0010 §4 wording)** — rejected: occurrence counting and re-drive determinism are engine invariants (the engine owns step-key allocation); splitting them across packages would let the two drift. `ctx.agent` and the sub-workflow idiom share one deterministic derivation, owned by the engine.
- **Live turn listener for `maxTurns`** — rejected: the event carrier scope is the store's, so the listener would never fire; the pre-wake check is exact because one wake is one turn.
- **Optional persistence (warn and run ephemeral)** — rejected: misconfiguration fails loud at the earliest resolvable point; a quiet fallback would surface as lost runs after the first restart.
- **Run-row-based resume detection** — rejected: a crash between the run insert and agent creation would take the resume path against a nonexistent session.
- **Step-boundary-only cancellation** — rejected: the quiescence wait has no step boundary; without the signal race a cancel would hang until the model's turn ended.

## Consequences

- The keyless snapshot (`examples/daypaw-skeleton/tests/agent.snapshot.ts`) pins the model-visible surface through the real example host — persona section, `submit` schema, input message, and after a SIGKILL the synthetic resume steer — from hand-written replay overrides, so no API key is needed; recording stays available for future scenarios with one.
- The compiled body concentrates the whole LLM world in `packages/daypaw/sdk/src/agent.ts`; the engine exposes the step scope, `runId`/`signal`, and the parent-linkage columns (migration 0001) and holds no agent-specific behavior.
- Costs accepted, per ADR 0010 §5: the resume steer and a crashed half-turn's failed attempt remain in the resumed context; a second concurrent host composition must re-declare the definition (the first face's closure is bound to its own context).
- Related: [daypaw walking skeleton](2026-08-19-daypaw-walking-skeleton.md) owns the attach/boot-scan semantics this face rides.
