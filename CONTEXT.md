# CONTEXT.md — daypaw-pro 领域词汇表

> 纯词汇表：术语与边界，不含实现细节。架构决策见 `docs/adr/`，进行中的规划见 wayfinder maps（issue #1、#20）。

## 词汇

### daypaw-pro

本仓库：deepseek-harness 的 fork + in-tree 扩展，自用的 TypeScript Agent Stack 基础设施。

### 上游（Upstream）

deepseek-ai/deepseek-harness 的 main 分支。本 fork 一切非 `packages/daypaw/`、非自有 profile 内容的来源。

### 四支柱（Four Pillars）

fork 叙事的四个能力族：**Durable Execution**（跨 turn/跨进程的持久执行）、**Agent Engine + SDK**（引擎与代码优先的 Agent 编程模型）、**Agent Manager**（观测与管理面）、**EVO**（用户 Agent 的持续优化系统）。2026-08 需求重审（ADR 0009）：①② 为现役支柱；③④ 降级为远期独立子项目，后期单独立项；spec 03/04 与 ADR 0004/0005 保留为子项目方向文档。

### 同步仪式（Sync Ritual）

每 2–4 周或里程碑开工前，从上游 merge、全量测试、打 checkpoint tag 的例行流程。见 ADR 0001。

### Checkpoint

`daypaw-sync/<日期>` annotated tag，注释携带所合并的上游 commit sha。「当前基线」的唯一权威记录。

### Core-touch

对上游既有文件的任何修改。默认禁止；例外须登记 `docs/fork/CORE_TOUCHES.md`。与 seam 扩展（新 package、merge-extensible 事件、profile 覆盖）相对。

### Seam
dsh 的可替换能力缝：Service Definition / Provider / Consumer 三角色。daypaw 的扩展首选挂载点。

### Walking skeleton（走骨）

四支柱首个落地物（ADR 0008 §1）：`@daypaw/store` + `@daypaw/engine` + `@daypaw/sdk` 的最薄端到端耐久竖切——仅 `defineWorkflow` + `run()`/RunHandle，无 defineAgent/timer/HITL/spawn/retry 面。证明线：canonical example 真 SIGKILL 中段杀死，boot 扫描后续跑至类型化完成。

### 落地批次（Landing Batches）

#13 收尾计划的四批次（ADR 0008 §2）：A = fork 导入 + 首 checkpoint；B = spec 第 1 章（Durable Execution）；C = walking skeleton 落地（store → engine → sdk，按 `docs/fork/adding-a-daypaw-package.md`）；D = spec 00-overview（最后写，含 profile/bundle 行清单设计）。

## 编排（Durable Engine 域）

### Durable Engine（参照系名 Orchestrator）

支柱①的引擎：跨 turn / 跨进程的持久执行层（参照系：Palantir Orchestrator）。作为 Cordis 插件族暴露 `ctx.durable`。见 ADR 0002。

### Run

一次 durable 执行（`defineAgent` 或 `defineWorkflow` 调用的持久化实例）。持久身份 = runId；`def.run(input, { runId? })` 为幂等 start-or-attach：同 runId 已存在则接回，不存在则启动，崩溃重启后同一调用自动接回原 run。调用方持有 RunHandle（id、类型化 result、status、cancel）。结果 = output schema 校验后的类型化输出（引擎级因果归因，修复 dsh wire finalResponse 无归因的缺陷）。boot 扫描复活未完 run 不需要原调用者。每 run 单写者：同一时刻只有一个驱动者。run 不区分「单会话体」与「编排体」——ledger/Manager/EVO 只认 run。

### Agent 定义（Agent Definition，`defineAgent`）

声明式 LLM 循环 spec：name+version+zod 输入/输出+组合行（prompt 段、工具面、模型路由）。存于进程内定义注册表；run 时挂 session、应用组合（与 preset 同一挂载语义，来源为代码而非文件），session header 记 (定义 id, 版本) 供冷复活重建；ledger run 行记定义版本（EVO 变体并行前提）。一次 agent run = 一个主 session（subagent 子女自拥 session）。可直接 `run()`（一等公民，Palantir published async function 的对应物）。

### Workflow 定义（Workflow Definition，`defineWorkflow`）

代码编排体：用户 async 代码，引擎执行，内可调 agent / 子 workflow / gate / timer。与 Agent 定义共一个 run 概念，但 body 形态不同（代码 vs spec）。workflow run 无主 session——session 只在 `ctx.agent` 处产生。

### Step

run 内的一个幂等执行单元（含 LLM/工具调用），由 `ctx.step(name, fn)` 显式标记。恢复时按幂等键去重：已完成 step 返回已记录结果，不重执行。parallel/condition 不是原语——普通 TS（`Promise.all`/`if`）即控制流。

### SDK 原语（ctx 面）

workflow body 可用的五个显式原语：`ctx.step`（去重单元）、`ctx.sleep`（持久 timer）、`ctx.waitFor`（gate）、`ctx.agent`（调 agent 定义）、`ctx.spawn`（火后不管子 run）。其余靠语言本身；副作用不经 ctx 的代码不受引擎去重保护。命名不进口 Palantir 三原语（Event/Context 与 dsh 既有词汇撞名）；同构关系只记文档。

### Effect

step 内对外部世界的一次副作用（LLM 调用、工具调用、写文件）。ledger 记录 effect + 结果 + 幂等键。

### Engine Ledger

引擎的追加式事实日志（run/step/effect/promise/timer），以 `(session.id, seq)` 引用回 session log。与 Session Log 双事实源各管一事：后者只承载模型可见内容。

### Durable Promise（Gate）

HITL 挂起原语 `ctx.waitFor(gate, {schema, timeout})`：键 = `(runId, gate 名)`，状态机 pending→resolved/rejected/timedout/cancelled，幂等 resolve；等待期间进程可退出（零算力）。

### RunHandle

run 的调用方句柄：id、result（类型化 Promise）、status()、cancel(cause)。内存 promise 不承诺跨进程——跨进程重连走 attach（幂等 start-or-attach）。

### Boot 扫描

进程拉起时的恢复仪式：补发 overdue timer、恢复未完 run。无常驻 daemon 的唤醒机制。

### 幂等键（Idempotency Key）

step/effect 的去重标识：at-least-once 执行之上凑 exactly-once 感知的依据。自动派生 = `runId + name + occurrence`；`opts.key` 显式逃生口。

### 认领（Claim）

每 run 单写者的实施：进程以实例 id 经条件更新原子认领 run 的驱动权；进程边界即写权边界，旧驱动者随进程死亡自然失效。见 spec 01 §5。

## 管理面（Manager 域）

### Agent Manager（Manager）

四支柱③，现为远期独立子项目（ADR 0009）：人的观测与控制窗口——看 run（registry / timeline / trace）并施加少量控制（resolve / cancel / 重跑）。是人的窗口，不是其他支柱的数据管道。自建面收窄为「跨 run/跨进程聚合 + durable run 视图 + 控制命令」；spec 03/ADR 0004 为方向文档。

### Manager Host

按需拉起、伺服 Manager UI 的最小进程：开同一本地库、可写控制命令，无常驻。agent 进程活着时同一 UI 由该进程兼伺。

### 控制命令（Control Command）

跨进程控制载体：写入本地库、由引擎在恢复边界观察执行的命令。与进程内 RunHandle.cancel 同语义、不同运输。

### 重跑（Rerun）

同定义同输入的新 run，ledger 以 attempt 链关联前次。不是同 runId 复活——终态不可撤销，start-or-attach 幂等性优先。

### Run Registry

自用语境的 fleet 视角：全部 run × 状态 × 定义版本的注册视图，含按定义聚合。fleet 不是多机——是跨进程、跨时间。

### 关联层（Correlation Layer）

本地库中以 `(session.id, seq)` 指回 session log 的评估/反馈数据族（feedback / eval / dataset）；只引用，不复制内容。

## 优化（EVO 域）

### EVO

四支柱④，现为远期独立子项目（ADR 0009）：用户 Agent 的持续优化系统。以遥测与评估为据，为 agent 定义产出更优版本提案；本体是引擎上的一个 workflow。不优化 stack 自身。等①②跑出真实遥测语料与重复负载再评估毕业；spec 04/ADR 0005 为方向文档。

### 变体（Variant）

一条 agent 定义的新版本：由类型化算子（模型路由、prompt 段、工具面子集）对既有版本施加变更而成，在实验中与 incumbent 对打。

### 评估集（Eval Set）

版本化的回放基准：从真实运行提取、人工策展、可含标记来源的合成扩量的输入→期望输出对集合。变体与 incumbent 在其上对打；晋升阈值与数据集版本绑定。

### 双门判据

变体胜出须过两道门：质量门（逐维度不劣于 incumbent 减容差，关键维度严格不差）与效率门（成本/延迟不减益）。由分层 judge（schema 校验 → rubric → 人工抽检）判定。

### 提案（Proposal）

实验胜出变体的发布物：类型化 diff + 实验记录 + eval 证据，经人审应用为代码中的定义新版本。EVO 的产出止于提案——永不自动生效。

## 测试（Test 域）

### REAL-composition 测试

经真 Loader 启动测试专用 `cordis.yml` 的组合测试：product-visible 插件的最低真实入口要求，mock 边界仅限外部服务（LLM/网络/时钟）。与手搳 `ctx.plugin(...)` 的单元组合相对。

### keyless / with-key

keyless = 无 API key 也可跑（mock 或回放），CI 恒 keyless；with-key = 真模型真调用，无 key 自跳、真验证在本地。

### 故障注入重放（Fault-injection Replay）

engine 崩溃测试主力：在 ledger 写入点注入异常模拟死亡，穷举恢复路径。与「真 kill 补充」（真 SIGKILL 子进程验半写路径）相对。

### Golden 库（Golden Ledger Fixture）

提交进仓库的某 schema 版本历史 SQLite 库：迁移测试的权威输入（旧库 → 迁移 → 可重放断言）。

### 覆盖率门（Coverage Gate）

per-file 100% 行/分支/函数覆盖的 CI 门（上游 ci-coverage lane）。daypaw 非 UI 包沿用；`ui-*` 前缀一条 glob 豁免。
