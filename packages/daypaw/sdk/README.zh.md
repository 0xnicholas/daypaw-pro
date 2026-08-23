# @daypaw/sdk

[English](README.md) | 中文

daypaw durable 引擎的类型化 facade：`defineWorkflow` 声明代码编排 run，`defineAgent` 声明声明式 LLM 循环 spec，`bind` / `bindAgent` 把它们挂到宿主组合。两个面都返回 `run()`（幂等 start-or-attach）与类型化 `RunHandle`。类型权威：[spec 第 2 章 §1.1/§1.2](../../../docs/spec/02-agent-engine-sdk.md)；编程模型决策：[ADR 0003](../../../docs/adr/0003-engine-sdk-programming-model.md) 与 [ADR 0010](../../../docs/adr/0010-define-agent-compilation-and-execution.md)。

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
- `ctx.waitFor(gate, { schema?, timeout? })` —— durable gate（HITL 挂起）：body 内挂起 run（`status()` 报 `{state:'waiting', gate}`），等待零算力、进程可退出；结局以 `GateResolution` 联合值返回（`resolved` / `rejected` / `timedout` / `cancelled`，终态非异常）。经 `ctx.durable.resolveGate(runId, gate, settlement, source)` 结算，first-wins 幂等；zod `schema` 在写入侧与投递侧双重校验。
- 错误 —— 引擎失败以 `RunFailedError`（附 cause）浮出，取消以 `RunCancelledError`；输入/输出契约违反以 zod 错误 reject。

### Agents（ADR 0010）

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

- `defineAgent(options)` —— 声明式 spec：身份、zod 契约、静态组合行（prompt 段、dsh 工具、模型路由），以及声明期校验的必填 `maxTurns` 预算。
- `bindAgent(def, ctx)` —— 把 spec 编译为不透明引擎 body（引擎对 `kind: 'agent'` 无感知）并登记供执行与 boot 复活。宿主 Context 必须挂 `ctx.durable`、dsh agent 栈（`agents`、`sessions`）与 session persistence 后端；缺任一则 bind 期 loud throw。同一定义对象重复绑定是 no-op，返回首个 face——闭包锁定首个宿主 Context。
- 一次 agent run = 一个 dsh session，sessionId ≡ runId：首驱动 create，复活 resume 并以合成续跑消息唤醒。每个 dsh step 落一条引擎 journal step（`dsh-step:<turn>:<step>`），重驱动的 body 重放 session log 而不再调模型。
- `ctx.agent(def, input)` —— 确定性派生子 runId（`<parentRunId>/<stepKey>/<kind>:<name>#<occurrence>`）上的等待式子 run，父子联接记 ledger；裸子 workflow 惯用式（`ctx.step` 内 `child.run()`）共享同一派生机制。

## Model Experience

### Stored domain records

#### What the model sees

`defineWorkflow` / `bind` 不贡献任何内容——它们为模型调用之上的编排层提供类型。`defineAgent` 拥有自己完整的模型可见面：声明的 prompt 段组装进系统提示，注入的 `submit` 工具以输出契约为参数 schema，run 输入成为首条 user message，复活的 run 由一条点名重启的合成续跑消息唤醒。

#### Token effect

workflow 面：零 live-request token。agent 面：静态 prompt 段与 `submit` schema 随 run 的每次请求；续跑 steer 与崩溃半轮的失败尝试留在 resume 后的上下文里（耐久的诚实代价，ADR 0010 §5）。

#### KV Cache effect

prompt 段与工具表按定义稳定，一个 run 的请求共享一个前缀；复活只追加（steer 消息、新 turn），不改写历史。

## Known Limitations and Deferred Work

- **仅静态组合行** —— 动态 `compose(input)` 逃生口在 ADR 0010 声明但未开放；EVO 变体算子以静态维度为目标。
- **`ctx.spawn` 排除** —— 火后不管子 run 不在 ADR 0010 §4 范围内；`ctx.agent` 是等待式形态。
- **agent run 必须有 persistence 后端** —— 缺失时 `bindAgent` loud throw：耐久是 agent 面的存在理由，不是可选项。
- **retry 面推迟** —— `StepOptions.retry` 与 `PermanentStepError` 随 retry 迁移到来；v1 首次 step 失败即 run failed。
- **`meta` 仅调用方侧** —— 走骨不落盘；见引擎 README。
- **`@daypaw/engine` / `@daypaw/store` 不独立发布** —— 随本 tarball vendored（ADR 0011）；经本包 import 其面，绝不直接引用。
