# Agent Note: ModelRoute gains reasoningEffort and the engine serves durable/cancel

Status: implemented

English | [中文](2026-08-31-model-route-effort-and-durable-cancel.zh.md)

## Problem

Two product gaps surfaced by the first real shell-hosted run (ticket #74). `ModelRoute` exposed only provider/model/maxTokens, so a definition could not declare a reasoning effort; the deepseek adapter's default effort is `high`, and `deepseek-v4-flash` spent the entire 8192-token output budget on reasoning (finish reason max-tokens) before any visible block or the `submit` call — twice. And the Remote face had no cancel: `RunHandle.cancel` existed, but a parked run could not be cancelled from the product path, only steered to a terminal state.

## Decision

`ModelRoute.reasoningEffort?: ReasoningEffortId` rides the model selection the compiled body already installs — `installModelSelection`'s request waterfall applies the selected effort and clears any inherited one, so the selection is the one owning seam (agent options effort would be stripped by an absent selection effort). `LlmRuntime` validates the effort against the adapter-declared set, so an unsupported effort fails loud per request. Undeclared keeps the provider's configured/default behavior.

The engine's private cancel-run extraction became the public `cancel(runId, cause?)`: terminal `cancelled` row with the cause first, pending gates settle cancelled, then the driver aborts. Cancel is idempotent on a terminal run — the request's postcondition already holds — but the abort always runs, because a fault between the terminal write and the abort can leave a driver lingering past a terminal row (the fault-injection suite pins this). Unknown run ids fail loud. The service exposes it as `@Remote('cancel')`, and the wire-contract spec cancels a gate-waiting run through the live gateway.

## Alternatives considered

**Configure effort per deployment (profile patch) and leave ModelRoute narrow.** Rejected: a deployment default covers every agent on the host, while effort is a per-definition property of the workload — a lint agent wants low, a coding agent wants high, on the same host.

**Make cancel loud on terminal runs (steer's precedent).** Rejected: a cancel is a request that the run not continue; a run that already ended satisfies it, and loud failure would force every caller into race handling around natural completion.

## Consequences

- The shell can cancel parked and running runs over the wire once a UI entry exists; the UI placement itself stays unadjudicated (trigger: the shell needs cancel interaction).
- The sdk test composition's MockAdapter now accepts reasoning info, so effort assertions run against the real request-validation path.
