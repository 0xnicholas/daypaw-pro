# Durable Execution 技术地形

> Wayfinder research 票 [#2 「Durable Execution 技术地形」](https://github.com/0xnicholas/daypaw-pro/issues/2) 的调研产出。
> 分支：`research/durable-execution-landscape`。父决策票：[#6 「Durable Execution 语义与基座」](https://github.com/0xnicholas/daypaw-pro/issues/6)（另被 [#7 Engine 与 SDK 编程模型边界] 间接消费）。
> 方法：只读官方文档一手来源（docs.temporal.io、docs.restate.dev、docs.dbos.dev、docs.resonatehq.io、learn.golem.cloud、littlehorse.io）+ 本地 dsh 仓库事实。日期：2026-08-16。

## 0. TL;DR

六家引擎（Temporal / Restate / DBOS / Resonate / Golem / LittleHorse）在表面差异之下收敛到同一组不可约语义：**① 追加式 journal（记录 effect+result）→ ② 恢复时按序重放/去重（不重执行已完成的非确定性操作）→ ③ 持久 timer → ④ 持久 promise（外部事件/人类输入的挂起-恢复）→ ⑤ 作为数据的重试策略 → ⑥ 副作用的幂等键（at-least-once 之上凑 exactly-once）→ ⑦ 每个 run 的单写者**。对「单进程嵌入、SQLite/文件起步」的 TS 引擎，①–④ + ⑦ 是第一性必选；任务队列/worker 集群、副本复制、HA、WASM 沙箱都是分布式才需要。**基座推荐输入：在 dsh seam 上自建嵌入式引擎**（借鉴 Resonate 的 durable-promise 抽象与 DBOS 的 step-dedup 简洁性；Resonate local→production 的形态证明 journal 协议可为日后接服务器留口），而非内嵌/对接外部引擎——最终裁决归「Durable Execution 语义与基座」票。

---

## 1. 六家引擎逐一分析

### 1.1 Temporal —— 重放模型的原典

- **Event sourcing**：每个 Workflow Execution 产出 Commands、消费 Events，全部记录进 **Event History**——「完整、有序、一切已发生之事的日志，workflow 中一切的 source of truth」（[workflows](https://docs.temporal.io/workflows)）。
- **确定性重放**：恢复**不是**恢复内存快照，而是「从头重跑 workflow 代码，逐步重放 Event History，用历史把代码导回原状态」；已记录的 activity/timer 结果被复用而非重执行；重放可从缓存状态短路（[workflows](https://docs.temporal.io/workflows)）。
- **确定性约束**：workflow 代码「给定相同历史必须做出相同决策」；禁止直接 `Date.now()`、随机数、workflow 内直接网络调用；时间/随机性走 replay-safe 的 context API（[workflows](https://docs.temporal.io/workflows)）。
- **非确定性边界（Activities）**：一切与外部世界的交互（API、DB、**LLM 调用**、文件 I/O）归 Activity；「Activity 运行一次，结果记入 Event History；重放时复用」（[workflows](https://docs.temporal.io/workflows)）。
- **副作用语义**：activity task **at-least-once**（[standalone-activity](https://docs.temporal.io/standalone-activity)：默认 at-least-once + 原生重试，max attempts=1 则 at-most-once）；官方要求 activity 设计为幂等，「activity 可能因重试执行多次」（[error-handling](https://docs.temporal.io/best-practices/error-handling)、[activity-definition](https://docs.temporal.io/activity-definition)）；重放内已完成的 activity 不会重执行（[activity-definition](https://docs.temporal.io/activity-definition)）。
- **重试**：Retry Policy（initial interval、backoff 系数、max attempts、non-retryable error types 列表），activity 默认自动重试（[retry-policies](https://docs.temporal.io/encyclopedia/retry-policies)）。**补偿不是原语**——Saga 是模式/拦截器层面的事。
- **Timer**：作为事件记录（"Started Timer for 5 minutes"），重放时不再等待（[workflows](https://docs.temporal.io/workflows)）。
- **HITL**：Signal（fire-and-forget，需确认则用带 validator 的 Update）携带结构化审批数据 + `condition(predicate, timeout)` 阻塞等待 + 超时升级/拒绝路径；信号入 history 即内置审计轨迹（[approval pattern](https://docs.temporal.io/design-patterns/approval)、[sending-messages](https://docs.temporal.io/sending-messages)）。官方 AI cookbook 有 LLM agent 人类审批的 signal 范式（[human-in-the-loop-python](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python)）。
- **嵌入模型**：server 集群（多角色服务）+ worker 进程轮询 task queue；workflow 可跑数年。**不是库**。
- **TS**：一等公民 SDK，确定性约束由 SDK 强制（如拦截非确定性 API）。

### 1.2 Restate —— journal 化的「普通程序」

- **Journal + 跳过式重放**：每个产生副作用的步骤（调用、DB 更新、timer）连同**结果**记入 journal；崩溃后重放 journal，「跳过已完成步骤、从离开处精确续跑」（[durable_execution](https://docs.restate.dev/concepts/durable_execution)）。
- **invocation 恰好一次**：Restate 跟踪 invocation 至完成，「无论失败与否恰好运行一次」；所有流量经 Restate 代理：失败调用自动重试、同一次调用不重复执行（[durable_execution](https://docs.restate.dev/concepts/durable_execution)）。
- **Virtual Objects / Workflows**：服务端内嵌 KV 存储，状态**随执行一起被 journal**，永不与执行脱同步；**单写者保证**（同一时刻仅一个 handler 改状态）；文档明确把「agent context/memory」列为用例（[durable_execution](https://docs.restate.dev/concepts/durable_execution)）。
- **三个持久协调原语**（TS SDK，[external-events](https://docs.restate.dev/develop/ts/external-events)）：
  - **Signal**：按 invocation-ID+name 寻址，可**多次** resolve，每次 await 取下一个；可先于等待到达（durable 存储缓存）。
  - **Awakeable**：一次性、生成唯一 ID 的「task token」，外部系统经 Restate HTTP API resolve/reject——**外部/人类回调的标准件**；reject 向等待方抛 terminal error。
  - **Workflow promise**：workflow-keyed + 逻辑名，resolve 一次、保留期内可被该 workflow 多个 handler 反复查。
  - 无事可做时 invocation **挂起**（FaaS 上等待不付算力费），结果到达即恢复。
- **嵌入模型**：Restate server（单个 Rust 二进制 → HA 集群）作为反向代理/消息代理置于服务前；服务本身任意部署。
- **TS**：一等 SDK（TS/Java/Kotlin/Python/Go/Rust）。

### 1.3 DBOS —— 嵌入库形态的代表

- **库而非服务器**：「DBOS 是一个构建可靠程序的库，加几个注解即可 durable 执行」（[docs.dbos.dev](https://docs.dbos.dev/)）。TS/Python/Go/Java。
- **Workflow = steps 的函数**：`DBOS.registerWorkflow(fn)`，`await DBOS.runStep(() => stepOne())`；输入输出必须 JSON 可序列化（[workflow-tutorial](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)）。
- **检查点语义**：DBOS 将 workflow/step 的状态**checkpoint 到系统数据库**；崩溃/重启后「自动从**最后一个完成的 step** 恢复」（[workflow-tutorial](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)）——即 step 粒度的进度恢复 + step 去重，而非 Temporal 式「从头重放全史」。
- **副作用语义**：「steps 尝试 **at least once**，但**一旦完成绝不重执行**」——失败中的 step 可重试，完成后同 workflow 内即 exactly-once 化；事件处理/定时任务有 OAOE（exactly-once）（[docs.dbos.dev](https://docs.dbos.dev/)）。
- **配套**：Postgres 支撑的可靠队列、调度、workflow 图形 UI 管理界面（[docs.dbos.dev](https://docs.dbos.dev/)）。
- **嵌入模型**：进程内库 + Postgres 系统库（**需要 Postgres**，无 SQLite 文件形态——对本项目是个硬约束）。

### 1.4 Resonate —— Durable Promise 本体论

- **编程模型**：「分布式 async/await」的形式化实现——**durable promise** 是核心协调原语，有正式 spec（状态机 pending→resolved/rejected/timedout/cancelled，幂等键 `ikc`/`iku`、`strict` 标志）（[durable-promise-specification](https://docs.resonatehq.io/spec/programming-model/durable-promise-specification)）。
- **崩溃存活**：进程崩溃时「从头重放你的函数，但用上次尝试的**已记录结果**替代昂贵的重执行（API 调用、DB 写）」；恢复流程：检测失败 → 在另一进程重启函数 → 从最后成功 checkpoint 续 → 返回同一结果（[develop](https://docs.resonatehq.io/develop)）。
- **约束（比 Temporal 轻）**：非确定操作包进 `ctx.run()`（结果记录并复用）；函数设计为可安全重试；长等待用 `ctx.sleep()`（小时/天/周不阻塞进程）（[develop](https://docs.resonatehq.io/develop)）。
- **原语**：`ctx.run()` / `ctx.sleep()` / `ctx.rpc()`（跨进程如本地调用）/ **durable promises**——「协调进程、**人类**与系统；等待可能耗时数天的外部输入（如审批）」（[develop](https://docs.resonatehq.io/develop)）。
- **自动幂等**：重试时不重执行已成功操作，「外部 API 恰好一次、支付不重复扣、邮件不重发，无需写去重逻辑」（[develop](https://docs.resonatehq.io/develop)）。
- **嵌入模型（关键）**：**local mode 零依赖**（无 server、无 DB、无基础设施即可开发/测试）→ 生产模式接 Resonate Server，「本地 workflow 变成分布式容错系统，**代码不改**」（[develop](https://docs.resonatehq.io/develop)）。
- **TS**：一等 SDK（TS/Python/Rust/Go）；Apache-2.0 开源；文档现在直接自称「agent-native durable execution」。

### 1.5 Golem —— oplog + 版本化 Agent Type

- **Agent = 持久有状态执行单元**，按 **Agent Type**（代码+配置的**版本化定义**）发布；版本可并行运行、新实例路由到新版本、**存活 agent 无停机前向迁移**（[concepts](https://learn.golem.cloud/concepts)）。
- **Oplog**：「inputs、messages、effects、decisions 的追加式记录，支撑可观测与重放」；节点故障时调度器「从最后 checkpoint 恢复状态，从那里重放；重放跳过已完成步骤、调和已提交的 effect」；「确定性恢复下 exactly-once」（[concepts](https://learn.golem.cloud/concepts)）。
- **调节旋钮（SDK 区域性作用域）**（[durability](https://learn.golem.cloud/develop/durability)）：persistence level（`PersistNothing` 恢复时副作用**重执行** / `PersistRemoteSideEffects` / `Smart` 默认）；idempotence mode（假定 HTTP 幂等与否：不可判定时重试 vs 直接失败）；**atomic regions**（一组 effect 失败后整体重执行）；`oplogCommit(n)` 等待 oplog 复制到 n 副本。
- **HITL**：「为人类审批/webhook **以零算力挂起**，事件或 timer 到达即恢复」；挂起带 deadline 与 fallback（自动取消/升级/默认值）；决策 exactly-once 落日志（[concepts](https://learn.golem.cloud/concepts)）。
- **存储分层**：blob + KV + **可索引的追加式 oplog 存储**（[persistence](https://learn.golem.cloud/v1.5/operate/persistence)）。
- **嵌入模型**：server/集群 + WASM 组件执行（TS 编译为 WASM 组件）；外部交互只能经授予的 capability。**沙箱是其结构性卖点，单进程嵌入不适用**。

### 1.6 LittleHorse —— 声明式图 + 原生 UserTask

- **模型**：server + worker 轮询 task queue（形态近 Temporal），但 workflow 是**声明式 WfSpec 图**而非代码：TASK / EXIT / SLEEP / **USER_TASK** / EXTERNAL_EVENT 节点、interrupt、变量变更、异常处理（[user-tasks](https://littlehorse.io/docs/server/concepts/user-tasks) 及 developer-guide）。
- **UserTask（HITL 的一等公民）**：`UserTaskDef`（表单 schema：name/type/displayName/required）+ `UserTaskNode`（WfSpec 内节点）+ `UserTaskRun`（实例：UNASSIGNED→ASSIGNED→DONE/CANCELLED）；指派给 user/group（纯字符串）；WfRun 在节点处**阻塞**直到 `CompleteUserTaskRun`；hooks 自动化：超时**改派**、提醒 TaskRun、超时自动取消（[user-tasks](https://littlehorse.io/docs/server/concepts/user-tasks)）。
- **对 daypaw 的启示**：声明式把「人类表单/审批」从模式提升为 schema 化节点——对 Manager 的审批 UI 有直接参考价值。

### 1.7 其他值得记录的名字

**Azure Durable Functions / Inngest / Trigger.dev** 等同属「journal + step 去重 + 持久 timer」家族（replay/checkpoint 差异同上谱系），本票未深潜；LittleHorse 之外各家对 **compensation/saga 均非原语**而是模式（Temporal 官方把幂等 activity + 业务补偿留给用户，[error-handling](https://docs.temporal.io/best-practices/error-handling)）。

---

## 2. 对比矩阵

| 维度 | Temporal | Restate | DBOS | Resonate | Golem | LittleHorse |
|---|---|---|---|---|---|---|
| **journal/replay 模型** | 全史 event sourcing，从头确定性重放（缓存可短路） | journal（effect+result），跳过式重放 | step 检查点（进系统库），从最后完成 step 恢复 | 从头重放 + 已记录结果复用 | oplog + checkpoint，重放调和已提交 effect | WfRun 事件溯源存储 |
| **代码形态** | 代码优先，强确定性约束 | 代码优先（handler 像普通应用），约束较轻 | 代码优先（注解/装饰器），约束最轻 | 代码优先，`ctx.run` 包裹非确定操作 | 代码（编译为 WASM 组件），区域旋钮 | **声明式图**（WfSpec），非代码 |
| **持久 timer** | ✅ 事件化，重放不等待 | ✅ journal 化 | ✅（sleep 原语） | ✅ `ctx.sleep` 天/周级 | ✅（恢复即重新调度） | ✅ SLEEP 节点 + hook 超时 |
| **HITL 原语** | Signal/Update + `condition(timeout)`（模式级） | **Signal / Awakeable / Workflow promise 三件套**（原语级） | 无专用原语（步骤内自担） | **durable promise**（等人类数天，一等抽象） | 零算力挂起 + deadline/fallback，决策 exactly-once | **UserTask 节点**（表单 schema + 改派/提醒 hook） |
| **重试** | Retry Policy（数据化：间隔/退避/上限/不可重试类型） | 自动重试至成功 | step 失败重试、完成不重执行 | 自动重试 + 幂等键 | 区域 retry policy + idempotence mode | 任务级重试 + 异常处理节点 |
| **副作用语义** | at-least-once（activity 幂等要求）；重放内不重执行 | invocation 恰好一次；无重复调用 | 完成后不重执行（≈step 粒度 exactly-once）；OAOE | 「不重执行已成功操作」（记录+复用） | 中介 effect 带幂等键，exactly-once | 事件 at-least-once + 幂等 task |
| **状态模型** | 无状态 workflow（状态=历史投影） | Virtual Object：KV+单写者+journal 化 | Postgres 系统库 + 业务 DB | promise + checkpoint | oplog/KV/blob 分层；agent 单写者、流有序 | WfRun 变量（事件溯源） |
| **嵌入形态** | server 集群 + worker 轮询 | server（单二进制→集群）前置代理 | **进程内库**（需 Postgres） | **local 零依赖库 → server 生产，代码不改** | server/集群 + WASM | server + worker 轮询 |
| **TS 一等支持** | ✅ 成熟 | ✅ | ✅（但绑 Postgres） | ✅（Apache-2.0，自称 agent-native） | ✅（经 WASM 组件） | worker SDK 多语言 |
| **版本化/迁移** | Worker Versioning / Patches（重放断裂的处理） | 服务版本化 | 函数版本演进（弱） | promise spec 版本化 | **Agent Type 并行版本 + 存活迁移**（最强） | WfSpec 版本化 |

---

## 3. 提取：单进程嵌入 TS 引擎的第一性语义 vs 分布式才需要

### 3.1 第一性必选（单进程、SQLite/文件、嵌入库形态也逃不掉）

1. **追加式 journal：effect + result 一起记**。六家全部如此（Temporal Event History / Restate journal / DBOS 检查点 / Resonate 记录结果 / Golem oplog / LH 事件存储）。这是唯一能同时支撑：崩溃恢复、可观测（Manager 的数据源）、审计、**EVO 的评估集原料**的单一结构。
2. **重放/去重语义**（两个谱系，SDK 形态决定取舍）：
   - *全史确定性重放*（Temporal/Resonate/Golem）：恢复力最强（任意历史可复核），代价是代码确定性约束 + **代码版本纪律**（改代码会破坏旧 run 的重放）。
   - *step 进度恢复*（DBOS）：约束最轻、实现最简单，代价是恢复粒度粗一步、控制流不保证跨版本一致。
   - 对 `defineWorkflow` 代码优先 SDK：两者在「journal + 按 key 去重的 step」处**收敛**——先按 DBOS 谱系实现、把「全史可重放」留给 session log 层，是合理的分层。
3. **持久 timer**：journal 里记 wake-at 时间戳，进程重启扫描到期唤醒。dsh 的 schedule 包是天然挂载点。
4. **持久 promise / HITL gate**：可从外部（人类/UI/webhook）resolve 的带 key 挂起，配超时与拒绝路径。Restate 的三件套、Resonate 的 durable promise、LH 的 UserTask 是三种成熟切法；**对 agent 场景这是比 retry 更核心的原语**（审批、ask-user、ACP 交互）。
5. **数据化的重试策略**：policy 记进 journal（崩溃后重试仍知道已试几次），否则恢复即丢失重试计数。
6. **幂等键**：at-least-once 是执行侧不可消除的底；exactly-once 只能靠「effect 带幂等键 + 去重表」（Temporal 建议、Golem 中介键、Restate invocation id、DBOS step 名）。daypaw 的工具调用（写文件、发请求）需要工具级幂等键约定。
7. **每 run 单写者**（Restate 单写者、Golem 流有序、Temporal workflow-id 唯一）：一次 run 同一时刻只有一个驱动者——dsh 的「一个 session 一个 agent loop」与此同构。
8. **版本化执行定义**：run 记录其 workflow/agent 定义版本；**EVO 的候选版本必须能与 incumbent 并行运行**（Golem Agent Type 是范本），否则优化迭代会破坏在飞 run 的重放。

### 3.2 分布式才需要（v1 明确不做，但别把门焊死）

- task queue + worker 舰队轮询（Temporal/LH）——单进程内就是调度器调用；
- 副本复制 / `oplogCommit(n)` / HA 集群 / 多 DC（Temporal 集群、Golem、Restate HA）；
- 跨机 durable RPC / 网络分区下的重试风暴治理；
- 多租户 namespace、大规模 visibility API；
- WASM 沙箱隔离（Golem）——可信 TS 进程内不需要；
- 跨 fleet 的 sticky queue / 缓存失效。

**留口设计**：Resonate 的 local→production（同一代码，换部署形态）证明 journal 协议可以「先嵌入后服务化」。daypaw 引擎的 seam 应保证：journal 读写、promise 解析、timer 调度三者都是可替换接口，日后 EVO 的评估 worker 想跑独立进程时可平滑外提。

---

## 4. 对 daypaw-pro 的含义（面向「Durable Execution 语义与基座」票的推荐输入）

**dsh 现状对照**（本地仓库事实）：session log 已是 append-only、JSON 可序列化、有 jsonl/sqlite 持久化与 `SESSION_FORMAT_VERSION` 钉版本（`packages/session/*`、`docs/persistence-catalog.md`）；但 jobs 族是**进程内存态注册表**（`jobs-local` README：LocalJobRegistry 全内存）、workflow 跑 worker thread（非持久）、schedule/spill 同样进程内——**崩溃即丢**。SDK（protocol/client/server）是 stdio JSON-RPC 的进程驱动协议。

**基座三选项**：

| 选项 | 语义覆盖 | 与 dsh 契合 | 代价/风险 |
|---|---|---|---|
| **A. dsh seam 上自建嵌入式引擎**（推荐输入） | 完整可控：journal 落 storage seam（sqlite/jsonl），promise/timer 表新造；语义边界即 §3.1 八条 | ★★★ 与「一切皆插件」「model-visible means logged」同构；engine 可作为 Cordis 插件族暴露 `ctx.durable`；非确定操作天然锚在现有 waterfall（`agent/request`、`tools/*`）上 | 自建工作量：journal schema、唤醒调度、promise 状态机、幂等键约定；但边界清晰有界 |
| B. 嵌 Resonate local mode（TS、Apache-2.0） | 语义最快到位（durable promise 原语齐全），local→server 升级路 | ★ 引擎 journal 与 dsh session log **双事实源**，违反「model-visible means logged」不变量；Cordis 组合性打折 | 外部依赖 + 上游节奏绑定 |
| C. Temporal dev server / DBOS | 语义最厚 | ★★ Temporal：server+worker 形态与进程内 Cordis 相拧；DBOS：**强制 Postgres**，与 SQLite/文件起步冲突 | 运维面超出「自用基础设施」 |

**推荐输入**（供 grilling 裁决）：选 **A**——以 §3.1 的 ①–④+⑦ 为 v1 语义内核：① LLM/工具调用经 waterfall 事件锚点 journal 化（effect+result）；② 恢复 = step 去重的续跑（DBOS 谱系），全史重放能力由 session log 本身提供；③ timer 落 journal + 重启扫描（挂到 schedule 族）；④ HITL = durable promise（键 = run-id+gate 名，人类经 SDK/Manager resolve，配超时/拒绝）；⑦ 每 run 单写者。**⑤⑥⑧** 作为 schema 字段与规范预留（retry policy 列、幂等键列、定义版本列）。§3.2 明示不做但接口留口。

**给 EVO 的直接馈赠**：journal 的 effect+result 记录就是评估集原料（trace→eval 的数据通路）；Golem 式 Agent Type 并行版本 = EVO incumbent/candidate 的执行模型；dsh feedback 包（log-only 备注）可挂为 promise resolve 侧的标注源。

**给 Manager 的直接馈赠**：引擎 journal（run/step/effect/promise/timer）即观测事件流，OTel 导出是它的一次投影；LH UserTask 的表单 schema + 改派/提醒 hook 是审批 UI 的成熟参考。

---

## 5. 开放问题（留给后续票）

1. **journal 落点**：扩展 `SessionEventMap`（引擎事件进 session log，与「model-visible means logged」最贴）vs 独立 engine journal（职责更干净，但双流）——依赖 [#3 dsh seam 清点] 的产出，由「Durable Execution 语义与基座」票裁决。
2. **确定性谱系的最终选择**：step 去重续跑（推荐 v1）够不够 EVO 回放/回归评估用，还是需要全史确定性重放？
3. **compensation/saga**：六家均非原语；daypaw 的工具集（文件写、shell）要不要 saga 语义，还是「幂等键 + 人工干预 + 重试」即可？
4. **SQLite 并发**：WAL + 每 run 单写者下的多 run 并发读写方案（引擎实现票）。
5. **代码版本纪律**：`defineWorkflow` 版本如何随 run 固化；EVO 候选版本的并行运行约束。

## 6. 来源

**外部（一手官方文档，均为 2026-08-16 拉取）**
- Temporal：[workflows](https://docs.temporal.io/workflows)、[approval pattern](https://docs.temporal.io/design-patterns/approval)、[retry policies](https://docs.temporal.io/encyclopedia/retry-policies)、[activity definition / idempotency](https://docs.temporal.io/activity-definition)、[error handling](https://docs.temporal.io/best-practices/error-handling)、[standalone activity](https://docs.temporal.io/standalone-activity)、[sending messages](https://docs.temporal.io/sending-messages)、[AI cookbook HITL](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python)
- Restate：[durable execution](https://docs.restate.dev/concepts/durable_execution)、[TS external events](https://docs.restate.dev/develop/ts/external-events)
- DBOS：[docs 首页](https://docs.dbos.dev/)、[TS workflow tutorial](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)
- Resonate：[develop](https://docs.resonatehq.io/develop)、[durable promise specification](https://docs.resonatehq.io/spec/programming-model/durable-promise-specification)
- Golem：[concepts](https://learn.golem.cloud/concepts)、[durability](https://learn.golem.cloud/develop/durability)、[persistence](https://learn.golem.cloud/v1.5/operate/persistence)
- LittleHorse：[user tasks](https://littlehorse.io/docs/server/concepts/user-tasks)

**本地（dsh 仓库，只读）**
- `docs/architecture.md`（session log / waterfall 事件 / capability seams）
- `docs/persistence-catalog.md`（SessionEvent 包络、`SESSION_FORMAT_VERSION=0`）
- `packages/jobs/jobs-local/README.md`（内存注册表——持久化缺口）
- `packages/workflow/README.md`（worker thread 执行、非持久）
- `packages/sdk/README.md`（stdio JSON-RPC 驱动协议）
