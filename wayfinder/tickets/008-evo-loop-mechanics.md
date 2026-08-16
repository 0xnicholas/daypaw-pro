---
title: "EVO 循环机制"
type: grilling
status: open
assignee:
blocked-by: [2, 3]
---

## Question

EVO——用户 Agent 的持续优化系统——的循环机制怎么设计？要敲定：优化对象粒度（整个 defineAgent 配置？prompt 段？工具选择/描述？模型/参数？）；评估集从哪来（运行遥测自动提取？人工标注？合成生成？混合）；候选生成（谁生成变体——EVO 自身的 agent？规则？）；回归策略（必须不差于 incumbent 的判据、评估集漂移怎么防）；发布与版本化（新版本如何生效、provenance 记录什么、如何回滚）；安全边界（EVO 可以自动发布还是人审 gate；成本上限）；EVO 自身是否是一个跑在 durable engine 上的 workflow（吃自己的狗粮）。产出 ADR 0004 + spec 第 4 章骨架输入。依赖「dsh seam 清点」与「Agent 观测/管理技术地形」。
