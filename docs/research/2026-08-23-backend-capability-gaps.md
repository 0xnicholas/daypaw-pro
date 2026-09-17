# 后端能力缺口盘点：产品壳四板块对照

> Wayfinder 研究票 [#38 「后端能力缺口盘点：产品壳需要的 API 面对照」](https://github.com/0xnicholas/daypaw-pro/issues/38) 的成果，隶属地图 [#35 「daypaw 产品壳前端 spec + 技术路线」](https://github.com/0xnicholas/daypaw-pro/issues/35)。日期：2026-08-23。调查对象：**本仓库当前树**（main @ `2be4cffa14`）。本地地形研究：一手来源为仓库自身代码与文档，引用一律为仓库内路径。

## 0. 范围与方法

产品壳四板块 = ①agent 对话、②任务/run 进度（业务语言呈现）、③审批待办、④agent 目录与设置（map #35 Destination）。对照面：dsh Web wire（`packages/host/apiproxy` + `packages/client/connection`）、Typert Remote 栈（`packages/api/`）、SDK JSON-RPC 面（`packages/sdk/`）、daypaw 引擎/SDK 查询面（`packages/daypaw/engine`、`packages/daypaw/sdk`、`packages/daypaw/store`）。支柱③ Manager 聚合查询面是远期子项目（`docs/adr/0009-pillar-review-manager-evo-deferred.md`），本文只盘点产品壳 v1 的最小查询子集。

两条影响全盘读法的事实先说清：

- **daypaw profile 当前是 headless 组合**（`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-headless`，`packages/daypaw/cli/src/index.ts:35`）——apiproxy/webserver/Typert 面都不在该组合内。路线 A/B（复用 web 后端）会把它们挂回来；这是组合配置问题，不是能力缺口，下文「已有」均指能力存在且可经组合启用。
- **sessionId ≡ runId**（ADR 0010；`packages/daypaw/sdk/src/agent.ts:271` `SessionId(stepCtx.runId)`）——agent run 的对话、历史、事件流天然落在 dsh session 面上，run 与对话之间不需要映射层。

## 1. 板块一：agent 对话

### 已有

- 完整 session wire 面：`session.list` / `search` / `create` / `history` / `models` / `selectModel` / `rename` / `fork` / `prompt` / `attachment` / `updateQueue` / `cancel`（`packages/host/apiproxy/src/fetch/handler.ts:91-102`）；双 WebSocket 下行 `events.mux` / `events.host` + `host.describe` 握手（`packages/client/connection/README.md`）。
- 冷历史读取：`session.history`「inspects a cold log through persistence without resuming or publishing an Agent」（`packages/host/apiproxy/README.md:27`），附 projections 快照（标题等）。注意 `packages/client/connection/README.md:25` 的 Known Limitation「History resumes an unattached session」与此表述冲突，似已过时——以 apiproxy 的契约文档为准，后续可立案核对。
- 排队与取消：`session.updateQueue`（编辑/移除排队消息）、`session.cancel`（中止当前 turn、保留 pending inbox）、`session/queue` 重连基线帧（`packages/host/apiproxy/README.md:41`）。
- SDK JSON-RPC 面（路线 C 候选）：`initialize` / `session/prompt` / `shutdown` 三个请求 + `session.event` / `session.status` / `subagent.started` / `subagent.finished` 四种通知（`packages/sdk/protocol/src/types.ts:92-105`）。

### 可间接拼出

- run ↔ 对话关联：sessionId ≡ runId，产品壳从 run 直接 `session.history` / 订阅 mux 即得对话，零新面。
- 「业务语言呈现」是纯前端投影：session 事件流 + `session/projection` 通用投影通道（`packages/host/apiproxy/README.md:29`）已够承载翻译层。

### 完全缺失

- **路线 C 下对话面大半缺失**：SDK 协议无 history 读、无 cancel、无 session 列表、无 respond 通道（`packages/sdk/protocol/src/types.ts:101-105`；其 README Known Limitations 自述「No cancel or session-close methods」）。选路线 C 则本板块需整体补面；选路线 A/B 则本板块无缺口。
- **run 中途交互（多轮对话）无入口**：`bindAgent` 编译体是「首条 user message = input → quiescence → submit 终止」的单段形态（`packages/daypaw/sdk/src/agent.ts:299-309`），dsh 的 `agent.steer` 存在但未暴露给 run 的调用方。产品壳若只要「发任务、看过程、收结果」则不缺；若要「对话中追问进行中的 run」则是 SDK/引擎面缺口。

## 2. 板块二：任务/run 进度

### 已有

- ledger schema 已含进度视图所需的全部列：`runs` 表的 `status`（含预留的 `'waiting'`）、`waiting_gate`、`parent_run_id` / `parent_step_key`（父子血缘）、`attempt` / `retried_from_run_id`、`created_at` / `finished_at` / `output_json` / `error_json`，以及 `idx_runs_status` 索引（`packages/daypaw/store/src/migrations.ts:26-46,65`）。
- 单 run 状态读：`RunHandle.status()`（`packages/daypaw/sdk/src/run-handle.ts:44`）与引擎 `statusOf`（`packages/daypaw/engine/src/core.ts:529-533`），从 ledger 实时读。
- store 共享契约：行类型 + `openLedgerDatabase` 明确「future manager/evo subprojects read the same rows through this contract」（`packages/daypaw/store/src/index.ts:1-7`）——跨读者开同一库是设计内用法。

### 可间接拼出

- **run 列表、按状态过滤、父子血缘、步骤进度全部可由「同一 SQLite 库的只读 SQL」拼出**：WAL 模式支持并发读（`packages/daypaw/store/src/index.ts:156`），ADR 0009 §1 明确①调试期「用临时工具（CLI/SQL 查询）应急」。host 侧 provider 只读开库即可，不改引擎；每 run 单写者约束（CONTEXT.md「认领」）只约束写，不约束只读查询。
- 进度 live 推送可由 host 侧轮询投影拼出：attach 路径的 `pollMs` 轮询（`packages/daypaw/engine/src/core.ts:572-614`）是现成先例；或经 dsh `ctx.sessionProjections` 通用投影通道把轮询结果推给前端。

### 完全缺失

- **引擎服务面无 list**：`ctx.durable` 只有 `register` / `run` / `idle`（`packages/daypaw/engine/src/index.ts:91-111`）；`JournalStore` seam 只有 `selectRun` / `selectUnfinishedRunIds` / `selectJournalStep` 三个单键读（`packages/daypaw/engine/src/seams.ts:48-91`）。`selectUnfinishedRunIds` 只给 id 列表且面向 boot 扫描，不是列表查询面。
- **无 run 生命周期事件**：引擎 core 不持 Cordis context、不发射任何事件（`packages/daypaw/engine/src/core.ts`）——没有现成的 run 状态变更推送通道，轮询或新增事件二选一。
- **journal 步骤无按 run 枚举**：`selectJournalStep(runId, stepKey)` 需已知 stepKey（`packages/daypaw/engine/src/sqlite-journal-store.ts:51`）；「某 run 的 step 时间线」只能 SQL 拼。

## 3. 板块三：审批待办

### 已有（dsh 交互式审批，session 级，完整闭环）

- 审批 seam：`ctx.approval.request` + `approval/request` waterfall + `approval/asked` / `approval/decided` 审计对 + per-session policy（`packages/interaction/user-approval/src/index.ts`）。
- wire 闭环：apiproxy 把每个 ask 桥成 `approval/requested` mux 帧（稳定 rpcId，**mux-open 重放仍在 pending 的帧**——刷新恢复基线），客户端经 POST `/api/respond` 回答，回答后广播 `approval/resolved`（`packages/host/apiproxy/src/api-proxy.ts:1407-1490`；测试契约 `packages/host/apiproxy/tests/api-proxy-approval.spec.ts`）。ask-user 结构化提问同构（`question/requested` 帧 + 同一张 pending 表，`api-proxy.ts:704-733`）。
- **全 host 聚合已存在**：apiproxy 的 pendingApprovals 表是「the approval channel for every agent this host owns」（`api-proxy.ts:1408`）——跨 session 的待办集合在 host 内存里已经聚好了。

### 可间接拼出

- 前端待办列表：订阅 `events.mux` 收集 `approval/requested` 帧（含断线重放）、随 `approval/resolved` 移除，即得实时 pending 集——产品壳按路线 A/B 不需要新面。

### 完全缺失

- **daypaw HITL gate 原语未实现**：`ctx.waitFor`（durable promise）尚未落地——`statusOf` 对 `'waiting'` 状态直接 throw「waiting status lands with ctx.waitFor (spec 01 §6)」（`packages/daypaw/engine/src/core.ts:543`）；seam 头注注明 promise/timer seam 随原语后落（`packages/daypaw/engine/src/seams.ts:1-6`）。`runs.waiting_gate` 列已预留（`migrations.ts:33`）但无写入者。→ 「等待人审批的 run」这一业务语义在引擎里尚不存在，更谈不上枚举。
- **pending 审批无 unary 查询端点**：只有 mux 推送，没有 `approval.list` 式方法；冷启动客户端必须靠 mux-open 重放。路线 A/B 下够用（重放即基线），但任何不订阅 mux 的调用方（如 CLI 辅助工具）无法查询。
- 附注：apiproxy README:78 的 Known Limitation「the table … handles questions only and has no approval entries」与代码（pendingApprovals 注册表 + 审批 spec）矛盾，文档似已过时，可与 §1 的 history 条目一起立案核对。

## 4. 板块四：agent 目录与设置

### 已有

- 设置面全套：`settings.describe` / `openDocument` / `update` / `replace` / `mutate`（含 revision 冲突控制、secrets 编辑槽）+ `credentials.describe` / `set` / `unset`（`packages/host/apiproxy/src/fetch/handler.ts:132-139`；语义 `packages/host/apiproxy/README.md:61`）；`settings/document-updated`、`credentials/updated` 转发事件（`packages/api/remotes/src/remote-events.ts:20,29`）。
- 模型目录：`session.models`（当前选择 + provider 分组目录 + routable）/`session.selectModel`（`packages/host/apiproxy/README.md:37`）。
- dsh preset 目录：`agentPreset.list` / `select` / `read` / `copy` / `openDocument` / `remove` + `agent-preset/selected` 事件（`handler.ts:120-125`；语义 `apiproxy README:55-57`）。**注意：preset = cordis.yml 组合模板，不是 daypaw 的 `defineAgent` 定义**——对自用 fork 它是 agent 组合的作者面，对客户产品壳它暴露的是错误的抽象层。

### 可间接拼出

- 「跑过的定义」目录：`runs` 表 `SELECT DISTINCT def_kind, def_name, def_version`（SQL 拼出，机制同板块二）——能回答「这台机器上跑过哪些 agent」，含版本维。

### 完全缺失

- **daypaw agent 定义目录枚举**：定义注册表是引擎 core 的私有 Map（`packages/daypaw/engine/src/core.ts:194`），无枚举 API；定义不持久化到任何目录表（run 行只记 name/version 字符串）。「当前可用、可发起 run 的 agent 列表」——产品壳目录页的 core 查询——无任何面。
- **定义展示元数据**：`DefineAgentOptions` 只有 `name` / `version` / `input` / `output` / `prompt` / `tools` / `model` / `maxTurns`（`packages/daypaw/sdk/src/agent.ts:49-72`），无业务名称/描述/图标等展示字段。目录页需要的展示层元数据在 SDK 定义面缺失。

## 5. 缺口清单（裁决输入）

按「host 侧补 provider vs daypaw 引擎加查询面」裁决组织。判断依据：只读聚合（数据已在 SQLite/内存）host 侧可补且不改引擎；数据本身不存在（原语未实现、元数据未采集）只能动引擎/SDK。

| # | 缺口 | 板块 | host 侧补 provider | 引擎/SDK 加面 |
|---|---|---|---|---|
| 1 | run 列表 + 状态过滤 + 血缘 | ② | **可**：只读开同一 ledger 库 SQL 查询（设计内用法，`@daypaw/store` 头注） | 可：`JournalStore` 加 list 方法 + `ctx.durable` 暴露 |
| 2 | run 进度 live 推送 | ② | **可**：host 轮询 + sessionProjection/mux 投影（pollMs 先例） | 可：引擎发 run 生命周期事件（core 目前无 Cordis 依赖，引入即形态变化） |
| 3 | journal step 时间线枚举 | ② | **可**：同上 SQL | 可：`JournalStore` 加按 run 枚举 |
| 4 | `ctx.waitFor` gate 原语 + pending gate 枚举 | ③ | 不可：原语不存在 | **必须**：spec 01 §6 既定工作，引擎落地 |
| 5 | pending 审批 unary 查询 | ③ | **可（小）**：apiproxy 已有全 host 聚合表，加一个 list 端点即可；路线 A/B 下 mux 重放已够，可不做 | 不适用 |
| 6 | agent 定义目录枚举 | ④ | 不可：注册表是引擎私有 Map，host 够不到 | **必须**：引擎暴露注册表只读视图（或 SDK 侧登记目录） |
| 7 | 定义展示元数据（业务名/描述） | ④ | 不可：定义面没有字段可挂 | **必须**：`defineAgent` 加展示字段（SDK 面变更） |
| 8 | 路线 C 对话面（history/cancel/list/respond） | ① | 不适用——属 SDK 协议扩面，仅路线 C 需要 | 条件触发：选路线 C 才立案 |
| 9 | run 中途多轮交互 | ① | 不可：`agent.steer` 在编译体内部，调用方够不到 | 条件触发：产品壳若要「追问进行中的 run」才立案（SDK 加 steer 通道） |

### 附注

- 缺口 1–3 选 host 侧 SQL 路线时，读面与引擎写面共享 `SCHEMA_VERSION` 演进（`@daypaw/store` 单调迁移，新版库拒绝旧构建）——读面提供方须随 `@daypaw/store` 同版本发布，这正是「同一契约读同一库」头注的承诺范围。
- 缺口 4 是四板块里唯一「数据尚不存在」的硬缺口，也是审批待办板块能否超越「工具调用确认」、升级为「业务审批待办」的前提；它属于 spec 01 §6 的既定引擎工作，不是产品壳 v1 必须阻塞项（v1 可只用 dsh 交互式审批面）。
- 两处文档疑似过时（connection README 的 history 限制、apiproxy README 的 pending 表范围），建议立案核对，与本票结论无关。
