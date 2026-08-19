# daypaw-pro 架构设计总结报告

> 日期：2026-08-19。快照性质：[daypaw-pro 架构重审（批次 C 开工前把关）](https://github.com/0xnicholas/daypaw-pro/issues/20)（六票全闭）之后、批次 C 开工之前的架构现状总结。事实各归其家——决策见 [docs/adr/](../adr/)，规格见 [docs/spec/](../spec/)，词汇见根 [CONTEXT.md](../../CONTEXT.md)；本文只做综合与导览，不另立事实。

## 1. 总体形态：fork 上的双事实源栈

daypaw-pro = deepseek-harness（dsh）的 fork + in-tree 扩展。分层：

```
┌─────────────────────────────────────────────────────────────┐
│  用户应用（TypeScript 代码）                                  │
│    defineWorkflow / defineAgent → def.run(input) → RunHandle │  ← @daypaw/sdk（纯库 facade）
├─────────────────────────────────────────────────────────────┤
│  Durable Engine（ctx.durable 插件族）                         │
│    step 去重续跑 · boot 扫描 · claim 单写者 · 定义注册表       │  ← @daypaw/engine
│    Engine Ledger（SQLite WAL：runs/journal/promises/timers） │  ← @daypaw/store（中立契约包）
├─────────────────────────────────────────────────────────────┤
│  dsh 基座（上游，不改不碰）                                    │
│  Session Log（模型可见的唯一权威）· agent loop · tools ·      │
│  preset 组合 · subagent seam · web app · OTel               │
└─────────────────────────────────────────────────────────────┘
```

核心结构原则——**双事实源，各管一事**：

- **Session Log**（dsh 已有，不动）：对话与模型可见内容的一切；不变量 model-visible means logged 完好，不碰 `SESSION_FORMAT_VERSION`。
- **Engine Ledger**（新建）：编排事实的唯一权威——run 生命周期、step/effect（幂等键+结果）、promise（gate）、timer、定义版本。
- 两者**双向引用**：ledger 行携 `(session_id, seq)` 指回 session log；session 事件可带可选 `runId`（merge-extensible）。run 可跨 session/subagent 而不散射。

**现行 frame**（ADR 0009）：**两支柱现役 + 两个远期子项目**——① Durable Execution、② Agent Engine+SDK 在建；③ Agent Manager、④ EVO 降级为后期单独立项（spec 03/04 与 ADR 0004/0005 留作方向文档）。

**落地批次**（ADR 0008，重审后无变化）：A fork 导入（✅ checkpoint `daypaw-sync/2026-08-18`）→ B spec 第 1 章（✅）→ **C walking skeleton（待开工：store→engine→sdk 最薄竖切；证明线 = canonical example 真 SIGKILL 中段杀死、boot 后续跑至类型化完成）** → D spec 00-overview（最后写）。

**Fork 卫生**（ADR 0001）：新码全部落 `packages/daypaw/` 纯新增 family，`@daypaw/*` 独立 0.x private；上游文件触碰须登记 [docs/fork/CORE_TOUCHES.md](../fork/CORE_TOUCHES.md)；2–4 周定期 merge + checkpoint tag；加包程序 = [docs/fork/adding-a-daypaw-package.md](../fork/adding-a-daypaw-package.md) 活文档。

## 2. 引擎语义要点（支柱①，spec 01 正典）

- **八条第一性语义的 v1 取舍**：journal effect+result 合记、step 去重续跑（DBOS 谱系，无强确定性约束）、持久 timer、durable promise（`ctx.waitFor`，五态状态机）、`attempt` 字段化（retry 面按需）、幂等键（自动派生 + `opts.key` 逃生口）、每 run 单写者（claim 条件更新）、版本化定义。
- **持久化与唤醒**：自立 SQLite 库（node:sqlite + WAL + `busy_timeout`，不借 `ctx.storageDomain`）；无常驻 daemon，唤醒 = boot 扫描（补发 overdue timer、复活未完 run）；timer 语义 = 至少醒一次、迟到不丢。
- **可替换三缝**（JournalStore / PromiseResolver / TimerScheduler）：既是 daemon 化留口，也是故障注入崩溃测试的包装面（ADR 0007 双层崩溃测试依赖它）。
- **按需落地**（简化走查裁决）：走骨只含 `ctx.step`；sleep/waitFor/agent/spawn 语义已定、实现待首个真实需要它们的 workflow。

## 3. SDK 编程模型要点（支柱②，spec 02 正典）

- **两类定义、一个 run 概念**：`defineWorkflow`（代码编排体）与 `defineAgent`（声明式 spec：zod IO + 组合行）共享 run；ledger/Manager 只认 run。`agent.run()` 一等公民。
- **幂等 start-or-attach**：`def.run(input, { runId? })` 同 runId 已存在则接回；RunHandle = 类型化结果（output schema 校验后归因）+ `RunStatus` 判别联合 + cancel。
- **复用 dsh 组合语义**：agent 定义与 preset 同一挂载语义（来源 = 代码而非文件）；`tools` 直收 dsh `ToolDefinition` 零适配；session header 记 `(定义 id, 版本)` 供冷复活重建。
- **v1 纯库**：进程即 worker、ledger 未完 run 即队列、boot 扫描即拉起；API 运输无关，wire 扩展随③子项目裁决。

## 4. dsh × Palantir Agent Stack 整合设计

参照系 = Palantir Agent Stack（DevCon 6）四件套：Orchestrator / Agent Engine+SDK / Agent Manager / AIP Evolve（事实底座 [docs/research/palantir-agent-stack.md](../research/palantir-agent-stack.md)）。整合姿态：**把 Palantir 的语义映射到 dsh 的 Cordis 插件基座上——能借的借、撞名的拒、缺失的建**。

### 4.1 概念映射表

| Palantir | daypaw 对应物 | 整合姿态 |
|---|---|---|
| Orchestrator（ledger+重放、零算力等待、原地恢复） | Durable Engine（支柱①，`ctx.durable`） | 自建等价物，语义对齐 |
| Context Items / Events / Effects 三原语 | 五原语 `ctx.step/sleep/waitFor/agent/spawn` | 拒绝进口命名，只记同构 |
| Agent SDK（published agent = async function） | `def.run()` 一等公民 + RunHandle 类型化结果 | 采纳语义，自定类型面 |
| Agent Manager（actionable telemetry） | Manager 远期子项目 | 自建面收窄：跨 run/跨进程聚合 + durable run 视图 + 控制命令 |
| AIP Evolve | EVO 远期子项目 | 只取循环机制（评估集→变体→双门→提案），永不自动生效 |

### 4.2 五个关键整合裁决

1. **嵌入而非外接**（ADR 0002）：否决 Resonate/DBOS/Temporal 内嵌——外部 journal 与 session log 形成双事实源冲突。引擎作为 Cordis 插件族进树（与「一切皆插件」同构）；v1 纯库进程内嵌、无常驻 daemon；三缝可替换为日后 daemon 化留口。
2. **拒绝进口 Palantir 词汇**（ADR 0003 §2）：`Event` 与 dsh `session/event` 撞名、`Context` 与 `packages/context` 撞名——同词异义比不同词更乱，且 Palantir 无公开 API 可对标。五原语用引擎原生名；同构关系只记文档。正典名 **Durable Engine**（Orchestrator 为参照系别名）。
3. **两个定义动词而非一个**（ADR 0003 §1）：Palantir 只有单一 authored agent（重放状态机、控制流涌现）；daypaw 走 DBOS 谱系——run 执行**真实代码** + step 去重，代码体与声明式 spec 是两种真实的 body，SDK 诚实命名这一差异。
4. **复用 dsh 组合语义**（ADR 0003 §3）：agent 定义不另造组合系统——与 preset 同一挂载语义；「agent 调 agent」走 dsh subagent seam，不另造。
5. **上游三族旁立**（ADR 0002 §6）：dsh 的 jobs（内存）/ workflow（worker thread）/ schedule（session-local）不改不碰、自有 profile 不装其模型侧工具——执行级 durability 留白正是支柱①立身之地；可选适配（jobs→effect provider、schedule→timer provider）待①落地后再裁。

### 4.3 分层逻辑（一句话）

dsh 拥有「对话」的持久性，daypaw 补上「做事」的持久性：进程死了，session log 让对话史与叙事活着（显示级已有 `tool-workflow/*` 四事件），Durable Engine 让「正在做的事」自己复活（执行级 journal + 重驱动）。Palantir 提供语义参照系——什么值得持久化、等待如何零算力、结果如何类型化归因；dsh 提供基座与纪律——插件化、事件溯源、组合机制、fork 卫生。词汇撞名处，代码现实优先。

## 5. 重审裁决摘要（2026-08-19，ADR 0009 及后续）

- **需求**：③Manager ④EVO 降级为远期独立子项目（自用性价比 + 输入语料待①落地）；①②保留。
- **一致性**：9 项矛盾落回文档本体；正典名 Durable Engine；ADR 0003 RunStatus 判别联合回写；ADR 0004 wire 消歧（SDK wire ≠ Web Remote 面）。
- **简化**：五原语按需落地；OTel 投影随子项目、引擎 v1 零预留；`retry_policy_json` 出初版 schema（日后迁移加列）。
- **清晰度**：spec 02 workflow 面写满（43→126 行，原型 reconcile 到正典）；research 六份入 main；`docs/spec/README.md` 索引就位。
- **开工判据**：七项核查全过（[落地计划更新](https://github.com/0xnicholas/daypaw-pro/issues/26)），批次 C 可带着信心开工。

## 6. 下一步

批次 C：按 [docs/fork/adding-a-daypaw-package.md](../fork/adding-a-daypaw-package.md) 清单落 `@daypaw/store` → `@daypaw/engine` → `@daypaw/sdk`；批次 D 最后写 spec 00-overview。残余雾区（上游三族适配优先级）挂在 [daypaw-pro Agent Stack 架构图](https://github.com/0xnicholas/daypaw-pro/issues/1)（常开活索引）。
