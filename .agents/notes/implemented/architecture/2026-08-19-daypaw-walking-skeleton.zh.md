# Agent Note: daypaw 走骨——三包与 SIGKILL 证明线

Status: implemented

[English](2026-08-19-daypaw-walking-skeleton.md) | 中文

## 问题

ADR 0008 把走骨定义为最薄的端到端耐久竖切——`@daypaw/store` + `@daypaw/engine` + `@daypaw/sdk`，仅 `defineWorkflow` + `run()`——并给出一条证明线：canonical example 在运行中被真 `SIGKILL` 杀死，重启后续跑并以类型化结果完成。spec 第 1 章钉死了语义（ledger schema、step 去重、认领、boot 扫描），但三个实现决策开放：Cordis 边界落在哪、「attach」被允许做什么、boot 扫描何时跑。

## 决策

- **`@daypaw/engine` 内部 core/service 切分** —— `DurableEngineCore` 经 `JournalStore` 缝拥有全部状态迁移，不持 Cordis、不持数据库句柄；`ctx.durable` 的 `Service` 是开库/迁库后委托的薄适配层。故障注入套件经 Proxy 包装的 store（逐方法故障）驱动 core——这是该缝的第二个真实消费者，并让错误路径测试摆脱进程戏剧。dispose 充当进程内崩溃桥，SIGKILL 套件则经 `node --import tsx/esm` 拉起真实示例宿主。
- **attach 永不夺权；复活归 boot 扫描** —— 对未完且他方认领的 run，`run()` 按 `pollMs` 轮询而非认领。认领保留给 boot 扫描，因为无心跳时活体与死者的他方认领不可区分（ADR 0002 §2）；从活体驱动者手里夺权会造成双驱动。boot 扫描在构造时*且每次 `register()` 后*运行——服务构造期注册表必空，登记是复活最早的可行时刻；定义未登记的 run 保持未完并告警。
- **终态竞态与销毁规则** —— body 在 run 已被他处结算后完成（取消在 step 边界生效）时，经 `finalizeRun` 条件更新的返回值以终态行的结局 reject；body 在引擎销毁后完成时 reject `ENGINE_DISPOSED` 且不碰 ledger，run 保持可复活。结果 promise 挂 handled 标记，使 boot 复活失败的 run 永不击垮进程。

支撑动作：`retry_policy_json` 不进迁移 0001（issue #24）；迁移为 TS 模板字符串里的手写 SQL，使编译后的 `lib/` 自包含；服务上的 `register`/`run` 为异步——ledger 异步开库（方法内部 await 就绪，storage-sqlite 模式）；invariant 伴随包是显式「No runtime invariant:」标记——core 不持可挂的 Cordis 事件流，run/journal/promise 状态机断言归故障注入套件。

## 曾考虑的替代方案

- **run-attach 认领可复活 run** —— 否决：与从活体驱动者夺权不可区分；轮询是 attach 能承诺的唯一语义。
- **构造时仅一次 boot 扫描** —— 否决：彼时注册表为空，一切复活都依赖第二个 API 之外的触发器。登记触发的扫描让「boot 扫描复活」恰在成为可能时为真。
- **dispose 视为失败** —— 否决：销毁时写终态会使未完 run 不可复活，把进程生命周期与 run 结局耦合。
- **迁移用 `.sql` 文件** —— 否决于构建自包含：tsc 不复制资产，编译后消费方会读到缺失文件；编号 TS 模板字符串保留 spec 第 1 章 §4 点名的评审性质。

## 结果

- 证明线通过：第一步效果出现后杀死、重启，第一步恰执行一次，在飞的步骤重执行（执行 at-least-once，step 提交 exactly-once）。
- 两活进程驱动同一 ledger 仍在 v1 包络之外（引擎 README 记载）；attach 轮询路径覆盖运维场景。
- 本 note 推迟的 promise 行、`waiting` 状态与 gate 决议已随 `ctx.waitFor` 落地（issue #47，[gate note](../feature/2026-08-23-durable-gate-waitfor.md)）；timers 表、`ctx.sleep` 与关系 invariant 仍是按需驱动的后续工作。
