# @daypaw/sdk API 表面草图（PROTOTYPE）

> **Throwaway 原型**——分支 `prototype/sdk-api-surface`，不进 main 的 src。回答 [SDK API 表面草图](https://github.com/0xnicholas/daypaw-pro/issues/10)：ADR 0003 敲定的词汇表落成可动手的类型面后，哪些边角是尖的。

## 怎么跑

```
npx -y -p typescript tsc -p prototype/sdk-api --noEmit
```

类型检查即「运行」——本原型的问题是类型面的手感受否正确，不是运行时行为。dsh 类型（`@deepseek-ai/dsh-tools` 等）为本地 stub，形状从上游源码逐字段核对（`packages/core/tools/src/index.ts:222` 等），fork 落地后换真包。

## 内容

- `sdk.d.ts` — `@daypaw/sdk` 草案：defineAgent / defineWorkflow / 五 ctx 原语 / RunHandle / 错误族 / engine attach 面
- `examples/code-reviewer-pipeline.ts` — 端到端：step 数据流、Promise.all 控制流、ctx.agent、dsh tool 直用、start-or-attach
- `examples/approval-gate.ts` — human gate：waitFor 联合类型、终态非异常、step retry、PermanentStepError
- `examples/crash-recovery.ts` — 三个击杀点的账本/重驱动叙事（K1 步中、K2 门等待、K3 spawn 后）

## 尖锐边角（react 清单）

**Q1 子 workflow 等待式调用**（ADR 0003 明确留给本票）：草案取**惯用式**——`ctx.step` 里裸 `def.run()` 等待 `.result`，不加第六原语。前提：引擎从 `(parentRunId, stepKey, occurrence)` 派生**确定性子 runId**，否则崩溃重驱动会 start 出第二个子 run（副作用翻倍）。备选：`ctx.call` 第六原语 / `ctx.agent` 泛化接受 WorkflowDefinition（语义漂：workflow 不挂 session）。

**Q2 step 幂等键**：默认 `runId + name + occurrence` 自动派生；循环/并行分支给 `opts.key` 显式逃生口。_occurrence 计数要求重驱动时遍历顺序确定_——`Promise.all` 的 map 顺序稳定，用户手写乱序 await 则键不稳（记 spec 注记）。

**Q3 错误与重试的类型呈现**：retry 是数据（StepOptions）；`PermanentStepError` 止重试；gate 超时/拒绝 = **联合类型值**（`GateResolution`），永不 throw；`RunHandle.result` 只在 failed/cancelled 时 reject（RunFailedError/RunCancelledError）。LLM 级重试留在 dsh llm-retry waterfall，不进 SDK 面。`RunStatus` 用判别联合（`{state:'waiting', gate}`），比 ADR 草记的 `'waiting:<gate>'` 字符串更尖——提案修订 ADR 字面。

**Q4 tool 复用**：`tools: ToolDefinition[]` 直收 dsh 定义，零适配器（草案已验证形状对齐）。代价：**两套 schema 系统并存**——定义 IO 用 zod，tool 参数用 dsh `ParameterSchemaSpec`（其 JSON Schema 子集非 zod）。统一（zod→dsh 编译层）v1 不做，接受并存。

**Q5 step 结果的序列化约束**：`step<T>` 的 T 须 JSON 可序列化（ledger 落账）。草案**运行时校验**（写账时验证）；编译期约束（`T extends Json`）会与 zod 推断的 optional 字段（`| undefined`）打架，不做——记 spec 注记。

**Q6 静态组合行**：defineAgent 的 prompt/tools/model 是静态字段；`compose(input)` 动态组合（按输入选工具面子集）留口未开——EVO 变体算子是纯静态维度，v1 够用。

## 判据

用户读完示例代码后的直接反应：**这像不像你想天天写的东西**。不像的地方就是 spec 第 2 章要改写的边。
