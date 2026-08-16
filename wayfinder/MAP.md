---
title: "daypaw-pro Agent Stack 架构图"
type: map
status: open
label: wayfinder:map
---

# daypaw-pro Agent Stack 架构图

## Destination

一份可交付实施的完整架构设计 spec：daypaw-pro = fork of deepseek-harness + in-tree 四支柱扩展（① Durable Execution、② Agent Engine + Agent SDK 代码优先编程模型、③ Agent Manager 观测/管理、④ EVO 用户 Agent 持续优化系统），形态为 `docs/spec/`（00-overview + 四支柱）+ `docs/adr/` + `docs/CONTEXT.md` 领域词汇表。到达判据：**实现者不再需要回来问设计问题**。

## Notes

- **域**：TypeScript agent 基础设施；dsh fork（参考仓库本地路径 `/Users/nicholasl/Documents/build-whatever/deepseek-harness`，只读，勿改）。
- **已锁定的骨架决策**（charting 时与用户敲定）：
  - Fork dsh + in-tree packages，保持与上游（dev-preview，breaking changes 频繁）的 merge 可能性。
  - SDK 为代码优先编程模型（`defineAgent` / `defineWorkflow` 风格，Temporal 式），现有 dsh SDK（protocol/client/server, stdio JSON-RPC）成为底层传输层。
  - EVO 优化**用户的 Agent**（遥测→评估集→候选优化→回归→发布），不优化 stack 自身。
  - 自用基础设施：不考虑多租户、计费、公开 API 稳定性承诺。
  - 语言/栈沿用 dsh：TypeScript、pnpm monorepo、Cordis 插件体系、Vitest。
- **技能约定**：HITL 票用 `/grilling` + `/domain-modeling`（一次一问，决策写 ADR/CONTEXT.md）；research 票用 `/research` subagent；spec 草稿反应用 `/prototype`。
- **Tracker 约定（local-markdown）**：本目录即 issue tracker。地图 = 本文件（`wayfinder:map`）；票 = `wayfinder/tickets/NNN-<slug>.md`，frontmatter `status: open|closed`、`assignee`（claim 即赋值）、`blocked-by: [ids]`；**frontier** = open 且全部 blocker 已 closed 且无 assignee 的票；决议写成票内 `## Resolution` 段后置 `status: closed`；research 产出落在 `research/<name>` 分支，合并回 `wayfinder/research/` 并在票内链接。行文一律以票名指代，不裸用编号。

## Decisions so far

<!-- 一行一个已关闭的票：标题链接 + 一句话要点 -->

（尚无 —— research 票在飞行中）

## Not yet specified

<!-- 雾：能感到要来、还写不成一张票的 -->

- **引擎包结构**：durable engine 在 fork 里如何切成 in-tree packages（哪些 ctx seam、新增哪些 SessionEventMap 事件、jobs/workflow/schedule 三个现有族的改造或收编方式）——等 Durable Execution 语义与 SDK 编程模型两票落地后才可及物。
- **Manager 的形态与 UI 架构**（web app 复用 dsh-web 还是独立面；控制操作集）——等 Manager 范围敲定。
- **EVO 的版本化/provenance 模型**及其与 Manager 的数据依赖（评估数据从哪来、发布物长什么样）——等 EVO 循环机制敲定。
- **测试策略**：如何在持续合并上游的同时保持 dsh 测试套件绿色 + 四支柱自己的测试（金丝雀 profile？冻结 vendor？）——等上游同步策略 + 各支柱 spec 出现。
- **落地顺序与 walking skeleton 切片**：哪个支柱先立起来、spec 分几批交付——临近终点时再排。
- **命名**：stack 及包名（`@daypaw/*`？沿用 `@deepseek-ai/*` 别名？）——并入上游同步策略票的余波，若溢出再单独开票。

## Out of scope

<!-- 越过目的地的范围，closed 不复活 -->

（尚无）
