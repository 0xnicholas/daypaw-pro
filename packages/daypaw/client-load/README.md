---
description: "Newest-wins settlement for the daypaw browser plane's store loads: one shared guard letting only the latest attempt write, so each shell store keeps its own read, projection, and start/failure policy"
kind: "package-reference"
---

# @daypaw/client-load

English | [中文](README.zh.md)

## Summary

`@daypaw/client-load` gives the daypaw shell's browser stores one shared guard for loading through the wire. A store calls `run()` with its own read and a policy naming what an attempt writes: the start writes, the success projection, and the failure writes. The guard lets only the newest attempt write, so a superseded attempt's data and its rejection are both dropped. Reads, projections, and status policy stay with the store; the stale-write rule and its tests live here once instead of once per store. Plain library: no plugin, no Cordis service, no configuration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Consumed by the fork's shell stores: the inbox board's poll and the task detail's selection ([`@daypaw/ui-inbox`](../ui-inbox/README.md)), the agent catalog ([`@daypaw/ui-agents`](../ui-agents/README.md)), the About facts, first-run key card, and credentials tab ([`@daypaw/ui-settings`](../ui-settings/README.md)), and the new-task dialog's roster ([`@daypaw/ui-tasks`](../ui-tasks/README.md)). Reach for it in any store that loads through the wire and must not let a late answer from an older attempt overwrite a newer one. A single-shot load that nothing can supersede does not need it.

### Entry point

```ts ignore-check
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LatestLoad } from '@daypaw/client-load'

interface CatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  cards: readonly string[]
}

class CatalogStore {
  private readonly store: SnapshotStore<CatalogState> = createSnapshotStore<CatalogState>({ status: 'idle', cards: [] })
  private readonly loads = new LatestLoad(this.store)

  async load(read: () => Promise<readonly string[]>): Promise<void> {
    await this.loads.run(read, {
      start: (s) => { s.status = 'loading' },
      success: (s, cards) => { s.status = 'ready'; s.cards = cards },
      failure: (s) => { s.status = 'error' },
    })
  }
}
```

`run()` resolves once the attempt settles or drops, and never rejects: the snapshot carries the outcome. `invalidate()` supersedes an in-flight attempt without starting one, for a clear or selection path that resets the store itself. Hold one instance per store — the attempt counter is the instance's state, so a controller built per call would let every attempt write. The [`LoadPolicy` contract](src/index.ts) is the exact detail.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One attempt owns one generation number, taken when it starts. The read settles, and the attempt writes only while its number is still the newest; otherwise it returns having written nothing. The start writes are the exception, and deliberately so: they run synchronously before the read, so the caller's intent — loading status, the new selection, the cleared detail — is already in the snapshot even when a later call supersedes the attempt.

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | `LatestLoad` (the guard) and `LoadPolicy` (one attempt's write policy) — the package's whole surface |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-client-store`](../../client/store/README.md) — the snapshot store every attempt settles into (`SnapshotStore`, `createSnapshotStore`, `shallowEqual`).
- [`@daypaw/ui-inbox`](../ui-inbox/README.md) — the board poll and the task detail's selection, the two loads that overlap by construction.
- [ADR 0014](../../../docs/adr/0014-client-load-controller-home.md) — why the home is a fork-local package rather than the upstream store package.

-----

<a id="model-experience"></a>
## Model Experience

### Browser-side store loads

#### What the model sees

Nothing. `LatestLoad` settles browser store snapshots; the package registers no prompt, tool, or schema, and nothing here reaches a model request.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Newest-wins only** — the guard drops a superseded outcome; it does not cancel the read, share one in-flight read, or cache a result. Upstream's `ModelCatalogDirectory` folds an in-flight read plus one rerun; no shell store needs that yet.
- **Failure writes belong to the policy** — a newest attempt that fails writes exactly what its `failure` hook writes; the guard has no opinion about error status or message.
- **Not independently published** — the package ships inside the fork's browser bundles (ADR 0011).

<a id="dev-note"></a>
### Dev Note

**Runtime invariant:** No companion is published. The package is a pure settlement rule over a caller-owned snapshot store: it holds no independent observation to diverge, and each adopting store asserts its own wiring.
