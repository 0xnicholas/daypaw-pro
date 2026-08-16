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
