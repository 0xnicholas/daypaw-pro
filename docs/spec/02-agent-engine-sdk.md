# 第 2 章：Agent Engine + SDK（workflow 面写满，defineAgent 面已裁）

> 状态：**workflow 面与 defineAgent 面均已实现**（支柱②落地 ADR 0010 §4 范围：defineAgent/bindAgent + 确定性子 runId 派生 + `ctx.agent` + 子 workflow 惯用式；`ctx.spawn` 仍排除）。决策依据 [ADR 0003](../adr/0003-engine-sdk-programming-model.md) / [ADR 0010](../adr/0010-define-agent-compilation-and-execution.md)；引擎语义见 ADR 0002 与 spec 第 1 章。

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
  run(input: Infer<I>, opts?: RunOptions): RunHandle<Infer<O>, Infer<I>>
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

export interface RunHandle<T, I = unknown> {
  readonly id: string
  readonly definition: { readonly name: string; readonly version: string }
  /** done → resolve（output schema 校验后的类型化结果）；failed/cancelled → reject。 */
  readonly result: Promise<T>
  status(): RunStatus
  cancel(cause?: string): Promise<void>
  /** 追问段（issue #53）：先按定义输入契约校验，落账 journal segment，run 在下一个段边界以同一 runId 消费；终态 run 与未 opt-in 定义 loud 失败。 */
  steer(input: I): Promise<void>
  readonly meta: Record<string, unknown>
}

export interface WorkflowCtx {
  /** 幂等执行单元；恢复时已完成 step 直接返回已记录结果。 */
  step<T>(name: string, fn: () => Promise<T>, opts?: StepOptions): Promise<T>
  /** durable gate（HITL 挂起，spec 01 §6）；终态以 GateResolution 联合值返回。 */
  waitFor<T = unknown>(gate: string, opts?: WaitForOptions<T>): Promise<GateResolution<T>>
  // sleep / agent / spawn：sleep 语义已定（§2）按需落地；agent 见 §1.2；spawn 未设计
}

export interface StepOptions {
  /** 显式幂等键逃生口；默认引擎派生 runId + name + occurrence。 */
  readonly key?: string
}

export interface WaitForOptions<T> {
  /** 值契约（zod）；写入侧与投递侧双重校验。 */
  readonly schema?: ZodType<T>
  /** 超时毫秒时长；自 gate 首次登记起算。 */
  readonly timeout?: number
}
```

**折入时的对齐裁决**（原型草案 → 正典）：`succeeded` 并入 `done`（spec 01 §3.1 为正典）；`GateResolution` 以 spec 01 §6 四态为准（补 `cancelled` 变体）；`opts.retry` / `PermanentStepError` 随 retry 面推迟（简化走查裁决）；错误类族（`RunFailedError` / `RunCancelledError` / `StepFailedError`）见原型草案，随实现落地。

### 1.2 defineAgent 面（ADR 0010，已实现）

编译与绑定（实现落定）：`defineAgent` 返回声明式定义（组合行静态：prompt 段 + dsh `ToolDefinition` 零适配 + `ModelRoute` + 必填 `maxTurns` 声明期校验；动态 `compose(input)` 留口未开）。`bindAgent(def, ctx)` 把 spec 编译为不透明 body 交引擎注册表（引擎对 `kind: 'agent'` 无感知），闭包捕获宿主 Context；`ctx.durable` / `agents` / `sessions` / `sessionPersistence` 缺任一则 bind 期 loud throw——persistence 缺失即配置错误（耐久是 defineAgent 的存在理由，不是可选项）。同一定义对象重复绑定 no-op，返回首个 face（WeakMap；闭包锁定首个宿主 Context）。展示元数据 `display`（业务名 + 描述，spec 05 §5）随 bind 落进引擎注册表，经 `listDefinitions` 只读视图读出：仅元数据，引擎执行语义不读它，声明期校验两字段非空白；未声明时视图报 `display: undefined`，呈现层回落到技术 `name`。

```ts
// @daypaw/sdk —— defineAgent 面正典类型（ADR 0010 §4 落地；实现即权威）
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ZodType, z } from 'zod'
import type { DefinitionDisplay } from '@daypaw/engine'
import type { RunHandle, RunOptions } from '@daypaw/sdk'

/** zod schema → inferred TS type. */
type Infer<I extends ZodType> = z.output<I>

/** 静态系统提示段（agent scope 内 scoped 注册）。 */
export interface PromptSegment {
  readonly name: string
  readonly order: number
  readonly text: string
}

/** 静态模型路由。 */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number
}

export interface DefineAgentOptions<I extends ZodType, O extends ZodType> {
  readonly name: string
  readonly version: string
  readonly input: I
  /** 输出契约，同时是注入 submit 工具的 args schema（非 object 根包 {value} 单参数）。 */
  readonly output: O
  readonly prompt: readonly PromptSegment[]
  /** 工具面：dsh ToolDefinition 零适配。 */
  readonly tools: readonly ToolDefinition[]
  readonly model: ModelRoute
  /** 跨复活累计的 turn 预算（唤醒前检查，超限即失败）；必填正整数。 */
  readonly maxTurns: number
  /** steer 通道 opt-in（issue #53）：不带 submit 收尾的 turn 后 run park 而非失败，追问输入在段边界作为 user message 消费；未声明保持单段契约。 */
  readonly steerable?: boolean
  /** 目录展示元数据（业务名 + 描述，spec 05 §5）：仅元数据，不改执行语义；声明期校验非空白，未声明时呈现层回落技术 name。 */
  readonly display?: DefinitionDisplay
}

export interface AgentDefinition<I extends ZodType = ZodType, O extends ZodType = ZodType>
  extends DefineAgentOptions<I, O> {
  readonly kind: 'agent'
}

export declare function defineAgent<I extends ZodType, O extends ZodType>(
  options: DefineAgentOptions<I, O>,
): AgentDefinition<I, O>

export declare function bindAgent<I extends ZodType, O extends ZodType>(
  def: AgentDefinition<I, O>,
  ctx: Context,  // 宿主组合：dsh agent 栈 + ctx.durable
): Promise<BoundAgent<I, O>>

export interface BoundAgent<I extends ZodType, O extends ZodType> {
  /** 与 workflow 面同一 run 语义：幂等 start-or-attach + 类型化 RunHandle。 */
  run(input: Infer<I>, opts?: RunOptions): Promise<RunHandle<Infer<O>, Infer<I>>>
}

/** WorkflowCtx 上（bind 注入的增强 ctx；未绑定定义 loud throw）。 */
export interface WorkflowCtx {
  /** 自身即父步 agent:<name>，等待子 run 类型化结果。 */
  agent<I extends ZodType, O extends ZodType>(
    def: AgentDefinition<I, O>, input: Infer<I>,
  ): Promise<Infer<O>>
}
```

执行语义（ADR 0010 §2–§5，实现落定点）：sessionId ≡ runId；create vs resume 判别 = 持久化 session 是否存在（覆盖 insertRun 后崩溃窗口）；复活 resume 接回 + 合成续跑消息（`RESUME_MESSAGE`，英文常量，模型可见）steer 唤醒（dsh 无无内容唤醒）；submit 工具约定终止（SDK 注入，args schema = output schema，二次调用抛错，模型自然收尾）；输入 = 首条 user message（JSON text）；一个 dsh step = 一条 journal step（键 `dsh-step:<turn>:<step>`，值 = 事件切片；复活重驱动遍历同序，引擎去重返回已记录切片而非重执行，模型调用由 session resume 本身省掉）；`maxTurns` 实现为唤醒前预算检查——一次唤醒恰好跑一个 turn 到 quiescence，无需 live listener；`ctx.agent(def, input)` = 确定性子 runId 派生上的语法糖（引擎从 `(parentRunId, stepKey, occurrence)` 派生，与子 workflow 惯用式共享机制），两级各自耐久；轮内 LLM 瞬态失败归 dsh llm-retry（不改 occurrence 序），step 级失败才落 journal。运维注记：合成续跑消息与崩溃半轮的冗余失败尝试留在上下文 = defineAgent 的诚实代价。

steerable 定义的编译 body 是段循环（issue #53）：turn quiesce 而无 submit 时 run 经 `ctx.awaitSteer` park（零算力）而非失败；每个已落账段在段边界以 user message 投递（`agent.steer`，JSON text，形状同初始输入），一次唤醒恰好跑一个 turn 到 quiescence；`maxTurns` 在每次唤醒前检查、跨段共享。重驱动按 session log 的 user 源（`source.kind === 'user'`）消息事件序数计已投递段（排除 `RESUME_MESSAGE` 唤醒；生产者注入的上下文如 runtime-context 快照不计入，model-visible means logged，log 即回放源），崩溃不重复投递、内容相同的追问按序数互不混淆。复活三分支：进程死期间落账的段即复活唤醒（无合成 `RESUME_MESSAGE`）；干净 parked 的 run 复活即重新 park、不消耗 turn；崩溃发生在 turn 中途仍以 `RESUME_MESSAGE` 唤醒（仅非 steerable 定义或被中断的 turn）。未声明 `steerable` 的定义语义不变：不带 submit 的 turn 使 run 失败（`ended (last turn: ...) without calling submit`），`ctx.agent` 子 run 不会挂住父 workflow。产出物不变：`output_json` 仅由终态 finalize 写入，中间段永不形成产出物。

## 2. ctx 原语面

五原语：`step` / `sleep` / `waitFor` / `agent` / `spawn`（ADR 0003 §2）。`step`/`agent` 面已定案（上节与 ADR 0010）；`waitFor` 语义 spec 01 §6、已实现；`sleep` 语义同节已定、按需落地；`spawn` 语义未设计（ADR 0010 §4 排除）。已定型（[SDK API 表面草图](https://github.com/0xnicholas/daypaw-pro/tree/prototype/sdk-api-surface) 原型验证，类型草案 `prototype/sdk-api/sdk.d.ts`）：

- **子 workflow 等待式调用 = 惯用式**，不加第六原语：`ctx.step` 内裸 `def.run()` 等待 `.result`；前提是引擎从 `(parentRunId, stepKey, occurrence)` 派生**确定性子 runId**（重驱动 attach 而非重开，副作用不翻倍）。
- **step 幂等键**：默认 `runId + name + occurrence` 自动派生（重驱动遍历顺序须确定，map 顺序稳定、手写乱序 await 不稳——运维注记）；`opts.key` 显式逃生口。
- **错误与门结局**：gate 超时/拒绝 = 联合类型值 `GateResolution`（终态非异常，ADR 0002 §5 的类型化呈现，四态含 `cancelled` 以 spec 01 §6 为准）；`RunStatus` 用判别联合（`{state:'waiting', gate}` 等，修订 ADR 0003 的 `'waiting:<gate>'` 字符串草案）；（retry 面）`PermanentStepError` 止重试——随 retry 面推迟；`RunHandle.result` 仅 failed/cancelled 时 reject；LLM 级重试留 dsh llm-retry waterfall，不进 SDK 面。
- **step 结果序列化**：运行时校验（ledger 写账时），编译期 `T extends Json` 约束与 zod optional 推断冲突，不做。

## 3. 定义注册表与组合

程序化组合 + 定义注册表（ADR 0003 §3）：name+version 身份、session header 重建、与 preset 的双路并存。已定型（原型验证）：`tools` 直收 dsh `ToolDefinition`（零适配器，形状对上游源码核实）；接受两套 schema 并存（定义 IO = zod，tool 参数 = dsh spec），统一层 v1 不做；组合行 v1 静态字段（`compose(input)` 动态组合留口未开，EVO 变体算子均为静态维度）。版本语义细节（兼容规则、EVO 变体命名）：待写。

**目录装载面（ADR 0012，已实现）**：壳宿主的注册源 = cwd `daypaw/agents/` 目录扫描——每个模块文件（`.mjs`/`.js`/`.ts`）default 导出**注入式工厂** `export default ({ defineAgent, defineWorkflow, z }) => 定义`（或定义数组），装载器（`@daypaw/sdk/agents-dir` 的 `loadAgentFiles(ctx, dir)`）把 SDK 命名空间作实参传入后经 `bind`/`bindAgent` 注册；文件零裸导入（交付态工作区解析不到 daypaw 家族，cwd 自装引入双拷贝风险），同目录相对导入可用。文件按名序装载，注册顺序跨平台稳定；缺目录 = 合法空名册；坏文件失败响亮指名文件（装载回调是 Cordis 插件 fiber，Loader 树中拒绝即 boot 失败）。组合住在 `@daypaw/web-app` 胶水（`agentsDir` 配置，默认 `daypaw/agents`）；不装 engine 行的组合不服务名册。

**wire face（ADR 0012，已实现）**：`bind`/`bindAgent` 编译时从 zod input 契约结构检测 `inputKind`——`z.string()` 与 `z.object({ task: z.string() })` 为 `text`（弹窗自由文本直收），其余为 `json`（降级 JSON 文本框）——连同 `parseInput`（zod parse 的不透明 thunk）作为 `EngineDefinition.wire` 落进注册表；`durable/startRun` 边界在插入 run 前调用 `parseInput` 校验，`durable/listDefinitions` 视图投影 `inputKind`（null = 无 wire 面）。引擎不检视 thunk 内部（ADR 0010 引擎盲编译延伸到 wire 钩子）。

**发起端点（ADR 0012，已实现）**：`durable/startRun`（`@Remote`）入参 `{ defName, defVersion?, input, runId? }`，start-or-attach 与 SDK `def.run()` 对齐（弹窗生成 runId，重试安全）；版本缺省解析该名字唯一注册版本，多版本/跨 kind 共存要求显式版本（拒绝时列名候选）；返回 `{ runId }`，结果不随端点返回——浏览器经 `listRuns`/`journalTimeline` 轮询观察，失败 run 不以宿主未处理拒绝浮出。

## 4. run 生命周期（workflow 面）

幂等 start-or-attach、RunHandle、类型化结果、cancel、boot 扫描复活（ADR 0003 §4）；引擎侧语义见 spec 01 §5。SDK 调用 ↔ ledger 动作对表：

| SDK 面 | ledger 动作（spec 01 §3/§5） | RunHandle 表现 |
|---|---|---|
| `def.run(input, {runId?})`，无行 | INSERT `runs`（`running`，记 `(def_kind, def_name, def_version, input_json)`）+ 开始驱动 | `result` pending |
| `def.run`，已有行 | attach 三态：本进程在驱动→挂完成通知；终态→直读行；他进程驱动→`pollMs` 轮询 | 终态直接 settle |
| `ctx.step(name, fn)` | INSERT `journal` `started` → 执行 → `completed`+`value_json` / `failed`+`error_json`（PK `(run_id, step_key)` 即去重闸） | — |
| 重驱动遇已完成 step | 读 `value_json` 返回，不重执行 | — |
| `ctx.waitFor`（已实现）/ `ctx.sleep`（按需落地） | `promises` 行 pending + `runs`→`waiting`/`waiting_gate`；`timers` 行 `wake_at` | `status()` = `{state:'waiting', gate}` |
| `handle.cancel(cause)` | UPDATE `runs`→`cancelled`+`cancel_cause` → driver AbortSignal | `result` reject `RunCancelledError` |
| `handle.steer(input)`（steerable 定义，issue #53） | INSERT `journal` `kind='segment'`（`steer:<seq>`，插入即 `completed`）→ 本进程 parked driver 直推唤醒 / 跨进程 `pollMs` 轮询兜底 | parked run 的 `status()` 保持 `{state:'running'}` |
| steerable run 段边界消费 | 段输入作为 user message 进入同一 session（`agent.steer`），一次唤醒跑一个 turn 到 quiescence | — |
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
- **SDK 行为面**：跑真 engine（进程内 + 临时目录 SQLite，mock 边界仅 LLM/时钟）；五原语各配契约测试（含确定性子 runId 派生、`opts.key` 逃生口、GateResolution/RunStatus 判别联合）、steerable 多段生命周期（submit-less turn park、段边界投递、parked/死期落账/中断 turn 三种复活分支、序数去重）；tsc 类型面独立断言套件（[SDK API 表面草图](https://github.com/0xnicholas/daypaw-pro/issues/10)原型路径）。
- **REAL-composition**：`ctx.durable` 插件族配测试专用 `cordis.yml` 走真 Loader 的组合测试；canonical example（walking skeleton 宿主，`examples/daypaw-*`）拥有 keyless snapshot + with-key smoke（无 key 自跳）。
- **invariant companion**：engine 包必须带 `src/invariant.ts`（上游 glob 约定自动接入不变量宿主，缺即 throw）。
- **覆盖率**：per-file 100% 门（CI ci-coverage lane）。
- 待写：§4 生命周期 ↔ ledger 事件序列对表的逐条断言清单；故障注入包装器在 engine 包内的 seam 设计。
