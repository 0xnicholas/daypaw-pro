# 第 2 章：Agent Engine + SDK（workflow 面写满，defineAgent 面已裁）

> 状态：**workflow 面已写满**（批次 C 开工输入）；**defineAgent 面已裁**（ADR 0010 十一裁决，随支柱②里程碑实现；类型面随实现折入）。决策依据 [ADR 0003](../adr/0003-engine-sdk-programming-model.md) / [ADR 0010](../adr/0010-define-agent-compilation-and-execution.md)；引擎语义见 ADR 0002 与 spec 第 1 章。

## 1. 编程模型

两类定义、一个 run 概念（ADR 0003 §1）：`defineAgent`（声明式 spec）/ `defineWorkflow`（代码编排体）/ `run()` 一等公民。

### 1.1 workflow 面正典类型（批次 C 实现面）

绑定缝（实现落定）：`defineWorkflow` 返回未绑定定义，`bind(def, engine)` 挂到 `ctx.durable` 并返回 `run(input, opts)` 面；同一定义对象重复绑定 no-op。

```ts ignore-check
// @daypaw/sdk —— 批次 C 正典类型面（完整 ambient 草案见原型分支 prototype/sdk-api-surface）
import type { ZodType } from 'zod'
type Infer<I extends ZodType> = I['_output']

export interface DefineWorkflowOptions<I extends ZodType, O extends ZodType> {
  readonly name: string
  readonly version: string
  readonly input: I
  readonly output: O
  /** 用户 async body；引擎执行，恢复时按幂等键去重（ADR 0002 §4）。 */
  body(ctx: WorkflowCtx, input: Infer<I>): Promise<Infer<O>>
}

export interface WorkflowDefinition<I extends ZodType, O extends ZodType> {
  readonly kind: 'workflow'
  readonly name: string
  readonly version: string
  /** 幂等 start-or-attach（ADR 0003 §4；语义见 §4）。 */
  run(input: Infer<I>, opts?: RunOptions): RunHandle<Infer<O>>
}

export declare function defineWorkflow<I extends ZodType, O extends ZodType>(
  options: DefineWorkflowOptions<I, O>,
): WorkflowDefinition<I, O>

export interface RunOptions {
  /** 持久身份；同 runId 已存在则 attach。 */
  readonly runId?: string
  readonly signal?: AbortSignal
  readonly meta?: Record<string, unknown>
}

/** 判别联合；`done` 为正典终态名（spec 01 §3.1 持久形）。 */
export type RunStatus =
  | { readonly state: 'running' }
  | { readonly state: 'waiting'; readonly gate: string }
  | { readonly state: 'done' }
  | { readonly state: 'failed'; readonly error: unknown }
  | { readonly state: 'cancelled'; readonly cause?: string }

export interface RunHandle<T> {
  readonly id: string
  readonly definition: { readonly name: string; readonly version: string }
  /** done → resolve（output schema 校验后的类型化结果）；failed/cancelled → reject。 */
  readonly result: Promise<T>
  status(): RunStatus
  cancel(cause?: string): Promise<void>
  readonly meta: Record<string, unknown>
}

export interface WorkflowCtx {
  /** 幂等执行单元；恢复时已完成 step 直接返回已记录结果。 */
  step<T>(name: string, fn: () => Promise<T>, opts?: StepOptions): Promise<T>
  // sleep / waitFor / agent / spawn：语义已定（§2），按需落地（简化走查裁决）
}

export interface StepOptions {
  /** 显式幂等键逃生口；默认引擎派生 runId + name + occurrence。 */
  readonly key?: string
}
```

**折入时的对齐裁决**（原型草案 → 正典）：`succeeded` 并入 `done`（spec 01 §3.1 为正典）；`GateResolution` 以 spec 01 §6 四态为准（补 `cancelled` 变体）；`opts.retry` / `PermanentStepError` 随 retry 面推迟（简化走查裁决）；错误类族（`RunFailedError` / `RunCancelledError` / `StepFailedError`）见原型草案，随实现落地。

### 1.2 defineAgent 面（ADR 0010 已裁）

编译与绑定：`defineAgent` 返回声明式定义（组合行静态：prompt 段 + dsh `ToolDefinition` 零适配 + ModelRoute，动态 `compose(input)` 留口未开）；`bindAgent(def, ctx)` 把 spec 编译为不透明 body 交引擎注册表（引擎盲），闭包捕获宿主 Context（`ctx.durable`/`ctx.agents`/`installModelSelection`，headless bundle 同式）。类型面（`AgentComposition` / `DefineAgentOptions` / `ctx.agent` 签名）已在原型分支 tsc 验证，随实现折入。

执行语义（ADR 0010 §2–§5）：一个 dsh step（组装 + 可能多路并行调用 + 工具执行）= 一条 journal step，记录值 = 完整结果上下文；submit 工具约定终止（SDK 注入，args schema = output schema，模型自然收尾，pre-step rejection 式零成本终止留作优化）；输入 = 首条 user message；sessionId ≡ runId，复活 resume 接回 + 合成续跑消息 steer 唤醒（dsh 无无内容唤醒）；`ctx.agent(def, input)` = 确定性子 runId 派生上的语法糖（与子 workflow 惯用式共享机制），两级各自耐久；轮内 LLM 瞬态失败归 dsh llm-retry（不改 occurrence 序），step 级失败才落 journal。运维注记：合成续跑消息与崩溃半轮的冗余失败尝试留在上下文 = defineAgent 的诚实代价。

## 2. ctx 原语面

五原语：`step` / `sleep` / `waitFor` / `agent` / `spawn`（ADR 0003 §2）。`step`/`agent` 面已定案（上节与 ADR 0010）；`sleep`/`waitFor` 语义 spec 01 §6 已定、按需落地；`spawn` 语义未设计（ADR 0010 §4 排除）。已定型（[SDK API 表面草图](https://github.com/0xnicholas/daypaw-pro/tree/prototype/sdk-api-surface) 原型验证，类型草案 `prototype/sdk-api/sdk.d.ts`）：

- **子 workflow 等待式调用 = 惯用式**，不加第六原语：`ctx.step` 内裸 `def.run()` 等待 `.result`；前提是引擎从 `(parentRunId, stepKey, occurrence)` 派生**确定性子 runId**（重驱动 attach 而非重开，副作用不翻倍）。
- **step 幂等键**：默认 `runId + name + occurrence` 自动派生（重驱动遍历顺序须确定，map 顺序稳定、手写乱序 await 不稳——运维注记）；`opts.key` 显式逃生口。
- **错误与门结局**：gate 超时/拒绝 = 联合类型值 `GateResolution`（终态非异常，ADR 0002 §5 的类型化呈现，四态含 `cancelled` 以 spec 01 §6 为准）；`RunStatus` 用判别联合（`{state:'waiting', gate}` 等，修订 ADR 0003 的 `'waiting:<gate>'` 字符串草案）；（retry 面）`PermanentStepError` 止重试——随 retry 面推迟；`RunHandle.result` 仅 failed/cancelled 时 reject；LLM 级重试留 dsh llm-retry waterfall，不进 SDK 面。
- **step 结果序列化**：运行时校验（ledger 写账时），编译期 `T extends Json` 约束与 zod optional 推断冲突，不做。

## 3. 定义注册表与组合

程序化组合 + 定义注册表（ADR 0003 §3）：name+version 身份、session header 重建、与 preset 的双路并存。已定型（原型验证）：`tools` 直收 dsh `ToolDefinition`（零适配器，形状对上游源码核实）；接受两套 schema 并存（定义 IO = zod，tool 参数 = dsh spec），统一层 v1 不做；组合行 v1 静态字段（`compose(input)` 动态组合留口未开，EVO 变体算子均为静态维度）。版本语义细节（兼容规则、EVO 变体命名）：待写。

## 4. run 生命周期（workflow 面）

幂等 start-or-attach、RunHandle、类型化结果、cancel、boot 扫描复活（ADR 0003 §4）；引擎侧语义见 spec 01 §5。SDK 调用 ↔ ledger 动作对表：

| SDK 面 | ledger 动作（spec 01 §3/§5） | RunHandle 表现 |
|---|---|---|
| `def.run(input, {runId?})`，无行 | INSERT `runs`（`running`，记 `(def_kind, def_name, def_version, input_json)`）+ 开始驱动 | `result` pending |
| `def.run`，已有行 | attach 三态：本进程在驱动→挂完成通知；终态→直读行；他进程驱动→`pollMs` 轮询 | 终态直接 settle |
| `ctx.step(name, fn)` | INSERT `journal` `started` → 执行 → `completed`+`value_json` / `failed`+`error_json`（PK `(run_id, step_key)` 即去重闸） | — |
| 重驱动遇已完成 step | 读 `value_json` 返回，不重执行 | — |
| `ctx.waitFor` / `ctx.sleep`（按需落地） | `promises` 行 pending + `runs`→`waiting`/`waiting_gate`；`timers` 行 `wake_at` | `status()` = `{state:'waiting', gate}` |
| `handle.cancel(cause)` | UPDATE `runs`→`cancelled`+`cancel_cause` → driver AbortSignal | `result` reject `RunCancelledError` |
| step 失败（v1 无 retry 面） | `journal` `failed` + `runs`→`failed`+`error_json` | `result` reject `RunFailedError` |
| 成功收尾 | output schema 校验后写 `output_json`，`runs`→`done` | `result` resolve 类型化结果 |
| boot 扫描复活 | claim 条件更新认领 → 重驱动（不需原调用者） | `status()` 随行变化 |

## 5. 进程形态与部署

v1 纯库、运输无关 API、进程即 worker / ledger 即队列（ADR 0003 §5）。daemon 化路径（三 Provider 替换）：运维注记待写。wire 扩展面：随③子项目裁决（spec 03 方向文档；「SDK wire vs Web Remote 面」消歧见 ADR 0004 §7 注记）。

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
