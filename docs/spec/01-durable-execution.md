# 第 1 章：Durable Execution（Durable Engine）

> 状态：**完整章**（支柱①里程碑撰写，批次 B）。
> 决策依据：[ADR 0002](../adr/0002-durable-execution-semantics.md)（语义与基座）、[ADR 0003](../adr/0003-engine-sdk-programming-model.md)（编程模型边界）、[ADR 0006](../adr/0006-engine-package-structure.md)（包结构）、[ADR 0007](../adr/0007-test-strategy.md)（测试策略）、[ADR 0008](../adr/0008-landing-order-walking-skeleton.md)（落地顺序与 walking skeleton）。
> 事实底座：`docs/research/durable-execution-landscape.md`（六家引擎第一性语义）、`docs/research/dsh-seam-inventory-v2.md`（dsh seam 清点 v2，接替 v1）。

## 1. 定位：双事实源与边界

支柱①补的是 dsh 留白的那一层：dsh 已把**会话内 durability** 做满（append-only session log、checkpoint 屏障、崩溃修复合成收尾），但**跨 turn / 跨进程的编排 durability** 为零——执行级无 run journal（jobs 内存注册表、workflow 无持久执行状态、schedule 只在 session 活着时等），显示级已有（`tool-workflow/*` 四事件 durable 可回放，见清点 v2）。进程死了，对话史与做事的叙事都活着，唯独「正在做的事」不会自己复活——Durable Engine（参照系：Palantir Orchestrator）复活「正在做的事」。

**双事实源，各管一事**（ADR 0002 §3）：

- **Session log**（不动）：模型可见的一切；不变量 model-visible means logged 完好；不碰 `SESSION_FORMAT_VERSION`。
- **Engine ledger**（新，追加式）：编排事实的唯一权威——run 生命周期、step/effect（幂等键+结果）、promise（gate）、timer、retry 计数、定义版本。Manager 观测与 EVO 评估集（均现为远期子项目，ADR 0009）以它为数据源（OTel 导出是它的一次投影——投影随子项目落地，引擎 v1 不为此预留代码）。
- **双向引用**：ledger 行可携 `(session_id, session_seq)` 指回 session log；session 事件可带可选 `runId` 字段（`SessionEventMap` merge-extensible，新增事件不碰 core）。run 可跨 session/subagent 而不散射。

**与上游三族旁立**（ADR 0002 §6）：jobs / workflow / schedule 不改不碰；自有 daypaw profile 默认不装其模型侧工具。可选适配留后续票裁决优先级：jobs → 后台 effect 执行器 provider；schedule → timer provider；workflow → 不适配，被引擎取代。短期代价：代码库两套编排概念并存，接受。

## 2. 语义内核：八条第一性语义的 v1 取舍

六家引擎（Temporal / Restate / DBOS / Resonate / Golem / LittleHorse）收敛出的不可约语义（landscape §3.1），daypaw v1 取舍：

| # | 第一性语义 | v1 取舍 |
|---|---|---|
| ① | 追加式 journal：effect + result 一起记 | **做**——engine ledger 本体（§3） |
| ② | 重放/去重 | **做**——DBOS 谱系 step 去重续跑（§5）；无强确定性约束，改版本/改 prompt 不炸旧 run；全史对话重放由 session log 免费提供，引擎不重复 |
| ③ | 持久 timer | **做**（§6）；按需落地（§11） |
| ④ | 持久 promise / HITL gate | **做**（§6）——单一原语 `ctx.waitFor`；按需落地（§11） |
| ⑤ | 数据化 retry policy | **字段化预留**（journal 行 `attempt` 列，崩溃不丢计数；`retry_policy_json` 待 retry 面落地时以迁移加入，golden 保障）；v1 无自动重试策略面，step 失败即 run failed |
| ⑥ | 副作用幂等键 | **做**——step 键自动派生 `runId + name + occurrence`，`opts.key` 显式逃生口（原型裁决，见第 2 章 §2） |
| ⑦ | 每 run 单写者 | **做**（§5 驱动者模型 + claim 认领） |
| ⑧ | 版本化执行定义 | **做**——run 行记 `(def_name, def_version)`（EVO incumbent/candidate 同名不同版本并行跑的前提，Golem Agent Type 谱系） |

**分布式构件 v1 不做**（landscape §3.2）：task queue + worker 舰队、副本复制 / HA、跨机 durable RPC、多租户 namespace、WASM 沙箱。**但不焊死门**：journal 读写、promise 解析、timer 调度三个可替换接口（§7），Resonate local→production 谱系证明同一代码可后接服务器形态。

**补偿/saga 不做原语**（六家亦非原语）：幂等键 + 重试 + 人工干预（Manager）覆盖。

## 3. Engine ledger 数据模型（@daypaw/store）

store = 共享数据契约的代码形态：schema 常量 + TS 行类型 + 迁移骨架，**不含业务逻辑**（ADR 0006 §3）。物理形态：**独立 SQLite 库文件**（harness home 下 `daypaw/ledger.db`，确切解析函数实现期定），`node:sqlite`（`DatabaseSync`）直驱，**WAL 模式 + `busy_timeout` + `foreign_keys ON`**。

> **落实注记**：ADR 0002 §3 的「落 storage seam」本章细化为此——自立库文件 + node:sqlite + WAL，而**不**借 `ctx.storageDomain`：后者已知限制（单进程可见性、无跨表事务/二级索引）正撞 ledger 的两个硬需求——Manager host 跨进程直读、多表一致性写。继承的是 dsh 存储栈传统（node:sqlite / WAL / 版本戳），非 DomainFacility 设施。

### 3.1 `runs`（skeleton 表）

| 列 | 类型 | 语义 |
|---|---|---|
| `run_id` | TEXT PK | 持久身份；`def.run(input, { runId? })` 幂等 start-or-attach 的键 |
| `def_kind` | TEXT | `'workflow' \| 'agent'` |
| `def_name` / `def_version` | TEXT | 定义身份（⑧）；冷复活按它从注册表取 body |
| `input_json` | TEXT | zod 校验后的输入 |
| `status` | TEXT | `'running' \| 'waiting' \| 'done' \| 'failed' \| 'cancelled'`——RunStatus 判别联合的持久形 |
| `waiting_gate` | TEXT NULL | `waiting` 时的 gate 名 |
| `parent_run_id` / `parent_step_key` | TEXT NULL | 父子链（spawn / 子 run；确定性子 runId 派生见第 2 章 §2） |
| `attempt` / `retried_from_run_id` | INTEGER / TEXT NULL | Manager 重跑 = 新 runId + attempt 链（ADR 0004） |
| `output_json` / `error_json` | TEXT NULL | 类型化结果（output schema 校验后）/ 失败归因 |
| `cancel_cause` | TEXT NULL | |
| `claimed_by` / `claimed_at` | TEXT / INTEGER NULL | 单写者认领（§5）：进程实例 id + 认领时刻 |
| `created_at` / `updated_at` / `finished_at` | INTEGER | epoch ms |

### 3.2 `journal`（skeleton 表）——step/effect 记录合一（①：effect+result 一起记）

| 列 | 类型 | 语义 |
|---|---|---|
| `run_id` | TEXT | FK → runs |
| `step_key` | TEXT | 幂等键（自动派生 / `opts.key`）；**PK = (run_id, step_key)，唯一约束即去重闸** |
| `name` / `occurrence` | TEXT / INTEGER | step 名 / 重驱动遍历序 |
| `kind` | TEXT | `'step'`（后续扩 `'timer'` / `'sleep'` 族占位） |
| `status` | TEXT | `'started' \| 'completed' \| 'failed'` |
| `value_json` / `error_json` | TEXT NULL | 结果（ledger 写账时运行时校验）/ 失败 |
| `attempt` | INTEGER | ⑤预留：重试计数崩溃不丢；`retry_policy_json` 待 retry 面落地时以迁移加入 |
| `session_id` / `session_seq` | TEXT / INTEGER NULL | 双向引用（§1） |
| `started_at` / `finished_at` | INTEGER NULL | |

### 3.3 `promises`（§6，skeleton 后）

PK `(run_id, gate)`；列：`state`（`pending | resolved | rejected | timedout | cancelled`，对齐 Resonate durable promise spec 状态机）、`payload_json`（resolve 值，引擎侧 zod 校验后落盘）、`schema_json`（zod → JSON Schema 的**渲染投影**，供 Manager/UI 渲染表单；权威校验在引擎侧，渲染投影不作校验依据）、`timeout_at`、`resolution_source`（`'sdk' | 'manager' | 'webhook'`）、`created_at` / `resolved_at`。

### 3.4 `timers`（§6，skeleton 后）

PK `(run_id, step_key)`（sleep 属 step 族，占幂等键位）；列：`wake_at`、`fired`（0/1）、`created_at`。boot 扫描 overdue 查询 = `WHERE fired = 0 AND wake_at <= ?`。

### 3.5 并发模型

DB 级：**WAL 一写多读**——引擎进程单写者，Manager host / 其它读者直读不阻塞。run 级写权：**claim 条件更新认领**（§5）。Manager 侧写操作（resolve/feedback/命令）走其自身进程的连接，SQLite 队列化单写。

## 4. 迁移机制：手写 SQL + 单调版本 + golden fixture

裁决（批次 B 撰写期设计题，ADR 0006 后果登记项）：**手写 SQL 迁移**，否决 drizzle 类 ORM（依赖链 + 生成工具链与全仓库「node:sqlite 直驱、零 ORM」惯法相异；2–6 张表量级下手写样板可忽略；store 定位是中立契约而非模型层）。

- `packages/daypaw/store/src/migrations/NNNN_name.sql`——编号单调递增，迁移即代码评审对象，diff 可读。
- 版本戳沿用 dsh 惯法：`PRAGMA user_version`。`migrate.ts` 读当前版本、逐段在事务内应用后续段、逐段推进戳。**旧版逐段迁移；比当前新的库拒绝打开**（dsh 拒旧姿态的 daypaw 版：向前兼容靠迁移，向后不承诺）。
- golden fixture（ADR 0007）：`tests/fixtures/golden/` 每段一个库文件；测试 = 从 N-1 段 golden 应用第 N 段后，`sqlite_master` dump 与关键行比对。

## 5. 执行与恢复：step 去重续跑 + boot 扫描

**驱动模型**：workflow body = 用户 async 函数，引擎驱动 = 以 `ctx` 调用 body。进程即 worker，ledger 未完 run 即队列（ADR 0003 §5）。

**`ctx.step(name, fn)`**：派生幂等键 → 查 journal `(run_id, step_key)`：`completed` → 反序列化 `value_json` 直接返回（**不重执行**）；无行 → 写 `started` → 执行 fn → 成功写 `completed`+结果，失败写 `failed`（v1：run 随之 failed，⑤重试面后续）。`started` 后崩溃的 step 在恢复时视为未完成，重执行——**at-least-once 是执行侧的底**；副作用恰一次靠幂等键约定（工具级）与 step 去重（编排级）凑。

**boot 扫描**（无常驻 daemon 的唤醒语义，ADR 0002 §2）：进程任何方式被拉起时——

1. 扫描 `runs WHERE status IN ('running', 'waiting')`；
2. 对每个 run **条件更新认领**：`UPDATE runs SET claimed_by = :instanceId, claimed_at = :now WHERE run_id = :id AND status IN (...) AND (claimed_by IS NULL OR claimed_by <> :instanceId)`——影响行数 = 1 才获得驱动权（跨进程原子夺权，WAL 下单写者保证）；
3. 认领成功 → 按 `(def_name, def_version)` 从注册表取 body，**重新驱动**控制流——已 completed step 经去重直接返回，续跑到断点处继续。**复活不需要原调用者在场**。
4. 补发 overdue timer（§6）。

**单写者**（⑦）：进程内 = `runId → driver` 注册表，同 runId 双驱动直接拒绝；跨进程 = 上述 claim 条件更新。崩溃的旧驱动者其 claim 随进程死亡自然失效（新进程拉起时夺权）——v1 无租约/心跳，进程边界即写权边界。

**幂等 start-or-attach**（ADR 0003 §4 的本章侧面）：`def.run(input, { runId? })`——runId 无行则 INSERT 并驱动；已有行则 attach：本进程在驱动 → 挂其完成通知；done/failed/cancelled → 直接读行返回；**他进程在驱动（v1 非常态）→ 低频轮询行变化兜底**（`pollMs` 可配，默认 1s——v1 进程内嵌形态下跨进程 attach 仅运维场景）。

**cancel**：写 `status='cancelled'` + `cancel_cause` → driver 侧 AbortSignal 触发；已完成 step 记录保留。重跑语义（新 runId + attempt 链）归 Manager 章（远期子项目方向文档）。

## 6. Durable promise（gate）与持久 timer

**`ctx.waitFor(gate, { schema, timeout })`**（ADR 0002 §5；类型面见第 2 章 §2）：

- 建 promises 行（pending + `timeout_at`）→ run 状态 `waiting` + `waiting_gate` → 驱动让出。**进程退出等待 = 零算力**：协程挂起不占资源，进程整个死掉也由 boot 扫描复活。
- **resolve 统一走同一 seam**：SDK 直调 / Manager UI /（留口）webhook。本进程在等 → 直接 resume；跨进程写入（Manager host 直写库）→ driver 侧低频轮询兜底（同 §5 `pollMs`）；进程已死 → boot 扫描见 resolved gate 续跑。
- **幂等 resolve**：同 `(run_id, gate)` 第一写入者胜（first-wins，对齐 dsh jobs settlement 与 Resonate `strict`）。
- **终态非异常**：返回 `GateResolution` 联合值 `{state:'resolved',value} | {state:'rejected',reason} | {state:'timedout'} | {state:'cancelled'}`；超时/拒绝是可编程分支，不抛异常。

**`ctx.sleep(duration)`**：timers 行 `wake_at = now + duration`，占 step 族幂等键位（重驱动去重：已完成直接返回）。进程活着 = `setTimeout` 自唤醒；进程死 = boot 扫描补发 overdue（`fired=0 AND wake_at <= now`）。语义 = **至少醒一次、迟到不丢**——准时性受拉起时机约束（§10 运维注记）。

## 7. 可替换三缝（daemon 化 / 服务化留口）

engine 内部接口，v1 进程内实现，日后换 provider 即 daemon 化（ADR 0002 §2、ADR 0003 §5）：

| 缝 | v1 实现 |  daemon 化路径 |
|---|---|---|
| **JournalStore**（runs/journal/promises/timers 读写） | @daypaw/store（node:sqlite + WAL） | 网络存储 provider |
| **PromiseResolver**（resolve 路由与通知） | 进程内直推 + 轮询兜底 | 消息/通知通道 |
| **TimerScheduler**（schedule / fire / overdue 扫描） | `setTimeout` + boot 补发 | 独立调度进程 / 外部 scheduler |

## 8. 与 dsh 既有概念的关系表

| dsh 概念 | 关系 |
|---|---|
| session log / `ctx.sessionPersistence` | **双事实源**，不动；ledger 行携 `(session_id, seq)` 引用；session 事件可选带 `runId` |
| `session-checkpoint-policy` | 屏障先例（副作用前先 durable、fail-closed）：engine 的 step 写账边界 = 编排层的同构屏障 |
| `ctx.storage` / `ctx.storageDomain` | 不借（§3 落实注记）；继承 node:sqlite/WAL/版本戳栈传统 |
| jobs 族（内存注册表） | 旁立不改；可选适配：→ 后台 effect 执行器 provider（后续票） |
| schedule 族（session 活着才等） | 旁立不改；可选适配：→ timer provider（后续票）；语义差异：engine timer 跨进程、不挂 session |
| workflow 族（worker thread、非持久） | 被引擎取代，不适配 |
| `TOOL_OUTCOME_UNKNOWN` 合成收尾 | session 层崩溃修复不变量；engine 层的对应物 = step 去重续跑（语义基线同源） |
| `spill-local` | 文件存储模式参照，无耦合 |

## 9. 测试面

[ADR 0007](../adr/0007-test-strategy.md) 定调下的本章清单：

- **崩溃/重放双层**（keyless）：主力 = 进程内故障注入——包装 journal 写入层，穷举「每个 append 点前后抛异常」，注入时钟跨「重启」推进 durable timer；断言每 effect 恰执行一次、重放不重不漏、step 去重、gate 状态机五态、boot 扫描、claim 夺权。补充 = 真 SIGKILL——tsx spawn 子进程跑 run、杀掉、重启验恢复（半写路径/文件锁）；如需进上游 `processBoundTests` 单列 lane 则逐条 core-touch 登记。
- **golden 库迁移 fixture**：§4 逐段比对。
- **契约断言清单**：step 恰一次、幂等键去重（自动派生 + `opts.key` 逃生口）、boot 复活不需原调用者、单写者拒绝双驱动、promise 幂等 resolve（first-wins）+ 超时终态、timer overdue 补发、attach 三态（在驱动/已完成/跨进程轮询）。
- **REAL-composition**：`ctx.durable` 插件族配测试专用 `cordis.yml` 走真 Loader；canonical example（walking skeleton 宿主，`examples/daypaw-*`）拥有 keyless 验收 + with-key smoke（无 key 自跳）。
- **invariant companion**：engine 包 `src/invariant.ts`（journal 追加性、runs/journal 引用完整性、run/promise 状态机合法迁移）。
- **覆盖率**：per-file 100% 门，`packages/*/*` glob 零配置纳入。

## 10. 运维注记

- **timer 准时性**：无常驻 daemon——进程死时 sleep 不唤醒，boot 补发 overdue。紧急 timer 需准 daemon：cron/launchd 定期拉起进程即得「准实时」（ADR 0002 §2）。
- **幂等键派生纪律**：自动派生依赖重驱动遍历顺序确定——`map` 顺序稳定、手写乱序 `await` 不稳；并行用 `Promise.all`（普通 TS，非原语），其内 step 命名需自律。给逃生口：`opts.key`。
- **Manager 直读纪律**：WAL 下只读不阻塞；Manager 侧写（resolve/feedback/命令）走其自身进程连接，不抢引擎写权（run 级写权只有 claim 一条路）。
- **崩溃窗口**：`started` 已写、`completed` 未写的 step 恢复时重执行——工具副作用幂等是工具级约定，引擎给的是编排级去重。

## 11. Walking skeleton 落地范围（ADR 0008 §1 对表）

| 本章节 | skeleton（批次 C） |
|---|---|
| §3.1 runs / §3.2 journal | ✅ 落地 |
| §4 迁移机制 | ✅ 迁移骨架 + 0001 段 + golden fixture |
| §5 驱动 / step 去重 / boot 扫描 / claim / start-or-attach | ✅ 落地 |
| §6 promise / timer | ❌（语义已定，按需落地：首个需要 gate/timer 的真实 workflow 出现时实现） |
| §7 三缝接口 | ✅ 以进程内实现落地（接口成型即留口） |
| §9 双层崩溃 + golden fixture + canonical example | ✅ 随包落地（证明线：3-step example 真 SIGKILL 续跑） |
| retry 面 / spawn / defineAgent / profile 接线 / bin 冒烟 | ❌ 全部在外 |
