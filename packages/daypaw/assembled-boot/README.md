---
description: "Parameterized assembled-boot scaffolding for the jsdom web lanes: one module boots the real built client roster through AppWebEntry's ModuleLoader path, with bundle layers, transport carrier, and pinned document title as lane options"
kind: "package-reference"
---

# @daypaw/assembled-boot

English | [中文](README.zh.md)

## Summary

`@daypaw/assembled-boot` is the one scaffolding behind both web snapshot lanes' jsdom boots. A lane passes its facts — which bundle layers to compose, whether the page reaches the fixture transport through `__DSH_TRANSPORT__` carrier hooks or the `?fixture` search switch, and the pinned document title — and gets back `installAssembledBootEnv()` / `mountAssembledApp()` over the built `lib/client.js` artifacts. The upstream apps/web e2e lane and the fork's apps/daypaw-web golden lane consume the same module with different options, so the scaffold has one home instead of a near-cloned pair that drifts on every sync. Plain library: no plugin, no Cordis service, no configuration.

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

Consumed by the two web lanes' `tests/assembled-boot.ts` entries: the upstream lane ([`apps/web/tests/assembled-boot.ts`](../../../apps/web/tests/assembled-boot.ts), upstream web-app bundle, `?fixture` search switch) and the fork lane ([`apps/daypaw-web/tests/assembled-boot.ts`](../../../apps/daypaw-web/tests/assembled-boot.ts), daypaw web-app bundle over the base layer, carrier hooks wrapping the fixture world with the fork's `durable/*` decorator). Reach for a new lane only when a third assembled roster needs jsdom golden coverage.

### Entry point

```ts ignore-check
import { connectionRpcCarrier, createAssembledBootLane } from '@daypaw/assembled-boot'
import { createFixtureConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { decorateDurableRpc } from './durable-rpc.ts'

const lane = await createAssembledBootLane({
  webBundle: {
    manifest: 'packages/daypaw/web-app/package.json',
    patch: 'packages/daypaw/web-app/cordis.patch.yml',
  },
  documentTitle: 'daypaw',
  carrier: () => connectionRpcCarrier(decorateDurableRpc(createFixtureConnectionRpc())),
})

export const installAssembledBootEnv = lane.installAssembledBootEnv
export const mountAssembledApp = lane.mountAssembledApp
```

`installAssembledBootEnv()` registers the per-test jsdom setup (English navigator pin, missing observers, full teardown); `mountAssembledApp(search?, options?)` mounts the lane's roster, minting the carrier transport per mount when the lane has one. The lane options are the whole sync surface: an upstream refactor of the scaffold replaces the module body and re-threads these seams. The [`AssembledBootLaneOptions` contract](src/index.ts) is the exact detail.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Composition derives the browser graph from the same bundle patches and `dsh.client` declarations as `dsh web`, attaching each plugin's built artifact; the lane wraps that with the environment and mount halves. Rows carrying config reach the graph only when the package declares `dsh.client.config`; both lanes' goldens render the English dictionary, so the navigator pin lives in the shared module and the title is the only pinned chrome that differs.

| File | Responsibility |
|---|---|
| [`src/composition.ts`](src/composition.ts) | `loadAssembledPlugins` / `buildBootGraph` / `buildBundleTable` — patch-to-graph derivation and the built-artifact table |
| [`src/index.ts`](src/index.ts) | `createAssembledBootLane` (env + mount binding), `connectionRpcCarrier` (the ClientRequest/ServerResponse bridge), `hasClass`, `REFRESHING_GOLDEN` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`apps/web/tests/assembled-boot.ts`](../../../apps/web/tests/assembled-boot.ts) — the upstream lane's thin entry: upstream bundle layer, no carrier.
- [`apps/daypaw-web/tests/assembled-boot.ts`](../../../apps/daypaw-web/tests/assembled-boot.ts) — the fork lane's thin entry: daypaw bundle layer, durable-decorated carrier.
- [ADR 0015](../../../docs/adr/0015-assembled-boot-shared-scaffold-home.md) — why the scaffold's home is a fork-local parameterized package and when it retires.

-----

<a id="model-experience"></a>
## Model Experience

### Assembled jsdom boot

#### What the model sees

Nothing. `createAssembledBootLane` and `mountAssembledApp` boot a fixture world against built client artifacts; the module registers no prompt, tool, or schema, and nothing here reaches a model request.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Test-plane only** — the module runs under vitest with jsdom; it is never bundled into the served web app, and the `lib/` build exists only for the workspace build layout.
- **Lane options are the sync surface** — an upstream refactor of the scaffold means replacing the module body and re-reading the three option seams (bundle layers, carrier, title); the replay cost is zero when the options are unchanged. Retirement trigger: if upstream builds its own parameterization, evaluate swapping this home on the next sync.
- **Carrier lanes own the `?fixture` rejection** — a carrier lane rejects the `fixture` search key because the fixture rides the carrier hooks; carrier-less lanes keep the upstream default of selecting the fixture transport through the search switch.
- **Not independently published** — the package ships inside the fork's workspace (ADR 0011).

<a id="dev-note"></a>
### Dev Note

**Runtime invariant:** No companion is published. The module is shared test scaffolding whose behavior is pinned by its own specs and by both lanes' golden runs; it holds no independently divergent observation.
