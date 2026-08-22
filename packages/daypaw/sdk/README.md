# @daypaw/sdk

English | [中文](README.zh.md)

The typed facade over the daypaw durable engine: `defineWorkflow` declares a code-orchestrated run, `bind` attaches it to a `ctx.durable` service, and the returned runnable face gives `run()` (idempotent start-or-attach) plus a typed `RunHandle`. Type authority: [spec ch.2 §1.1](../../../docs/spec/02-agent-engine-sdk.md); programming-model decisions: [ADR 0003](../../../docs/adr/0003-engine-sdk-programming-model.md).

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
- `RunHandle` — `id`, `definition`, typed `result` (input validated before start, output validated before resolve), `status()` (`RunStatus` discriminated union), `cancel(cause?)`, `meta`.
- Errors — engine failures surface as `RunFailedError` (cause attached), cancellations as `RunCancelledError`; input/output contract violations reject with the zod error.

## Model Experience

### Stored domain records

#### What the model sees

Nothing. The SDK contributes no prompt, tool, or schema; `defineWorkflow` and `bind` type the orchestration layer above model calls.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the SDK never touches live request prefixes.

## Known Limitations and Deferred Work

- **Workflow face only** — `defineAgent` (declarative spec + composition lines) lands with pillar ②'s milestone (ADR 0009 frame); the engine's registry already accepts `agent`-kind records.
- **Retry surface deferred** — `StepOptions.retry` and `PermanentStepError` arrive with the retry migration; v1 fails the run on the first step failure.
- **`meta` is caller-side only** — not persisted by the skeleton; see the engine README.
- **`@daypaw/engine` / `@daypaw/store` are not independently published** — they ship vendored inside this tarball (ADR 0011); import their faces through this package, never directly.
