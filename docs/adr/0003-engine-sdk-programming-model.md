# ADR 0003: Engine 与 SDK 编程模型边界（Agent Engine + SDK）

- **状态**：已接受（2026-08-30，[Engine 与 SDK 编程模型边界](https://github.com/0xnicholas/daypaw-pro/issues/7)）
- **参照**：Palantir Agent Engine/SDK（DevCon 6，`docs/research/palantir-agent-stack.md`；注意：其 Agent SDK 无公开 API 文档，参照系是概念级而非接口级）+ dsh seam 清点（`research/dsh-seam-inventory.md`，分支）
- **前置**：ADR 0002（嵌入式引擎、step 去重续跑、`ctx.waitFor`、engine ledger）

## 决策

### 1. 两类定义、一个 run 概念

`defineAgent` 与 `defineWorkflow` 是 SDK 的两个定义动词，**共享同一个 run 概念**：

- **Agent 定义 = 声明式 spec**：name + version + zod 输入/输出 + 组合行（prompt 段、工具面、模型路由）。无用户代码——循环由 dsh agent loop 驱动，`outputSchema` 收口。
- **Workflow 定义 = 代码编排体**：用户 async 函数，引擎执行，内可调 agent / 子 run / gate / timer。
- ledger / Manager / EVO 只认 run，不区分「单会话体」与「编排体」。
- `agent.run(input)` 是一等公民（Palantir「published agent = async function」的对应物）——EVO 并行变体、Manager 重跑直接受益。
- 「agent 调 agent」不强制经过 workflow：仍走 dsh subagent seam（one-shot / continuable，进程内或跨进程 provider 照旧）。

否决：Temporal 式「仅 workflow 可 run」（单跑 agent 永远隔一层样板）；单概念 `defineAgent`（spec 形 vs 代码形藏进配置，run 分类在类型上不可见，且与 Engine/Orchestrator 分层参照不对应）。

**Palantir 事实记录**：Palantir 只有一个 authored 概念（agent，由 Context Items/Events/Effects 三原语组成），durable execution 是基础设施层非词汇表。daypaw 不能照搬的原因：Palantir 引擎重放状态机、控制流是涌现的；ADR 0002 已定 DBOS 谱系——run 执行真实代码 + step 去重，代码体与声明式 spec 是两种真实的 body，SDK 诚实命名这一差异。

### 2. 词汇表：五个 ctx 原语，引擎原生命名

workflow body 可用的显式原语：

| 原语 | 语义 |
|---|---|
| `ctx.step(name, fn)` | 去重执行单元；恢复时按幂等键查 ledger，已完成直接返回已记录结果 |
| `ctx.sleep(duration)` | 持久 timer（ADR 0002 决策 2） |
| `ctx.waitFor(gate, {schema, timeout})` | durable promise / HITL gate（ADR 0002 决策 5） |
| `ctx.agent(def, input)` | 调 agent 定义（挂 session、应用组合） |
| `ctx.spawn(def, input)` | 火后不管子 run（ledger 记父子链，boot 扫描独立复活） |

parallel = `Promise.all`、condition = `if`/`try`——**普通 TypeScript，不是原语**（与无确定性约束的恢复谱系一致）。

**不进口 Palantir 三原语作 API 名**：`Event` 与 dsh `session/event` 撞名、`Context` 与 `packages/context` 撞名——同词异义比不同词更乱；且 Palantir 无公开 API 可对标，进口的是营销词而非实测接口。同构关系（Context Items ↔ 类型化状态、Events ↔ session/event、Effects ↔ step 内副作用）记入文档，不占 API 名。

### 3. defineAgent ↔ dsh 组合：程序化组合 + 定义注册表

- defineAgent 注册进**进程内定义注册表**（键 = name + version），不生成文件系统 preset 目录。
- run 时挂一个 session、应用组合行——与 preset **同一挂载语义**，不同来源（代码 vs 文件）。
- session header 记 `(定义 id, 版本)`：冷复活按 header 重建组合（dsh 已有机制，见 subagent descriptor / preset id 先例）。
- ledger run 行记定义版本——EVO incumbent/candidate 同名不同版本并行跑的前提（ADR 0002 决策 7 预留的兑现）。
- 一次 agent run = 一个**主 session**；subagent 子女自拥 session，经 ledger 引用不散射。
- workflow run **无主 session**——session 只在 `ctx.agent` 处产生；编排体是纯代码，不占会话身份。
- preset 文件系统照旧服务 dsh 原生用法，两路互不干扰；EVO 日后可选把变体发布为 preset（发布物形态归 EVO 票）。

### 4. run() 语义：幂等 start-or-attach + RunHandle

- `def.run(input, { runId? })`：runId 已存在则 **attach**（返回已有 run 的句柄与结果），不存在则启动——调用幂等，崩溃重启后同一调用自动接回原 run。
- `RunHandle = { id, result: Promise<T>, status(), cancel(cause), meta }`；`status()` 可见 `'running' | 'waiting:<gate>' | 'done' | ...`（Manager 的数据底座）。
- **结果 = output schema 校验后的类型化输出**——run 级因果归因在引擎层解决，不继承 dsh wire `finalResponse` 无归因的缺陷。
- 持久身份 = runId；内存 promise 诚实地不承诺跨进程——跨进程重连走 attach。
- boot 扫描复活未完 run **不需要原调用者**；`ctx.spawn` 的子 run 同样被独立复活。

### 5. 进程形态：v1 纯库，API 运输无关留口

- v1：SDK 是**纯库**——define / run / RunHandle 是应用自己 Cordis 组合里的进程内嵌引擎（ADR 0002 插件族）之上的 facade，无 wire、无子进程。
- API 面设计成**运输无关**：日后可投影到扩展过的 wire，但今天不扩 wire——wire 现缺 cancel / run 级结果 / attach / 控制操作，双后端现在做不出真等价；等价性谎言（cancel 在 A 有 B 无）比不等价更危险。wire 扩展面由 Manager 票（控制面需要什么）裁决。
- worker / queue：v1 无。**进程即 worker，ledger 未完 run 即队列，boot 扫描即拉起**；journal 读写 / promise 解析 / timer 调度三个可替换接口（ADR 0002 决策 2）就是日后 daemon 化 / 服务化 / 多 worker 的缝。

## 后果

- 引擎包结构（`packages/daypaw/` 切分）雾区毕业成票：engine 与 sdk 的边界已由本 ADR + ADR 0002 定形。
- 子 workflow 的等待式调用（`ctx.spawn` 之外的 awaited 子 run 原语形态）与 API 表面细节归 [SDK API 表面草图] 原型票细化。
- spec 第 2 章骨架输入：`docs/spec/02-agent-engine-sdk.md`。
