---
title: "Agent 观测/管理技术地形"
type: research
status: open
assignee:
blocked-by: []
---

## Question

为「Agent Manager（Telemetry/Observability + 管理面）」调研外部技术地形：OTel GenAI semantic conventions 现状（span/attribute 覆盖 LLM/tool/agent 的程度）、LangSmith / Langfuse / Arize Phoenix 的数据模型（trace→span→generation、feedback、eval、dataset、experiment 的建模方式）与可借鉴/可嵌入性（自托管？库化？）、以及 fleet 级 agent 管理面有哪些已知形态（Temporal Web、LangGraph Platform、自建 dashboard）。回答：一个自用的、挂在 dsh fork 上的 Manager 最小完备数据模型是什么？哪些该直接吐 OTel、哪些需要本地库（评估/回放/feedback 关联）？给 G3（Manager 范围）决策提供输入。
