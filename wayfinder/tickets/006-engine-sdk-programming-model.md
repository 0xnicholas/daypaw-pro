---
title: "Engine 与 SDK 编程模型边界"
type: grilling
status: open
assignee:
blocked-by: [2]
---

## Question

代码优先的 Agent Programming 模型长什么样、它与 Engine 的边界在哪？要敲定：`defineAgent` / `defineWorkflow` 的词汇表（step/parallel/condition/human-gate/sleep/sub-agent？类型系统怎么表达输入输出）；SDK 定义的 agent 与 dsh 既有概念（preset、composition、session）的映射（一个 defineAgent = 一个 preset？工具/schema 如何声明）；`run()` 的执行语义（落到 durable engine 上的一个 run；崩溃恢复后同一调用如何续）；human-in-the-loop 原语（yield 等外部事件）；SDK 是纯库（进程内嵌 engine）还是经由 dsh SDK protocol 驱动独立 runtime（还是两者一个 API 两后端）；worker/queue 的部署形态。产出 ADR 0002 + spec 第 2 章骨架输入。依赖「dsh seam 清点」。
