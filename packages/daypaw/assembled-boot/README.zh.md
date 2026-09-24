---
description: "jsdom web 车道的参数化 assembled-boot 脚手架：一个 module 经 AppWebEntry 的 ModuleLoader 路径启动真实构建的 client 花名册，bundle 层、remote 场景与钉制的文档标题作为 lane 选项"
kind: "package-reference"
---

# @daypaw/assembled-boot

[English](README.md) | 中文

## 概述

`@daypaw/assembled-boot` 是两条 web 快照车道 jsdom 启动背后的唯一脚手架。一条 lane 交出自己的事实——组装哪些 bundle 层、哪个 remote 场景世界作为 `__DSH_TRANSPORT__` 载体伺服页面、钉制哪个文档标题——换回基于构建 `lib/client.js` 产物的 `installAssembledBootEnv()` / `mountAssembledApp()`。上游 apps/web e2e 车道与 fork 的 apps/daypaw-web golden 车道以不同选项消费同一 module，脚手架只有一个家，而不再是一对每次 sync 都漂移的近克隆。纯库：无插件、无 Cordis 服务、无配置。

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

消费方是两条 web 车道的 `tests/assembled-boot.ts` 入口：上游车道（[`apps/web/tests/assembled-boot.ts`](../../../apps/web/tests/assembled-boot.ts)，上游 web-app bundle 层与上游 RemoteMock 场景 [`assembled-remote.ts`](../../../apps/web/tests/assembled-remote.ts)）与 fork 车道（[`apps/daypaw-web/tests/assembled-boot.ts`](../../../apps/daypaw-web/tests/assembled-boot.ts)，base 层之上的 daypaw web-app bundle、fork 的 RemoteMock 世界（[`daypaw-remote.ts`](../../../apps/daypaw-web/tests/daypaw-remote.ts)，ADR 0018）rpc 经 fork `durable/*` 装饰器包裹）。只有第三条组装花名册需要 jsdom golden 覆盖时才添新 lane。

### 入口

```ts ignore-check
import { createAssembledBootLane } from '@daypaw/assembled-boot'
import { createDaypawRemote } from './daypaw-remote.ts'
import { decorateDurableRpc } from './durable-rpc.ts'

const lane = await createAssembledBootLane({
  webBundle: {
    dir: 'packages/daypaw/web-app',
    manifest: 'packages/daypaw/web-app/package.json',
  },
  documentTitle: 'daypaw',
  remote: () => {
    const world = createDaypawRemote()
    return { mock: world.mock, rpc: decorateDurableRpc(world.mock.rpc) }
  },
})

export const installAssembledBootEnv = lane.installAssembledBootEnv
export const mountAssembledApp = lane.mountAssembledApp
```

`installAssembledBootEnv()` 注册逐测试的 jsdom 装设（英语 navigator 钉制、缺失的 observers、完整清扫）；`mountAssembledApp(options?)` 挂载该 lane 的花名册，逐挂载铸造 remote 世界并把它的 rpc 装为页面载体；清扫断言该世界未见过未命中的请求。lane 选项就是全部 sync 面：上游重构该脚手架时替换 module 本体、重穿这些缝即可。精确契约见 [`AssembledBootLaneOptions`](src/index.ts)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

组合半边从与 `dsh web` 相同的 bundle patch 与 `dsh.client` 声明推导浏览器图，钉上各插件的构建产物；lane 把它与环境、挂载两半绑在一起。携带 config 的行只有在包声明 `dsh.client.config` 时才进图；两条车道的 golden 都渲染英语词典，因此 navigator 钉制住在共享 module 里，标题是唯一不同的钉制 chrome。

| 文件 | 职责 |
|---|---|
| [`src/composition.ts`](src/composition.ts) | `loadAssembledPlugins` / `buildBootGraph` / `buildBundleTable` —— patch 到图的推导与构建产物表 |
| [`src/index.ts`](src/index.ts) | `createAssembledBootLane`（环境 + 挂载绑定）、`hasClass`、`REFRESHING_GOLDEN` |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`apps/web/tests/assembled-boot.ts`](../../../apps/web/tests/assembled-boot.ts) —— 上游车道的薄入口：上游 bundle 层与上游 RemoteMock 场景。
- [`apps/daypaw-web/tests/assembled-boot.ts`](../../../apps/daypaw-web/tests/assembled-boot.ts) —— fork 车道的薄入口：daypaw bundle 层、fork 世界之上的 durable 装饰 rpc。
- [ADR 0015](../../../docs/adr/0015-assembled-boot-shared-scaffold-home.md) —— 脚手架的家为何取 fork 局部参数化包、何时退役。

-----

<a id="model-experience"></a>
## Model Experience

### 组装 jsdom 启动

#### What the model sees

无。`createAssembledBootLane` 与 `mountAssembledApp` 对着构建产物启动一个 fixture 世界；不注册任何 prompt、工具或 schema，这里没有任何东西进入模型请求。

#### Token effect

零 live-request token。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **仅测试面**——本 module 在 vitest + jsdom 下运行；从不进被伺服的 web app bundle，`lib/` 构建只为 workspace 构建布局而存在。
- **lane 选项就是 sync 面**——上游重构该脚手架意味着替换 module 本体、重读三条选项缝（bundle 层、remote 场景、标题）；选项不变时重放成本为零。退役触发：上游若自建同等参数化，下次 sync 评估换家。
- **不独立发布**——本包随 fork 的 workspace 一起存在（ADR 0011）。

<a id="dev-note"></a>
### 开发备注

**运行时 invariant：**不发布 companion。本 module 是共享测试脚手架，行为由自己的 spec 与两条车道的 golden 运行钉住；不持有可独立分歧的观测。
