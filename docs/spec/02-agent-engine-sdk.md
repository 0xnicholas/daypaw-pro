# 第 2 章：Agent Engine + SDK（骨架输入）

> 状态：**骨架输入**——结构已定，内容待 spec 撰写期填充。决策依据 [ADR 0003](../adr/0003-engine-sdk-programming-model.md)；引擎语义见 ADR 0002 与 spec 第 1 章。

## 1. 编程模型

两类定义、一个 run 概念（ADR 0003 §1）：`defineAgent`（声明式 spec）/ `defineWorkflow`（代码编排体）/ `run()` 一等公民。示例代码、类型签名：待写。

## 2. ctx 原语面

五原语：`step` / `sleep` / `waitFor` / `agent` / `spawn`（ADR 0003 §2）。各原语的参数、返回、ledger 事件映射：待写。已定型（[SDK API 表面草图](https://github.com/0xnicholas/daypaw-pro/tree/prototype/sdk-api-surface) 原型验证，类型草案 `prototype/sdk-api/sdk.d.ts`）：

- **子 workflow 等待式调用 = 惯用式**，不加第六原语：`ctx.step` 内裸 `def.run()` 等待 `.result`；前提是引擎从 `(parentRunId, stepKey, occurrence)` 派生**确定性子 runId**（重驱动 attach 而非重开，副作用不翻倍）。
- **step 幂等键**：默认 `runId + name + occurrence` 自动派生（重驱动遍历顺序须确定，map 顺序稳定、手写乱序 await 不稳——运维注记）；`opts.key` 显式逃生口。
- **错误与门结局**：gate 超时/拒绝 = 联合类型值 `GateResolution`（终态非异常，ADR 0002 §5 的类型化呈现）；`RunStatus` 用判别联合（`{state:'waiting', gate}` 等，修订 ADR 0003 的 `'waiting:<gate>'` 字符串草案）；`PermanentStepError` 止重试；`RunHandle.result` 仅 failed/cancelled 时 reject；LLM 级重试留 dsh llm-retry waterfall，不进 SDK 面。
- **step 结果序列化**：运行时校验（ledger 写账时），编译期 `T extends Json` 约束与 zod optional 推断冲突，不做。

## 3. 定义注册表与组合

程序化组合 + 定义注册表（ADR 0003 §3）：name+version 身份、session header 重建、与 preset 的双路并存。已定型（原型验证）：`tools` 直收 dsh `ToolDefinition`（零适配器，形状对上游源码核实）；接受两套 schema 并存（定义 IO = zod，tool 参数 = dsh spec），统一层 v1 不做；组合行 v1 静态字段（`compose(input)` 动态组合留口未开，EVO 变体算子均为静态维度）。版本语义细节（兼容规则、EVO 变体命名）：待写。

## 4. run 生命周期

幂等 start-or-attach、RunHandle、类型化结果、cancel、boot 扫描复活（ADR 0003 §4）。与 engine ledger 的事件序列（run/start、step/*、effect、promise、timer）逐条对表：待写，与第 1 章交叉引用。

## 5. 进程形态与部署

v1 纯库、运输无关 API、进程即 worker / ledger 即队列（ADR 0003 §5）。daemon 化路径（三 Provider 替换）：运维注记待写。wire 扩展面：指针到 Manager 章（该章定夺）。

## 6. 与 dsh 既有概念的关系表

preset / composition / session / subagent seam / `session/event` ↔ 新模型的对应与边界（素材：seam 清点 §①⑤、ADR 0003 §1/§3）：待写。

## 7. 测试面

[ADR 0007](../adr/0007-test-strategy.md) 定调：

- **崩溃/重放双层**（engine 本体，keyless）：主力 = 进程内故障注入——包装 ledger 写入层，穷举「每个 append 点前后抛异常」，配注入时钟跨「重启」推进 durable timer；断言每 effect 恰执行一次、重放不重不漏、step 去重、gate 状态机、boot 扫描。补充 = 真 SIGKILL——tsx spawn 子进程跑 run、杀掉、重启验恢复（半写路径/文件锁）；如需进上游 `processBoundTests` 单列 lane 则逐条 core-touch 登记。
- **SDK 行为面**：跑真 engine（进程内 + 临时目录 SQLite，mock 边界仅 LLM/时钟）；五原语各配契约测试（含确定性子 runId 派生、`opts.key` 逃生口、GateResolution/RunStatus 判别联合）；tsc 类型面独立断言套件（[SDK API 表面草图](https://github.com/0xnicholas/daypaw-pro/issues/10)原型路径）。
- **REAL-composition**：`ctx.durable` 插件族配测试专用 `cordis.yml` 走真 Loader 的组合测试；canonical example（walking skeleton 宿主，`examples/daypaw-*`）拥有 keyless snapshot + with-key smoke（无 key 自跳）。
- **invariant companion**：engine 包必须带 `src/invariant.ts`（上游 glob 约定自动接入不变量宿主，缺即 throw）。
- **覆盖率**：per-file 100% 门（CI ci-coverage lane）。
- 待写：§4 生命周期 ↔ ledger 事件序列对表的逐条断言清单；故障注入包装器在 engine 包内的 seam 设计。
