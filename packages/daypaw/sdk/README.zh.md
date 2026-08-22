# @daypaw/sdk

[English](README.md) | 中文

daypaw durable 引擎的类型化 facade：`defineWorkflow` 声明代码编排 run，`bind` 把它挂到 `ctx.durable` 服务，返回的可运行面提供 `run()`（幂等 start-or-attach）与类型化 `RunHandle`。类型权威：[spec 第 2 章 §1.1](../../../docs/spec/02-agent-engine-sdk.md)；编程模型决策：[ADR 0003](../../../docs/adr/0003-engine-sdk-programming-model.md)。

## 安装

```sh
npm i @daypaw/sdk @deepseek-ai/cordis@~4.0.1 @deepseek-ai/dsh-invariants@~0.1.0-rc.3 zod@^4.4.3
npm i -D @types/node
```

tarball 自包含：`@daypaw/engine` 与 `@daypaw/store` 随包 vendored（[ADR 0011](../../../docs/adr/0011-customer-self-run-delivery.md)）。peer 是消费方自备的单例——`@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-invariants` 从上游 npm 发布解析，`zod` 为定义契约提供类型。typecheck 需要 `@types/node`：vendored 的 engine/store 声明引用了 `node:sqlite`。

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

- `defineWorkflow(options)` —— 身份、zod 输入/输出契约、step body；返回未绑定定义。
- `bind(def, engine)` —— 登记供执行与 boot 复活（同一定义对象重复绑定是 no-op），返回 `{ run(input, opts?) }`。
- `DurableEngine` —— 引擎 Cordis 插件类的再导出，消费方无需直接 import vendored 的 `@daypaw/engine` 副本。
- `RunHandle` —— `id`、`definition`、类型化 `result`（启动前校验输入，resolve 前校验输出）、`status()`（`RunStatus` 判别联合）、`cancel(cause?)`、`meta`。
- 错误 —— 引擎失败以 `RunFailedError`（附 cause）浮出，取消以 `RunCancelledError`；输入/输出契约违反以 zod 错误 reject。

## Model Experience

### Stored domain records

#### What the model sees

无。SDK 不贡献 prompt、工具或 schema；`defineWorkflow` 与 `bind` 为模型调用之上的编排层提供类型。

#### Token effect

零 live-request token。

#### KV Cache effect

无——SDK 永不触碰 live request 前缀。

## Known Limitations and Deferred Work

- **仅 workflow 面** —— `defineAgent`（声明式 spec + 组合行）随支柱②里程碑落地（ADR 0009 frame）；引擎注册表已接受 `agent` 类记录。
- **retry 面推迟** —— `StepOptions.retry` 与 `PermanentStepError` 随 retry 迁移到来；v1 首次 step 失败即 run failed。
- **`meta` 仅调用方侧** —— 走骨不落盘；见引擎 README。
- **`@daypaw/engine` / `@daypaw/store` 不独立发布** —— 随本 tarball vendored（ADR 0011）；经本包 import 其面，绝不直接引用。
