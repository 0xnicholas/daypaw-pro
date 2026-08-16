# Palantir Agent Stack（DevCon 6）— daypaw-pro 的参照系

> Wayfinder 票 [#6](https://github.com/0xnicholas/daypaw-pro/issues/6) grilling 中途的用户揭示：**daypaw-pro 是 dsh 与 Palantir Agent Stack 思想的结合产物**。四支柱即其自用开源版。本文件存证研究结论，供全图各票引用。
> 日期：2026-08-30。来源：Palantir 官方发布（DevCon 6 演讲、LinkedIn 帖、blog.palantir.com）——全部 vendor-sourced，无独立评审。

## 栈全景（DevCon 6 发布）

| 组件 | 职责 | 关键机制（原话/转述） |
|---|---|---|
| **Orchestrator** | durable execution 基础设施层 | agent run 的**每一步都记进 ledger**；崩溃后**重放 ledger 而非重跑代码**，副作用只发生一次；等待人类签核时 agent 可**完全关机、零算力**，数天后**原地精确恢复**。动机：「agent 有用性的瓶颈不是智能，是信任」——三类不可信失败：丢上下文、重复副作用（如重复开药方）、无限等待审批 |
| **Agent Engine + Agent SDK** | 核心编程原语 | agent 建模为**状态机**：「把这三个原语缝起来，你得到的 agent loop 底层实际是一台分布式状态机」，multiplayer by design。三原语：**Context Items**（强类型数据定义/持有 agent 会话状态）、**Events**（对状态变化的表达性响应/触发）、**Effects**（连接外部世界）。Demo：约 20 分钟搭出 patient-discharge agent |
| **Agent Manager** | actionable telemetry / 观测 | 监控-分析-优化闭环；AIP Inspect / Agent Timeline 把原始遥测自动转为**可读叙事**（治「遥测洪水」）；trace 是「深入分析的发射点」：每次数据查询可溯源数据源版本史、函数调用可溯源语义版本、LLM 子 agent 自动关联 Evals 套件 |
| **AIP Evolve** | 持续端到端优化 | 自主地：**换模型**（swap models）、**调 prompt**、**验证输出**（validating outputs）、**找结构化 ontology 数据以消除不必要的 LLM 调用**——让 agent 更高效更省钱 |
| （外围）Agent Builder & SuperRepo | 构建/仓库 | 本图不映射 |

## 与 daypaw-pro 四支柱的映射

- **① Durable Execution = Orchestrator**：ledger+重放、零算力等待、原地恢复。dsh 缺口正好是这块（seam 清点：「对话史活着，但一切正在做的都死了」）。
- **② Engine + SDK = Agent Engine/SDK**：Context Items / Events / Effects 三原语 ↔ dsh 的 session log / 事件总线 / capability seams 高度同构——daypaw 的 SDK 词汇表应向这三原语看齐（`defineAgent` 的 state/context、事件订阅、effect=tool/外部调用）。
- **③ Manager = Agent Manager**：「actionable」+ 叙事化（Inspect/Timeline）是产品标准；遥测→trace→每个调用点可溯源版本+关联 eval——与研究票 #4 的三层数据模型互补。
- **④ EVO = AIP Evolve**：优化维度明确为四类：模型选择、prompt、输出验证、**用结构化数据消灭不必要 LLM 调用**。发布口径「自主」（autonomously）——人审 gate 是 daypaw 要自己决定的偏差点。

## 与 dsh 结合的张力（供后续票注意）

1. Palantir 跑在 Rubix（硬化 k8s、节点 ≤48h 强制轮换、「为中断而设计」）——自用单机没有这个底座，「关机零算力等待」的等价物 = 进程退出 + 外部唤醒机制（v1 的持久化级别问题的参照）。
2. Ontology 是 Context Items/结构化数据消除 LLM 调用的前提——daypaw 无 ontology，EVO 的「消除不必要调用」需要别的结构化数据源（journal + tool schema）。
3. multiplayer/distributed state machine 在自用单机 v1 = 进程内多 agent 组合（dsh 的 subagent/preset 已有雏形）。
4. 权限模型（marking/purpose/role、provenance-based security）属企业治理面，自用基础设施按已锁定决策不做（map Notes）。

## 来源

- LinkedIn：[三原语发布会帖](https://www.linkedin.com/posts/palantir-technologies_by-stitching-these-three-primitives-together-activity-7483247083630637056-e15a)、[Agent Engine 解读（rahgarg）](https://www.linkedin.com/posts/rahgarg_product-launch-agent-engine-devcon-6-activity-7487295886188957697-PGQd)、[Orchestrator 解读（rahgarg）](https://www.linkedin.com/posts/rahgarg_product-launch-agent-infrastructure-layer-activity-7490391566470062082-uif6)
- YouTube（DevCon 6）：Agent Engine 发布 `mDGjptFvePY`、Orchestrator 发布 `ZTw66mjYATo`
- Blog：[Securing Agents in Production (Agentic Runtime #1)](https://blog.palantir.com/securing-agents-in-production-agentic-runtime-1-5191a0715240)、[Connecting Agents to Decisions](https://blog.palantir.com/connecting-agents-to-decisions-277dee8ddb40)
- 检索聚合：palantir.com/devcon、docs（AIP observability / agents overview）
