# Agent Note: defineAgent compilation — engine-owned child runIds, bind-time persistence, pre-wake turn budget

Status: implemented

[English](2026-08-22-define-agent-compilation.md) | 中文

## Problem

ADR 0010 §4 已裁 defineAgent 面——声明式 spec 编译为不透明引擎 body、确定性子 runId、`ctx.agent` 语法糖、裸子 workflow 惯用式——但留下四个实现决策：子 runId 派生归哪个包（ADR 正文写 SDK 派生；spec 第 2 章 §2 写引擎派生）、当 session 事件派发于 session store 作用域而非 agent 作用域时 `maxTurns` 如何执行、重驱动的 body 如何跨越 run 行插入与 agent 创建之间的崩溃窗口判别 create 与 resume、session persistence 后端是否可选。

## Decision

- **派生归引擎** —— `step()` 在 body await 期间经模块级 `AsyncLocalStorage` 发布 `EngineStepScope`（`{ runId, stepKey }`）；无显式 runId 的 `run()` 从 ambient 作用域派生 `<runId>/<stepKey>/<kind>:<name>#<occurrence>` 并在插入时记录 `parent_run_id` / `parent_step_key`（attach 不改写血缘）。SDK 在 `startRun` 消费该作用域；spec 第 2 章 §2 为准，ADR 0010 §4 的文字差异以此为准。step ctx 另暴露 `runId` 与驱动者 `signal`——signal 存在是因为等待 agent quiescence 不跨 step 边界，取消只能靠与它 race 到达轮中等待。
- **persistence 在 bind 期强制** —— 缺 `ctx.durable`、`agents`/`sessions` 服务或 `sessionPersistence` 后端，`bindAgent` 一律 loud throw。耐久是 agent 面的存在理由；静默的易失 agent run 是配置错误，不是一种模式。
- **create vs resume 看持久化 session** —— persistence 列表里存在 `sessionId ≡ runId` 的 session 即走 resume，覆盖 run 行插入后的崩溃窗口；run 行本身无法区分两者。
- **`maxTurns` 为唤醒前预算检查** —— 一次唤醒恰好跑一个 turn 到 quiescence，故唤醒（或 steer 复活 session）前数 `turn/start` 事件，预算已尽即失败。不用 live listener：`session/event` 派发于 session store 的载体作用域，挂在 agent Context 上的监听器永远收不到。
- **一个 dsh step = 一条 journal step** —— quiescence 后 body 遍历 session log，配对 `step/start`..`step/end`，每段记于 `dsh-step:<turn>:<step>`；重驱动的 body 以同序重走 resume 的 log，引擎去重返回已记录切片。journal 的 `session_id` / `session_seq` 列 v1 不用——step 键加 `sessionId ≡ runId` 已指名来源；有消费者需要时再启用。
- **SDK 注入 `submit` 工具** —— args schema = 输出契约（非 object 根包 `{value}` 单参数）；二次调用抛错；捕获值经输出 schema 校验后 run 才 resolve。复活以固定的英文续跑消息 steer 复活后的 agent（点名重启；dsh 无无内容唤醒）。`ctx.agent(def, input)` 自身即父步 `agent:<name>`，在派生子 runId 上等待子 run；同一定义对象重复绑定返回首个 face（WeakMap），其闭包锁定首个宿主 Context。

## Alternatives considered

- **SDK 侧派生（ADR 0010 §4 的字面读法）** —— 否决：occurrence 计数与重驱动确定性是引擎不变量（引擎拥有 step 键分配）；拆到两个包会让两者漂移。ADR 的机制（`ctx.agent` 与子 workflow 惯用式共享确定性派生）不变，仅归属移动，由本笔记钉死。
- **`maxTurns` 用 live turn listener** —— 否决：事件载体作用域在 store 侧，监听器永远不会触发；唤醒前检查因「一次唤醒一个 turn」而是精确的。
- **可选 persistence（告警后易失运行）** —— 否决：配置错误在最早可解析点 loud fail；静默 fallback 会以「首次重启后 run 丢失」的形式浮出。
- **基于 run 行的 resume 判别** —— 否决：run 插入与 agent 创建之间的崩溃会对不存在的 session 走 resume 路径。
- **仅 step 边界取消** —— 否决：quiescence 等待没有 step 边界；缺 signal race 时取消会挂到模型该轮结束。

## Consequences

- 免 key 快照（`examples/daypaw-skeleton/tests/agent.snapshot.ts`）经真实示例宿主钉住模型可见面——persona 段、`submit` schema、输入消息，以及 SIGKILL 后的合成续跑 steer——fixture 为手写 replay override，无需 API key；未来有 key 的场景仍走录制。
- 编译闭包把整个 LLM 世界集中在 `packages/daypaw/sdk/src/agent.ts`；引擎只增加 step 作用域、`runId`/`signal` 暴露与父子血缘列（已在 migration 0001）——无任何 agent 感知。
- 已接受的代价（ADR 0010 §5）：续跑 steer 与崩溃半轮的失败尝试留在 resume 后的上下文；并发的第二个宿主组合必须重新声明定义（首个 face 的闭包绑定在自己的 Context 上）。
- 相关：[daypaw walking skeleton](2026-08-19-daypaw-walking-skeleton.zh.md) 拥有本面所乘的 attach/boot 扫描语义。
