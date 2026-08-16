---
title: "Durable Execution 技术地形"
type: research
status: open
assignee:
blocked-by: []
---

## Question

为「在 dsh fork 内实现 Agent 的 Durable Execution」调研外部技术地形：Temporal、Restate、DBOS、Resonate 等 durable execution 引擎的核心语义各是什么（event sourcing、deterministic replay、journal、timers、retries、compensation、exactly-once vs at-least-once）？哪些语义是「单进程嵌入、SQLite/文件持久化起步」的 TS 引擎必须有的第一性构造，哪些是分布式才需要的？各家如何处理非确定性边界（LLM 调用、工具调用这种人在外面）与 human-in-the-loop 挂起/恢复？给出一个面向 G1 决策（Durable Execution 语义与基座选型）的对比矩阵与推荐输入。
