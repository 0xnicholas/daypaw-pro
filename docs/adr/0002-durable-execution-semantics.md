# ADR 0002: Durable Execution 语义与基座（Durable Engine）

- **状态**：已接受（2026-08-30，[Durable Execution 语义与基座](https://github.com/0xnicholas/daypaw-pro/issues/6)）
- **参照**：Palantir Orchestrator（DevCon 6）语义 + 六家引擎第一性语义调研（`docs/research/durable-execution-landscape.md`）+ dsh seam 清点（`docs/research/dsh-seam-inventory.md`（v1，已被 v2 接替））
- **前置**：ADR 0001（fork 卫生：seam 优先、`packages/daypaw/` 新 family）

## 决策

### 1. 基座：在 dsh seam 上自建嵌入式引擎

否决内嵌/对接外部引擎（Resonate local / DBOS / Temporal dev server）——外部 journal 与 dsh session log 形成双事实源冲突、DBOS 强制 Postgres、Temporal server+worker 形态与进程内 Cordis 相拧。自建语义边界有界（journal schema、唤醒调度、promise 状态机、幂等键），且与「一切皆插件」「model-visible means logged」同构：引擎作为 Cordis 插件族暴露 `ctx.durable`。

### 2. 持久化级别：进程重启存活 + boot 扫描（无常驻 daemon）

- 一切 run 状态、timer、promise 落盘（SQLite；落点 = 自立库文件直驱，见 spec 第 1 章 §3 落实注记）；进程可随时退出。
- 唤醒 = **boot 扫描**：进程任何方式被拉起时，补发 overdue timer、恢复未完 run。可选 cron/launchd 定期拉起做「准 daemon」。
- v1 无跨主机/副本/HA/task queue；**journal 读写、promise 解析、timer 调度三者做成可替换接口**，为日后 daemon 化/服务化留口（Resonate local→production 谱系）。

### 3. Ledger 落点：独立 engine ledger，双事实源各管一事

- **Session log**（不动）：模型可见的一切；不变量 model-visible means logged 完好；不碰 `SESSION_FORMAT_VERSION`。
- **Engine ledger**（新，追加式；物理落点见 spec 第 1 章 §3 落实注记）：编排事实——`run/start·end`、`step/start·end`、`effect`（幂等键+结果）、`promise`（create/resolve/reject/timeout）、`timer`（schedule/fire）、数据化 retry policy、定义版本。
- 双向引用：ledger 行 → `(session.id, seq)`；session 事件可带可选 `runId` 字段。run 可跨 session/subagent 而不散射。
- Manager 观测与 EVO 评估集均以 ledger 为数据源（OTel 导出是它的一次投影——投影随③④子项目，ADR 0009；引擎 v1 不为此预留代码）。

### 4. 恢复谱系：step 去重续跑（DBOS 谱系）

恢复时重新驱动 workflow 控制流：已完成 step（按幂等键查 ledger）直接返回已记录结果，不重执行 effect；未完成 step 继续。无强确定性约束——改版本/改 prompt 不炸旧 run，与 EVO 高频变体并行直接兼容。全史对话重放由 session log 免费提供，引擎不重复。

### 5. HITL 原语：单一 durable promise（`ctx.waitFor`）

- 键 = `(runId, gate 名)`，幂等 resolve；状态机 pending→resolved/rejected/timedout/cancelled（对齐 Resonate durable promise spec）。
- payload 带 zod schema（Manager/UI 可渲染表单）；超时/拒绝是终态而非异常。
- resolve 入口统一走同一 seam：SDK 调用、Manager UI、（留口）webhook。
- 进程退出等待 = 零算力（决策 2）。

### 6. 上游三族：新栈旁立 + 可选适配

- 上游 jobs / workflow / schedule **不改不碰**（ADR 0001 纪律）；自有 profile 默认不装其模型侧工具。
- 可选适配（后续票裁决优先级）：jobs → 后台 effect 执行器 provider；schedule → timer provider；workflow → 不适配，被引擎取代。
- 短期代价：代码库两套编排概念并存，接受。

### 7. Schema 预留（v1 字段化，不做语义）

- 数据化 retry policy（`attempt` 列崩溃不丢计数；policy 列待 retry 面落地时以迁移加入）；effect 幂等键列；run 记录其 workflow/agent 定义版本（EVO incumbent/candidate 并行运行的前提，Golem Agent Type 谱系）。
- 补偿/saga 不做原语（六家亦非原语）：幂等键 + 重试 + 人工干预（Manager）覆盖。

## 后果

- 引擎包结构（`packages/daypaw/` 内切分）待 [Engine 与 SDK 编程模型边界] 落地后一并定。
- boot 恢复调度、SQLite WAL 并发（单写者 per run）为实现期设计题，spec 第 1 章覆盖。
- timer 准时性受拉起时机约束（无常驻），紧急 timer 需准 daemon——记入 spec 的运维注记。
