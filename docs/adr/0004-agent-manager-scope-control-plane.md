# ADR 0004: Agent Manager 范围与控制面

- **状态**：已接受（2026-08-30，[Manager 范围与控制面](https://github.com/0xnicholas/daypaw-pro/issues/8)）
- **参照**：Palantir Agent Manager（DevCon 6，`docs/research/palantir-agent-stack.md`）+ 观测/管理技术地形（`research/agent-observability-landscape.md`，分支 `research/agent-observability-landscape`）+ dsh seam 清点（`research/dsh-seam-inventory.md`，分支）
- **前置**：ADR 0002（嵌入式引擎、engine ledger、零算力等待、无 daemon）、ADR 0003（RunHandle、v1 纯库、wire 扩展留口给本票）
- **编号注记**：票面写「ADR 0003」，但 0003 已被 SDK 票消费；本决策为 ADR 0004。

## 决策

### 1. 角色：控制者 + 刻意小的控制集

Manager v1 是引擎的**控制者**，但控制面只做三件事：**resolve gate（带 payload，即 HITL 签核）、cancel run（带 cause）、重跑**。控制走 ledger command（pull 模型），引擎不必新增 wire；零算力等待期的 resolve 天然只是一次库写入，无需 run 的进程活着。

否决：纯观察者（cancel 在自用场景是刚需，长期绕道 CLI 会烦）；完整控制面（pause/resume/fork/注入消息/权限模型一次做全，对单人自用过重，pause/resume 还需引擎步间热路径机制）。

### 2. 控制操作集与重跑语义

- **resolve gate**：payload 带 zod schema，Manager UI 渲染表单（兑现 ADR 0002 决策 5 的承诺）。
- **cancel run**：带 cause；在途 effect 照常落账（at-least-once 语义完好）。
- **重跑 = 新 runId + 同定义同输入 + ledger 记 attempt 链**。否决同 runId 复活（Temporal reset 谱系）：需要「终态可撤销」+ 历史点重放，破坏 start-or-attach 幂等性；且新 runId 版本与 EVO 并行变体同构，一套机制两处受益。
- **明确不做**：pause/resume、fork、消息注入（等待中 run 的结构化注入由 resolve-with-payload 覆盖；自由对话注入是 dsh 会话 UI 本职）、权限模型（自用 + loopback 默认姿态）。

### 3. 控制面 seam：store 命令 + 边界观察

跨进程控制统一为**写入 store 的命令行**（同 storage seam，独立 commands 表：Manager 写、引擎读）。引擎在三个便宜点观察：**每个 step 边界、timer/promise 唤醒时、boot 扫描**。本进程内 RunHandle.cancel 的同步路径照旧——同一命令语义，不同运输。

诚实代价：cancel 对进行中 step 的生效延迟 = 当前 step 时长（LLM 调用可能分钟级）；v1 不做步内热路径轮询/中断。否决双路径（活进程直连 + 死 run 走命令）：两条控制路径引擎都要支持，且提前与 wire 扩展纠缠。

### 4. 形态：扩展 dsh web app + 按需 Manager Host

- **host 侧**：新 `packages/daypaw/` 包在 `ctx.webServer` 上注册 Manager 路由，**直读 SQLite**（ledger + 关联层）——跨进程持久数据不是单进程会话，不走 connection RPC。
- **client 侧**：新 `ui-*` 插件经插槽系统组合进现有 shell（主题/连接/原语全复用，纯增量；`ui-workflow-run`/`ui-jobs`/`ui-trajectory` 是先例）。
- **Manager Host**：`daypaw manage` 按需拉起最小 Cordis 组合进程——开同一 SQLite、伺服 UI、写命令；无常驻，与 ADR 0002 无 daemon 姿态一致。agent 进程活着时，同一 UI 由该进程伺服（同一组合的两个实例）。
- 双进程同库（agent 进程 + Manager Host 并存）由 SQLite WAL + 分表写入覆盖，spec 细化。

否决：独立轻量 app（shell/连接/主题/原语全部重造，第二个 UI 要养）；纯 CLI + OTel 后端（放弃 gate 表单渲染与叙事化 trace，背离 Palantir「actionable」产品标准）。

### 5. 数据与保留

- **本地 SQLite 永久保留**：自用、磁盘便宜、回放数据是唯一事实源，单文件好备份好归档。
- **OTel 导出 = 可选投影**：daypaw profile 默认关；需要横向遥测时组合进 Phoenix（研究票 #4 已评「零成本起步后端」）或任何 OTLP 后端；导出丢失不损本地真相。
- **fleet 视角 = Run Registry**：全部 run × 状态 × 定义版本 + 按定义聚合（成功率/成本趋势，EVO 的观察窗）。自用单机无多机 fleet——fleet 是跨进程跨时间。

### 6. EVO 数据契约：共享库 schema，互不穿透

本地库是共享事实源，各写各表：**引擎拥有 ledger**（run/step/effect/定义版本）；**Manager 拥有关联层的人写面**（feedback，UI 写入）并渲染 eval 视图；**EVO 拥有自身输出表**（candidate/experiment/promotion）并直读 ledger + 关联层 + session log。两者互不经过对方代码路径——Manager 是人的窗口，不是 EVO 的管道。否决 Manager 作数据服务（依赖方向反了：优化系统不该是观测面的客户端）与 EVO 拥有数据层（Manager 在 EVO 未建时就盲，两支柱耦合过紧）。

### 7. wire 裁决（承接 ADR 0003 留口）

v1 **不扩 dsh agent wire**。Manager 走 webserver 路由（读）+ store 命令（写），wire 现状（无 cancel/run 级结果/attach）不构成阻塞；ADR 0003 指出的「等价性谎言」问题在 Manager 路径上不存在，因为根本不经 wire。

## 后果

- spec 第 3 章骨架输入：`docs/spec/03-agent-manager.md`。
- span 粒度映射表、semconv pin 版本、UI 最小视角集、Manager Host 组合清单、命令表 schema 与生命周期 = spec 撰写期设计题，非 ADR 级。
- cancel 延迟（步边界生效）记入 spec 运维注记；日后需要秒级 cancel 再评估步内观察。
- feedback UI 接线（上游 `ui-message-feedback` → 关联层）为纯增量 client 插件，spec 覆盖。
