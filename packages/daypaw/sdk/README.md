---
description: "The typed facade over the daypaw durable engine: defineWorkflow declares a code-orchestrated run, defineAgent declares a declarative LLM"
kind: "package-reference"
---

# @daypaw/sdk

English | [中文](README.zh.md)

## Summary

## Table of Contents



The typed facade over the daypaw durable engine: `defineWorkflow` declares a code-orchestrated run, `defineAgent` declares a declarative LLM-loop spec, and `bind` / `bindAgent` attach them to a host composition. Both faces return `run()` (idempotent start-or-attach) plus a typed `RunHandle`. Type authority: [spec ch.2 §1.1/§1.2](../../../docs/spec/02-agent-engine-sdk.md); programming-model decisions: [ADR 0003](../../../docs/adr/0003-engine-sdk-programming-model.md) and [ADR 0010](../../../docs/adr/0010-define-agent-compilation-and-execution.md).

## Install

```sh
npm i @daypaw/sdk @deepseek-ai/cordis@~4.0.1 @deepseek-ai/dsh-invariants@~0.1.0-rc.3 zod@^4.4.3
npm i -D @types/node
```

The tarball is self-contained: `@daypaw/engine` and `@daypaw/store` ship vendored inside it ([ADR 0011](../../../docs/adr/0011-customer-self-run-delivery.md)). The peers are the consumer-supplied singletons — `@deepseek-ai/cordis` and `@deepseek-ai/dsh-invariants` resolve from upstream's npm releases, and `zod` types the definition contracts. `@types/node` is required for typechecking: the vendored engine and store declarations reference `node:sqlite`.

## API

```ts ignore-check
import { bind, defineWorkflow, DurableEngine } from '@daypaw/sdk'
import { z } from 'zod'

const def = defineWorkflow({
  name: 'demo', version: '1',
  input: z.object({ seed: z.number() }),
  output: z.object({ total: z.number() }),
  body: async (ctx, input) => ({ total: (await ctx.step('bump', async () => input.seed + 1)) + 1 }),
})

// Mount the engine plugin in your Cordis composition, then bind:
await ctx.plugin(DurableEngine, { path: 'ledger.db' })
const workflow = await bind(def, ctx.durable)
const handle = await workflow.run({ seed: 1 }, { runId: 'demo-1' })
const { total } = await handle.result   // typed: { total: number }
```

- `defineWorkflow(options)` — identity, zod input/output contracts, step body; returns the unbound definition.
- `bind(def, engine)` — register for execution and boot revival (same definition object rebinds as a no-op) and return `{ run(input, opts?) }`.
- `DurableEngine` — re-export of the engine's Cordis plugin class, so consumers never import the vendored `@daypaw/engine` copy directly.
- `RunHandle` — `id`, `definition`, typed `result` (input validated before start, output validated before resolve), `status()` (`RunStatus` discriminated union), `cancel(cause?)`, `meta`. `steer(input)` appends a follow-up input to the run (issue #53): validated against the definition's input contract, then recorded as a journal segment and consumed at the run's next segment boundary under the same runId; it fails loud on terminal runs and on definitions that did not opt into steering.
- `ctx.waitFor(gate, { schema?, timeout? })` — durable gate (HITL suspension): suspends the run inside the body (`status()` reports `{state:'waiting', gate}`); waiting costs nothing and the process may exit. The outcome returns as a `GateResolution` union value (`resolved` / `rejected` / `timedout` / `cancelled` — terminal states are values, not exceptions). Settle through `ctx.durable.resolveGate(runId, gate, settlement, source)`, first-wins idempotent; the zod `schema` validates on both the write and the delivery side.
- Errors — engine failures surface as `RunFailedError` (cause attached), cancellations as `RunCancelledError`; input/output contract violations reject with the zod error.

### Agents-directory loader (ADR 0012, `@daypaw/sdk/agents-dir`)

`loadAgentFiles(ctx, dir)` — the shell host's definition source: scan one directory (absent = legal empty roster), import each module file in name order, call its default-exported injected factory with the SDK namespace, and bind every produced definition onto `ctx.durable`. The one file form:

```js ignore-check
// daypaw/agents/starter-assistant.mjs — no imports; the loader injects the namespace
export default ({ defineAgent, z }) => defineAgent({
  name: 'starter-assistant', version: '1',
  input: z.object({ task: z.string() }), output: z.string(),
  prompt: [], tools: [], model: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  maxTurns: 16, steerable: true,
})
```

Files carry no bare imports (a delivered workspace cannot resolve them, and self-installing would duplicate the SDK copy in-process); same-directory relative imports stay available. `.mjs` / `.js` / `.ts` are module files, everything else is ignored; a present file that imports badly, exports no factory, throws, or produces a non-definition fails loud naming the file. Bind-installed definitions carry a `wire` face (ADR 0012): the input presentation (`text` for `z.string()` / `z.object({ task: z.string() })`, `json` otherwise) plus the opaque validator the engine's `durable/startRun` boundary calls before inserting a run. The validator owns the starter shape detail: for the `{ task }` shape it accepts the dialog's bare free-text string and wraps it before the zod parse, so both starter shapes hand the same wire payload.

### Agents (ADR 0010)

```ts
import { bindAgent, defineAgent, defineWorkflow } from '@daypaw/sdk'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

const reviewer = defineAgent({
  name: 'reviewer', version: '1',
  input: z.object({ code: z.string() }),
  output: z.object({ score: z.number() }),   // also the injected submit tool's args schema
  prompt: [{ name: 'persona', order: 10, text: 'You review code and report a score.' }],
  tools: [],                                  // dsh ToolDefinitions, zero adapter
  model: { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 4096 },
  maxTurns: 4,                                // turn budget across revivals; required
  display: { title: 'Code reviewer', description: 'Reviews code and reports a score.' },
})

const reviewFlow = defineWorkflow({
  name: 'review-flow', version: '1',
  input: z.object({ code: z.string() }),
  output: z.object({ score: z.number() }),
  // Inside a workflow body — itself the parent step `agent:reviewer`:
  body: (ctx, input) => ctx.agent(reviewer, { code: input.code }),
})

// ctx = the host composition (see below):
export async function compose(ctx: Context) {
  await bindAgent(reviewer, ctx)
  return reviewFlow
}
```

- `defineAgent(options)` — declarative spec: identity, zod contracts, static composition lines (prompt segments, dsh tools, model route), a mandatory `maxTurns` budget validated at declaration, optional `display` metadata (`title` + `description`, validated non-blank at declaration) for host catalog views, and the optional `steerable` flag (default false) that opens the multi-segment lifecycle below.
- `bindAgent(def, ctx)` — compile the spec into an opaque engine body (the engine stays blind to `kind: 'agent'`) and register it for execution and boot revival; a declared `display` registers with the definition, so `ctx.durable.listDefinitions()` reads it back with the identity. Undeclared: the read view omits the `display` key and the catalog presentation falls back to the technical `name` with no description line — display is metadata only and never reaches execution semantics. The host context must mount `ctx.durable`, the dsh agent stack (`agents`, `sessions`), and a session persistence backend; any one missing fails loud at bind time. Re-binding the same definition object is a no-op returning the first face — the closure stays captured on the first host context.
- One agent run = one dsh session with `sessionId ≡ runId`: first drive creates, revival resumes and wakes with a synthetic continuation message. Every dsh step journals as one engine step (`dsh-step:<turn>:<step>`), so a re-driven body replays the session log instead of re-calling the model.
- **Multi-segment runs** (`steerable: true`, issue #53): a turn that quiesces without `submit` parks the run at zero compute instead of failing it, and each `handle.steer(input)` is delivered as a user message (`agent.steer`, JSON text, same shape as the initial input) at the next segment boundary — one wake runs exactly one turn to quiescence. The `maxTurns` budget is checked before every wake and shared across segments. Re-drives count already-delivered segments ordinally from the session log's user-sourced messages (resume wakes excluded; producer-injected context such as runtime-context snapshots is never counted), so a crash never double-delivers and identical follow-ups stay distinct; a segment recorded while no process drove the run becomes the revival wake with no synthetic continuation message, while a cleanly parked run revives by re-parking without spending a turn. Non-steerable definitions keep the single-segment contract: a submit-less turn fails the run, so `ctx.agent` child runs cannot hang a parent workflow. Artifacts are unchanged — `output_json` is written only by terminal finalization, and intermediate segments never form artifacts.
- `ctx.agent(def, input)` — awaited child run on a deterministic derived runId (`<parentRunId>/<stepKey>/<kind>:<name>#<occurrence>`), parent linkage recorded in the ledger; the bare sub-workflow idiom (`child.run()` inside `ctx.step`) shares the same derivation.

## Model Experience

### Stored domain records

#### What the model sees

`defineWorkflow` / `bind` contribute nothing — they type the orchestration layer above model calls. `defineAgent` owns its whole model-visible surface: the declared prompt segments assemble into the system prompt, the injected `submit` tool carries the output contract as its argument schema, the run input becomes the first user message, each steered follow-up arrives as a further user message in the same session, and a crash-interrupted run is woken by a synthetic continuation message naming the restart.

#### Token effect

Workflow face: zero live-request tokens. Agent face: the static prompt segments and the `submit` schema ride every request of the run; the resume steer and a crashed half-turn's failed attempt stay in the resumed context (the honest cost of durability, ADR 0010 §5).

#### KV Cache effect

Prompt segments and the tool list are stable per definition, so a run's requests share one prefix; revival appends (steer message, new turn) and never rewrites history.

## Known Limitations and Deferred Work

- **Static composition lines only** — the dynamic `compose(input)` escape hatch is declared in ADR 0010 but not opened; EVO variant operators target the static dimensions.
- **`ctx.spawn` excluded** — fire-and-forget child runs are out of ADR 0010 §4's scope; `ctx.agent` is the awaited form.
- **Agent runs require a persistence backend** — `bindAgent` fails loud without one: durability is the agent face's reason to exist, not an option.
- **Retry surface deferred** — `StepOptions.retry` and `PermanentStepError` arrive with the retry migration; v1 fails the run on the first step failure.
- **`meta` is caller-side only** — not persisted by the skeleton; see the engine README.
- **A crash before the initial input reaches the log revives into an input-less conversation** — the window is the few synchronous statements between session materialization and the first user-message append; the revival then re-parks (or resume-wakes without segment 0) until the next steer, which delivers only its own follow-up.
- **`@daypaw/engine` / `@daypaw/store` are not independently published** — they ship vendored inside this tarball (ADR 0011); import their faces through this package, never directly.

### Dev Note
