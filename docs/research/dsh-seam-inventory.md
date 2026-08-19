> **已被 v2 接替**：[dsh-seam-inventory-v2](dsh-seam-inventory-v2.md)（[地形重扫：merge 后 seam 清点 v2](https://github.com/0xnicholas/daypaw-pro/issues/21)）。v2 §4 列出本文档需作废/加注的断言；未列处仍成立。本文保留作历史底稿。

# dsh seam 清点（四支柱相关）

> Wayfinder 研究票 [#3 「dsh seam 清点（四支柱相关）」](https://github.com/0xnicholas/daypaw-pro/issues/3) 的成果。调查对象：本地 deepseek-harness 仓库（`/Users/nicholasl/Documents/build-whatever/deepseek-harness`，只读）。结论形态：六节事实 + 逐支柱「可直接挂载 seam / 必须新造 seam」清单，供「Durable Execution 语义与基座」「Engine 与 SDK 编程模型边界」「Manager 范围与控制面」「EVO 循环机制」及引擎包结构雾使用。
>

---

## ① Agent 生命周期与 waterfall 事件：确切签名与拦截能力

**双层事件模型**（`docs/agent-lifecycle.md` 开头即声明）：durable 事实走 session log，经单一 `session/event` emit 广播（`turn/*`、`step/*`、`user/message`、`assistant/*`、`tool/*`）；live 协调/状态走 `agent/*`。SDK/观测者要可重放数据就消费 `session/event`，「`agent/*` 是队列/状态/拦截/续跑/错误的 live 协调 API」。

**Waterfall（监听者必须调 `next()` 委派）**——声明在 `packages/core/agent/src/runtime-types.ts` 与 `packages/core/tools/src/index.ts`：

| 事件 | 签名要点（runtime-types.ts 行号） | 拦截能力 |
|---|---|---|
| `agent/pre-step` (waterfall) | `(this: Scoped<Agent>, payload: { agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>`（:231） | **权威**：拒绝该 step（消息既不丢弃也不入 log，turn 无 step 关闭）或替换进入 step 的消息。compaction、plan-mode、time-context 等 14 个包在用 |
| `agent/request` (waterfall) | `payload: { agent; turn; step; signal }, next: () => Promise<LlmCallConfig>`（:244） | 替换冻结的调用配置（模型/参数路由）；**不能**改消息（model-visible 必须走 logged channel） |
| `agent/request-error` (waterfall) | `payload: { agent; turn; step; provider; failure: LlmFailure; retryPolicy; signal }, next: () => Promise<RequestErrorAction>`（:260） | 返回 `{kind:'retry'}` 且不调 `next()` 即**接管恢复**；llm-retry、compaction 在用 |
| `agent/turn-stopping` (serial) | `(payload: { agent; turn; signal }) => Promise<void> \| void`（:278），**无 next()** | turn 关闭前的终检点；反对就 `agent.steer(...)` 续一轮 |
| `tools/pre-execute` / `tools/execute` / `tools/post-execute` (waterfall) | `packages/core/tools/src/index.ts:152/163/175` | pre：allow/deny/ask（ask 走 `ctx.approval` 一次性提示）；execute：around-dispatch（超时、重试、metrics）；post：accept/block/replace/additionalContexts（FIFO 注入 user/message） |
| `llm/stream` (waterfall) | `packages/llm/llm/src/index.ts:64` | 流级拦截；session-checkpoint-policy 用它做「请求前先落盘」屏障 |
| `system-prompt/assemble` (waterfall) | `packages/core/system-prompt/src/index.ts:31` | 改 prompt 段与 tool schema 组装 |
| `sessionTelemetry/record` (waterfall) | `packages/session/session-telemetry/src/index.ts:43` | 遥测记录 redact/替换 |

**Emit 事件**（通知型）：`agent/created|disposed|status|inbox/inserted|claimed|discarded|session-start|error`（runtime-types.ts:159-290）、`subagent/start|end|provider-added|removed`、`workflow/start|end|phase|log|agent-start|agent-end`、`session/created|disposed|event|flush`、`approval/request`、`fs/write-intent|edit-intent|observed`、`goal/changed`、`domain/changed`。全部为 scope 过滤（`@deepseek-ai/dsh-scope`）：agent 级监听只收该 agent。完整生产者/消费者矩阵在 `docs/event-producer-consumer.md`（脚本生成，`pnpm run gen-doc-graphs` 校验）。

**Turn 流**（`docs/architecture.md` §Turn flow + `docs/agent-lifecycle.md` 时序图）：turn 开于首个 input 被 claim、闭于「不再欠账」；step = 一次模型请求 + 其工具调用；工具结果可带 `concludesTurn` 数据性终止 turn；same-step `additionalContexts` 与 racing steering 总是先跑完。

---

## ② jobs / workflow / schedule / spill：契约与持久化缺口

| 族 | 契约 | 持久化现状 | 进程死亡时丢失什么 |
|---|---|---|---|
| **jobs** | `ctx.jobs`（`JobRegistry`：start/get/list/read/kill/wait/onJobDone/onJobsChanged/attachController），owner-isolated、first-wins settlement | `jobs-local` 的 `LocalJobRegistry`「**keeps every record in memory**」（packages/jobs/jobs-local/README.md）——纯内存，进程本地 | **全部**：运行中 job、终止历史、通知位。owner disposal 取消其 jobs，但那只是进程内清理 |
| **workflow** | `ctx.workflowEngine.start(WorkflowStartRequest): WorkflowRun`；`{meta, script, args?, subagentProvider?, maxTotalAgents?, parent, signal?}`；`WorkflowRun = {id, meta, result, cancel, dispose}`；事件 observe-only，防监听者取得取消权 | 运行于 worker thread（`workflow-worker-thread`）；**无 durable run 状态**。`meta` 注释仅说 "display + persistence key"，实际没有任何 run journal | 运行中 workflow 全部中断；父 session 恢复时由 crash-tail repair 给出合成 `TOOL_OUTCOME_UNKNOWN` 结果——workflow 不会续跑，只会被「有礼貌地报死」 |
| **schedule** | 模型侧 create/list/delete 工具 + 版本化 Schedule 事件 fold；**无公开 service、无可变 DB**（packages/schedule/README.md） | **durable 状态在原 Session log 里**（版本化事件 + fold）；timer owner 是进程本地的、且只在 root Agent live 时等待 | 冷 session 在复活时 resume overdue work（`docs/subsystems/schedule.md`）；**绝不隐含外部通知通道**——没有任何东西唤醒死进程；跨 session/全局定时不存在 |
| **spill** | `ctx.spillStore`（SaveTextSpill → 有界预览 + locator） | `spill-local` 存 session 级本地文件——磁盘持久 | 无实质丢失 |

**缺口总结**（面向支柱①）：dsh 的持久化 = 「session log 事件 + 磁盘后端 + checkpoint 屏障」。它没有：跨进程 timer、durable 后台任务注册表、workflow 级 run 状态机/重放、boot 时的 run 恢复调度、补偿语义。进程死了，**对话史活着，但一切「正在做的事」都死了**。

---

## ③ session-persistence / storage / session-checkpoint-policy：已有表面

**`ctx.sessionPersistence`**（packages/session/session-persistence/README.md，Service Definition；jsonl/sqlite 为 Provider）：
- append-only `SessionEvent`，`SESSION_FORMAT_VERSION = 0`；「持久化单元就是 SessionEvent，没有平行的 persisted-message 类型」；不可重放元数据走 `SessionHeader`。
- 方法面：`locate / supportsRawArtifacts / readRaw / create / append / prepare / load / inspect / readFrom(id, fromSeq) / list / listSnapshots`。
- **共享写协调器 `PersistenceCoordinator`**：per-id 状态、有界批量窗口（`writeBatchMaxDelayMs`）、`session/flush` 静默屏障、lazy 物化、HMR 采纳、quiescent disposal。后端只需实现小接口 `PersistenceBackend<TornMarker>`（`loadStored / readStoredRevision / loadStoredFrom? / appendBatch / commitRepair / list / close?`）——SQLite 是 seek-capable（`WHERE seq >= ?`），JSONL 顺序读全量再前跳。
- **崩溃修复（冷加载）**：只丢 torn tail 片段；未闭合 turn 用合成事件「_durably close_」：每个未答 tool/call 得到风险分级的 `TOOL_OUTCOME_UNKNOWN` `tool/result` + `step/end?` + `turn/end {interrupted}`。不变量：append-only、连续 seq、JSON 可序列化、append 返回即 durable。

**storage 族**（非 session 数据）：`ctx.storage` 命名后端（`json`/`sqlite`）+ `ctx.storageDomain`（zod `defineDomain`、`DomainFacility.open`、权威内存态 + 写先达后端再更新内存、`domain/changed`）。已知限制：**单进程可见性**、无跨表事务/二级索引/多段键——EVO 的 dataset/experiment 存储如果用它会撞到这些。

**`session-checkpoint-policy`**（packages/session/session-checkpoint-policy/README.md）：**语义 durability 屏障**——模型请求发出前（lazy 包 `llm/stream`）、顶层工具产生外部副作用前（包 `tools/execute`，取消返回 `ABORTED_BEFORE_DISPATCH`）、每个 `agent/pre-step` 边界；fail-closed（屏障不过就不跑）。崩溃后留下 durable 未配对 call，恢复期补 `TOOL_OUTCOME_UNKNOWN`。**这就是 dsh 现成的「带屏障的 at-least-once」故事**——durable execution 决策的直接起点。

---

## ④ telemetry / runtime-diagnostics / feedback：已记录什么

**`session-telemetry`**（Service Definition，`ctx.sessionTelemetry` 每 context 一个后端）：
- 后端契约 `SessionTelemetrySink`：`emit(record)` 同步非阻塞入队、可选 `flush()`、`shutdown()` 排空。捕获模式 `live`（挂 `session/created|event|flush|disposed`、`agent/error`、adoption sweep）或 `on-demand`（`captureSession(session, throughSeq?)` 重放 canonical log 前缀）。
- 记录形：`SessionTelemetryRecord { channel: ledger|ops, time, severity, attributes(仅身份: session.id/event.type/event.seq/cwd/parent_id/seed_length), body: 完整深拷贝 event.data（redact 后） }`。
- `sessionTelemetry/record` redact waterfall——**本包不带任何规则**，装了什么规则 exported data 就多干净。chunk 投影：每 `(turn,step)` 只发首个 `assistant/chunk`。游标是模块级 `WeakMap<Session, seq>`（handed-off 水位，at-most-once，显式拒绝 outbox/backfill）。接收端 dedupe on `(session.id, event.seq)`。

**`session-telemetry-otel`**：OTel **Logs** 管线（LoggerProvider→BatchLogRecordProcessor→OTLP/HTTP），模式 `FULL | FEEDBACK_ONLY | DISABLED`（默认 DISABLED，fail-closed 授权）。**只有 logs，没有 traces/spans**；resource 仅 `service.name/version` + 匿名 `user.id`。FULL 模式「离开机器的内容」= 全部 `event.data`（用户/助手消息、工具实参结果、完整 system prompt 与 tool schema、feedback 文本、cwd）。

**`runtime-diagnostics` = `ctx.invariants`**：每包 `./invariant` companion 注册运行时跨记录校验（session 包裹性、call/result 追踪、状态转移、inbox FIFO 守恒、流语法、retry 位置……）。带 allow/blocklist。是「不变量注册表」而非通用诊断面。

**feedback 族**：`command-feedback` → durable **log-only** `feedback/record` 事件（不入模型上下文；FEEDBACK_ONLY 遥测的同意闸）；`message-feedback` → 逐助手消息评分/备注 sidecar（走 storage-domain + Host `messageFeedback.*` Remote 契约）。

**缺口总结**（面向支柱③④）：无 span/trace 级观测（无 per-tool/per-LLM-call span 层次）、无 eval/dataset/experiment 概念、无跨进程 fleet 聚合（遥测面向 OTel collector，产品面 `apps/web` 是单 runtime UI）、反馈只有「记录」没有「回流」。

---

## ⑤ SDK protocol / client / server：wire 能力边界

**protocol**（packages/sdk/protocol/README.md）：NDJSON JSON-RPC 2.0 over stdio。client→server：`initialize`（cwd + provider/model 路由 + 可选 maxTokens）、`session/prompt`（durable enqueue 回执 `{messageId}`）、`shutdown`。server→client 通知：`session.event`（**runtime 内所有 session，不过滤**，完整 log 信封）、`session.status`（整 agent running/idle）、`subagent.started|finished`（仅 in-process 后代）。

**client**：`DeepSeekHarness` 高层 owned-run API——`run()` 拥有一个活动区间（入队 → 等 durable `agent/inbox/spliced` 回执 → 收集到整 agent idle → `RunResult {sessionId, finalResponse, events, notifications}`）；`session(id?)` 命名/新开 session 句柄；`HarnessClient` 低层（显式 start/initialize/prompt/subscribe；`subscribeSessionTree(id)` 客户端侧收窄）。TS client 是 Python SDK 的孪生。

**server**：`inject: ['agents']`，每 sessionId 一个 agent；stdout 只跑协议；`shutdown` 排空后 exit 0。

**明确不存在的 wire 能力**（protocol/client README「Known Limitations」）：
- **无 mid-turn cancel、无 session close**——放弃一个 turn 只能杀掉 runtime 进程。
- 无 per-prompt 结果归因（`finalResponse` 是区间内最后提交的助手文本，不因果绑定该 prompt）。
- **server→client request 是死能力**（transport 支持、server 从不发——预留 approval 流）。
- 无协议版本协商（`serverInfo.version` 仅展示）。
- 驱动不了 jobs/workflow/schedule 的控制面，fork/inspect/load 等 persistence 能力不在 wire 上。

**对支柱②的含义**：wire 现状 = 「prompt + 全量事件流 + 状态」。SDK 编程模型要么扩 wire（cancel、run 级结果、控制操作），要么走进程内嵌（`subagent-dsh-sdk` 后端已示范以 client 驱动子 agent 的形态）。

---

## ⑥ 新增 in-tree package + profile/bundle 组合的规范路径

**加包 checklist**（docs/cookbook/adding-a-package.md，逐文件）：
- `packages/<group>/<pkg>/`：`package.json`（从 `packages/core/tools` 抄；`private:true`、版本对齐根、`type:module`、`main:lib/index.js`、`types:lib/types/index.d.ts`、cordis 同 range 进 peer+dev、`files` 白名单门）+ `tsconfig.json`（extends `tsconfig.base.json`，references vendor/cordis + dsh 依赖）+ `src/index.ts` + `README.md`（必须含 gated「Model Experience」块与「Known Limitations and Deferred Work」段，`scripts/verify-package-readme-limitations.ts` 把关）。
- 根配置：`tsconfig.host.json` **或** `tsconfig.client.json`（普通包恰属一个聚合）；新 group 才动 `tsconfig.base.json` 通配。workspaces/publint/tsdown/oxlint 全自动。
- **命名角色表**（Controller/Store/Registry/Runtime/Engine/Policy/Executor/Gateway/Provider/Backend/Handle/Service…）：`ctx` key 单复数必须与类角色一致；可换能力按 **Service Definition / Provider / Consumer** 分包。
- 组合机制：**profile**（Harness home 里的命名组合，列 bundle 栈 + out-of-tree 插件 + `cordis.patch.yml`）与 **bundle**（Cordis config 行的分发格式，`dsh.bundle` 指向 patch 文件）；层序 = 各 bundle 按序 → profile patch → home patch → `--patch` 覆盖；`dsh --profile web --dump-config` 可见整棵树，「任何一行都可被 patch 替换」。

**测试规范**（docs/testing.md）：单测（vitest，包内 `tests/**`，registry 必带 HMR 安全测试）；**覆盖率门 per-file 100%**（`packages/*/*/src`）；real-API e2e（带 key、无 key 自跳过）；snapshot（transport 契约 + 持久化 log pin）；「真实入口路径」= 用 Loader 起真 `cordis.yml` 断言，非手搓 `ctx.plugin(...)`；源码面解析（不消费 `lib/`）。

**开发流**（docs/development.md）：Node 22.19+/24+、corepack pnpm@11.7.0、`pnpm install`（装 Lefthook + 翻译配对 merge driver）、`pnpm run typecheck`。

---

## 逐支柱 seam 清单

### 支柱① Durable Execution

**可直接挂载**：
- session log + `ctx.sessionPersistence`（jsonl/sqlite）——durable 会话事实的完整底座（含 crash-tail repair、合成收尾、fork/resume）。
- `session-checkpoint-policy` 的屏障模式——「副作用前先 durable」的既有先例与防线。
- `ctx.storageDomain` / `ctx.storage`——engine 自有记录（run journal、timer 表）的现成存储。
- `spill-local` 文件存储模式。

**必须新造**：
- **durable run 状态机**：workflow/jobs 的 run 级 journal + deterministic 重放（或 checkpoint/resume）语义——现在 turn/step 是 durable 的，但「跨 turn 的编排意图」不是。
- **boot 恢复调度**：进程重启后哪些 run 续跑、怎么续（现在只有「礼貌报死」）。
- **持久 timer/sleep**：跨进程、能唤醒死进程（或拉起进程）的定时面——schedule 只在 session 活着时等。
- jobs 的持久 Provider（现契约 `JobRegistry` 无持久要求，settlement 语义要重新定义）。
- 补偿/重试策略 seam、exactly-once vs at-least-once 的边界声明（现有 `TOOL_OUTCOME_UNKNOWN` 模式可作语义基线）。

### 支柱② Agent Engine + SDK

**可直接挂载**：
- `ctx.agents` / `ctx.agentLoop`（Agent 接口 + 默认驱动）、`ctx.systemPrompt`、`ctx.tools`、`ctx.llm` 适配器 seam——engine 的全部原料。
- subagent provider seam（`subagent-in-process` / `subagent-dsh-sdk`）——「一个 agent 调另一个 agent」的现成抽象。
- SDK protocol/client/server 作底层传输；preset/composition 机制；`ctx.sessions.fork`。
- `agent/pre-step` / `agent/request` / `tools/*` waterfall——human-gate 可先落在 pre-step 拒绝 + 注入恢复的既有机制上。

**必须新造**：
- `defineAgent` / `defineWorkflow` 编程模型与 dsh 概念（preset、composition、session）的映射层。
- run 句柄语义：`run()` 的 durable 身份、恢复后同一调用的续期、结果归因（wire 现状无 per-prompt 归因）。
- human-in-the-loop 一等原语（yield 等外部事件；现有 inbox/inject 可承载但要包成 SDK 级 API）。
- wire 扩展（cancel、session 管理、run 级结果）或进程内嵌路径的抉择。

### 支柱③ Agent Manager

**可直接挂载**：
- `session/event` 全量流 + `session-telemetry` seam（live/on-demand 双捕获、redact waterfall）+ otel 后端——观测数据面基本齐。
- `ctx.invariants` 运行时校验；`session-query` 服务；`apps/web` + `ConversationNodeDefinition` 渲染扩展点；SDK client 订阅；`storageDomain` 存 manager 自有记录。

**必须新造**：
- **fleet 视角**：跨 runtime/进程的聚合（遥测现指向 OTel collector；产品 UI 是单 runtime）。
- **控制面操作集**：pause/resume/kill/retry/fork/replay 的管理 API（部分能力存在于 per-session 面，无 fleet 面、无权限模型）。
- trace/span 级观测（现只有 logs）；保留期/查询面；与 EVO 的数据契约。

### 支柱④ EVO

**可直接挂载**：
- `feedback/record`（durable、log-only）+ message-feedback sidecar——人类信号已在 log 里。
- session log 本身 = 评估数据源（canonical 重放、`test-support/llm-replay` 已示范离线重放模型响应）。
- 遥测记录流（候选筛选输入）；`storageDomain`（dataset/experiment 存储，注意其单进程/无事务限制）；jobs/workflow（EVO 自身循环的进程内执行）；subagent providers（候选生成执行体）。

**必须新造**：
- dataset / experiment / 版本 / provenance 数据模型（含发布物与回滚）。
- 回归评估 harness（「不差于 incumbent」的判据与评估集漂移防护）。
- 候选生成循环（可作为 durable workflow 写——直接吃支柱①的狗粮）。
- 发布机制（改 preset/agent 配置的受控通道）、成本/同意 gate。

---

## 给后续决策票的三个跨切事实

1. **dsh 已把「会话内 durability」做满**（append-only log、屏障、崩溃修复、合成收尾），**把「跨进程/跨 turn 的编排 durability」留白**——支柱①的本质是补这一层，而不是从零建持久化。
2. **观测面是「OTel logs + 单进程 UI」**：遥测 seam 质量高但无 span/trace、无 eval 模型、无 fleet 面——Manager 与 EVO 的数据模型要在 seam 之上自建。
3. **wire 协议是「prompt + 事件流」最小面**：无 cancel/归因/控制操作——SDK 编程模型选「进程内嵌」还是「扩 wire」将直接决定 Engine 的部署形态（这恰是「Engine 与 SDK 编程模型边界」票的核心问题）。
