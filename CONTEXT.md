# CONTEXT.md — daypaw-pro 领域词汇表

> 纯词汇表：术语与边界，不含实现细节。架构决策见 `docs/adr/`，进行中的规划见 wayfinder map（issue #1）。

## 词汇

### daypaw-pro

本仓库：deepseek-harness 的 fork + in-tree 扩展，自用的 TypeScript Agent Stack 基础设施。

### 上游（Upstream）

deepseek-ai/deepseek-harness 的 main 分支。本 fork 一切非 `packages/daypaw/`、非自有 profile 内容的来源。

### 四支柱（Four Pillars）

daypaw-pro 在 fork 内新增的四个能力族：**Durable Execution**（跨 turn/跨进程的持久执行）、**Agent Engine + SDK**（引擎与代码优先的 Agent 编程模型）、**Agent Manager**（观测与管理面）、**EVO**（用户 Agent 的持续优化系统）。

### 同步仪式（Sync Ritual）

每 2–4 周或里程碑开工前，从上游 merge、全量测试、打 checkpoint tag 的例行流程。见 ADR 0001。

### Checkpoint

`daypaw-sync/<日期>` annotated tag，注释携带所合并的上游 commit sha。「当前基线」的唯一权威记录。

### Core-touch

对上游既有文件的任何修改。默认禁止；例外须登记 `docs/fork/CORE_TOUCHES.md`。与 seam 扩展（新 package、merge-extensible 事件、profile 覆盖）相对。

### Seam

dsh 的可替换能力缝：Service Definition / Provider / Consumer 三角色。daypaw 的扩展首选挂载点。

## 编排（Orchestrator 域）

### Orchestrator（即 Durable Engine）

支柱①的引擎：跨 turn / 跨进程的持久执行层，Palantir Orchestrator 的自用等价物。作为 Cordis 插件族暴露 `ctx.durable`。见 ADR 0002。

### Run

一次 durable 执行（一个 `defineWorkflow` 调用的持久化实例）。每 run 单写者：同一时刻只有一个驱动者。

### Step

run 内的一个幂等执行单元（含 LLM/工具调用）。恢复时按幂等键去重：已完成 step 返回已记录结果，不重执行。

### Effect

step 内对外部世界的一次副作用（LLM 调用、工具调用、写文件）。ledger 记录 effect + 结果 + 幂等键。

### Engine Ledger

引擎的追加式事实日志（run/step/effect/promise/timer），落 storage seam，以 `(session.id, seq)` 引用回 session log。与 Session Log 双事实源各管一事：后者只承载模型可见内容。

### Durable Promise（Gate）

HITL 挂起原语 `ctx.waitFor(gate, {schema, timeout})`：键 = `(runId, gate 名)`，状态机 pending→resolved/rejected/timedout/cancelled，幂等 resolve；等待期间进程可退出（零算力）。

### Boot 扫描

进程拉起时的恢复仪式：补发 overdue timer、恢复未完 run。无常驻 daemon 的唤醒机制。

### 幂等键（Idempotency Key）

step/effect 的去重标识：at-least-once 执行之上凑 exactly-once 感知的依据。
