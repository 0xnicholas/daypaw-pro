---
title: "Durable Execution 语义与基座"
type: grilling
status: open
assignee:
blocked-by: [1, 2]
---

## Question

daypaw-pro 的 Durable Execution 语义到底是什么级别、落在什么基座上？要敲定：持久化级别（进程重启存活？主机故障存活？要不要分布式）；语义模型（event-sourced journal + deterministic replay？checkpoint/resume？两者混合）；基座选型（在 dsh storage/session-log seam 上自建嵌入式引擎 vs 内嵌/对接现有引擎如 Temporal/Restate/DBOS）；非确定性边界怎么划（LLM/工具调用作为 journal 里的 effect，重放时取 recorded result）；human-in-the-loop 挂起（等外部输入数天）如何建模；与现有 jobs/workflow/schedule 三族的关系（收编、并存、还是逐步替代）；timer/sleep 的持久化。产出 ADR 0001 + spec 第 1 章骨架输入。依赖「Durable Execution 技术地形」与「dsh seam 清点」的发现。
