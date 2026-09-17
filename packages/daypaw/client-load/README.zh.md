---
description: "daypaw 浏览器平面 store 载入的最新者胜结算：一个共享守卫让只有最新一次尝试能落笔，各壳 store 保留自己的取数、投影与开始/失败策略"
kind: "package-reference"
---

# @daypaw/client-load

[English](README.md) | 中文

## 概述

`@daypaw/client-load` 给 daypaw 壳的浏览器 store 一个共享的 wire 载入守卫。store 调用 `run()`，交出自己的取数与策略（开始写什么、成功后投影什么、失败写什么）；守卫只让最新一次尝试落笔，被顶替的尝试——数据与拒绝——一律不落。取数、投影与状态策略留在各 store，staleness 规则与其测试只在这里住一份。纯库：无插件、无 Cordis 服务、无配置。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时用它

消费方是 fork 的壳 store：收件箱板块的轮询与任务详情的选择（[`@daypaw/ui-inbox`](../ui-inbox/README.zh.md)）、agent 目录（[`@daypaw/ui-agents`](../ui-agents/README.zh.md)）、关于页事实与首跑密钥卡与凭据页（[`@daypaw/ui-settings`](../ui-settings/README.zh.md)）、新任务弹窗的名册（[`@daypaw/ui-tasks`](../ui-tasks/README.zh.md)）。凡是经 wire 载入、且不能让旧尝试的迟到应答覆盖新尝试的 store，都该用它；不会被顶替的一次性载入不需要它。

### 入口

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

`run()` 在该尝试结算或被丢弃后 resolve，且永不 reject：结果由快照承载。`invalidate()` 只作废在飞尝试、不发起新的，用于 store 自行重置的清空/选择路径。每个 store 持有一个实例——尝试计数就是实例自己的状态，每次调用新建控制器会让每一次尝试都落笔。精确契约见 [`LoadPolicy`](src/index.ts)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

一次尝试在开始时取一个代际号。取数结算后，只有该号仍是最新时这次尝试才落笔，否则直接返回、一字未写。开始写是刻意的例外：它在取数之前同步执行，因此即使后来被顶替，调用者的意图（loading 状态、新选择、已清空的详情）也已在快照里。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `LatestLoad`（守卫）与 `LoadPolicy`（一次尝试的写入策略）——本包的全部表面 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@deepseek-ai/dsh-client-store`](../../client/store/README.zh.md) —— 每次尝试结算进的快照 store（`SnapshotStore`、`createSnapshotStore`、`shallowEqual`）。
- [`@daypaw/ui-inbox`](../ui-inbox/README.zh.md) —— 板块轮询与任务详情选择：天生会重叠的两处载入。
- [ADR 0014](../../../docs/adr/0014-client-load-controller-home.md) —— 为何本家取 fork 局部包而非上游 store 包。

-----

<a id="model-experience"></a>
## Model Experience

### 浏览器平面 store 载入

#### What the model sees

无。`LatestLoad` 只结算浏览器侧 store 快照；不注册任何 prompt、工具或 schema，这里没有任何东西进入模型请求。

#### Token effect

零 live-request token。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **只管最新者胜**——守卫丢弃被顶替的结果；不取消取数、不共享在飞取数、不缓存结果。上游 `ModelCatalogDirectory` 折叠了在飞取数加一次重跑；目前没有壳 store 需要这层。
- **失败写入属于策略**——最新的尝试失败时只写其 `failure` 钩子所写；守卫对错误状态或文案没有意见。
- **不独立发布**——本包随 fork 的浏览器 bundle 一起进产物（ADR 0011）。

<a id="dev-note"></a>
### 开发备注

**运行时 invariant：**不发布 companion。本包是对调用方自有快照 store 的纯结算规则：它不持有可独立分歧的观测，接线由各采用它的 store 自行断言。
