# Agent Note: daypaw defineAgent display fields

Status: implemented

English | [中文](2026-08-25-daypaw-define-agent-display-fields.zh.md)

## Problem

Issue #52 (spec 05 §5, backend increment 3) declares the display metadata the product shell's agent catalog reads through the [definition registry read view](2026-08-25-daypaw-definition-registry-view.md): a business-facing name and description (the #40 minimum set). The engine carrier (`EngineDefinition.display`) shipped with #51, but the SDK declaration face had no way to declare it, and the behavior of a definition that declares nothing was undefined.

## Decision

- **`DefineAgentOptions.display?: DefinitionDisplay`** — `defineAgent` gains the optional display pair (`title` + `description`), reusing the engine's carrier type rather than an SDK-local twin. `AgentDefinition` carries it and `bindAgent` passes it through to the `EngineDefinition` it registers, so `ctx.durable.listDefinitions()` reads it back with the identity.
- **Declaration-time validation** — a declared display with a blank `title` or `description` throws at declaration, the `maxTurns` precedent: a catalog card with an empty business name is a misconfiguration, and misconfiguration fails loud at the earliest resolvable point.
- **The undeclared fallback** — `display` stays optional end to end: an undeclared definition registers without it, the read view reports `display: undefined`, and the catalog presentation falls back to the technical `name` with no description line. The fallback is a presentation convention, documented in the engine/SDK READMEs and the shell vocabulary in `CONTEXT.md`; the engine itself never reads `display`, and engine-layer vocabulary is unchanged.
- **Metadata only** — no execution path, prompt, or tool sees the display fields; the model-visible surface is unchanged, so no snapshot fixture moves.

## Alternatives considered

- **Default `display.title` to the technical `name` at declaration** — rejected: it collapses the declared/undeclared distinction the read view contract (#51) already defines as `undefined`, and a synthesized display would be indistinguishable from an authored one.
- **Push the fallback into the engine** (`listDefinitions` fills `title` from `name`) — rejected: presentation conventions stay above the engine seam; the engine returns exactly what was declared.
- **Mirror `display` on `defineWorkflow` in the same change** — out of the ticket's scope: the #40 mapping makes catalog cards out of agent definitions only; the workflow face can mirror when a consumer appears.

## Consequences

The catalog ticket's data path is complete: declare on `defineAgent`, bind, read through `ctx.durable.listDefinitions()`. Costs: one more validated option on the declaration face, and a fallback rule that is now contractual for presenters.

## Testing

`packages/daypaw/sdk/tests/agent.spec.ts`: blank-field rejection at declaration, declared display readable through `ctx.durable.listDefinitions()` after `bindAgent`, and the undeclared fallback (`display: undefined`, presenter falls back to the technical `name`). SDK src stays at per-file 100% coverage.

## Deferred

A `defineWorkflow` display mirror waits for a workflow-catalog consumer; rendering the card is the agent catalog page ticket's job.
