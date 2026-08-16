# 第 3 章：Agent Manager（骨架输入）

> 状态：**骨架输入**——结构已定，内容待 spec 撰写期填充。决策依据 [ADR 0004](../adr/0004-agent-manager-scope-control-plane.md)；数据模型三层的依据见观测地形研究（`research/agent-observability-landscape.md`，分支）；引擎语义见 ADR 0002 与 spec 第 1 章。

## 1. 观测面

三层钻取 + 一个聚合：Run Registry（fleet 视角，ADR 0004 §5）→ run timeline（step/effect/gate 事件流）→ session 回放（指回现有会话 UI，经 `(session.id, seq)` 引用）；按定义聚合视图（成功率/成本趋势，EVO 观察窗）。数据源 = 直读 SQLite（ledger + 关联层）；本地永久保留；OTel 投影可选（默认关）。待写：UI 最小视角集、叙事化 trace（Palantir Agent Timeline 对标）的 v1 边界。

## 2. 控制面

操作集：resolve gate（zod→表单）/ cancel（cause）/ 重跑（新 runId + attempt 链，ADR 0004 §2）。seam：store 命令 + 边界观察——step 边界、timer/promise 唤醒、boot 扫描三观察点（ADR 0004 §3）。待写：命令表 schema、命令生命周期（去重/幂等/失效）、与进程内 RunHandle.cancel 的统一语义、cancel 步边界延迟的运维注记。

## 3. 形态与进程

dsh web app 扩展：host 侧 Manager 路由包（`ctx.webServer` 注册，直读 SQLite，不走 connection RPC）+ client 侧 `ui-*` 插槽插件（ADR 0004 §4）。Manager Host 按需进程（`daypaw manage`）：最小 Cordis 组合清单待列。双进程同库并发：SQLite WAL + 分表写入策略待写。

## 4. EVO 数据契约

共享库 schema 契约（ADR 0004 §6）：逐表列 owner / writer / reader。feedback UI 接线（上游 `ui-message-feedback` → 关联层，纯增量 client 插件）。candidate/experiment/promotion 表形态：随 EVO 章（第 4 章）定。

## 5. OTel 投影层

span 粒度映射表（turn→`invoke_agent` internal、step→inference、tool→`execute_tool`、run→`invoke_workflow`）、semconv pin 版本、新开投影 seam（不动 `sessionTelemetry` 每 context 单 backend 约束）——素材见观测地形研究 §开放问题。

## 6. 测试面

待测试策略票定调后回填。
