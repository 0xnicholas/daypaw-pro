# @daypaw/engine

[English](README.md) | 中文

durable 执行引擎（`ctx.durable`）：run 生命周期、step 去重续跑、durable gate（`ctx.waitFor`）、单写者认领与 boot 扫描复活，落在 [`@daypaw/store`](../store/README.md) ledger 之上。作为 Cordis 插件加载；应用经类型化 [`@daypaw/sdk`](../sdk/README.md) facade 调用。语义：[spec 第 1 章](../../../docs/spec/01-durable-execution.md)；走骨范围：[ADR 0008](../../../docs/adr/0008-landing-order-walking-skeleton.md)。

## Service API

`ctx.durable`（插件 `@daypaw/engine`）：

- `register(def)` —— 登记不透明定义（kind/name/version + body thunk）供执行与 boot 复活。同身份不同 body 拒绝；登记会触发 boot 扫描，可能复活前一进程留下的未完 run。
- `run(def, input, { runId?, signal?, parent? })` —— 幂等 start-or-attach：未知 runId 插入并驱动；终态 run 从行结算；本进程在驱动的 run 返回活句柄；其余按 `pollMs` 轮询——attach 永不夺权，复活是 boot 扫描的职责。`parent`（`{ runId, stepKey }`）在插入时记录调用方血缘（`parent_run_id` / `parent_step_key`）；已有 runId 则 attach，不改写血缘。
- `idle()` —— 本进程不驱动任何 run 时 resolve。
- `listRuns(filter?)` —— ledger 中的 run 行，新者在前，可选按单一 `status` 过滤。
- `runLineage(runId)` —— 一次调用取回 run 自身行、父 run 与直接子 run（子按先来在前）；runId 未知时各字段皆空。
- `journalTimeline(runId)` —— 该 run 的 journal step，按开始顺序。
- `resolveGate(runId, gate, settlement, source)` —— gate 结算的唯一缝（first-wins）：SDK 直调 / Manager UI /（留口）webhook 同路。本进程持有 waiter 时先按值契约校验再落账，不合格即 throw 不记录；第二写入者 no-op 返回 `false`。本进程等待中的驱动立即续跑；别进程写入由 driver 侧 `pollMs` 轮询兜底，进程已死则由 boot 扫描续跑。

查询方法（`listRuns` / `runLineage` / `journalTimeline`）是 ledger 的唯一查询出口（spec 05 §5）：host 经 `ctx.durable` 读 run、血缘与 step 时间线，永不自带 SQL，查询知识随 schema 演进同步。呈现词汇不进此缝——行保持引擎原名。

配置（schemastery）：`path`（ledger 文件或 `:memory:`）、`pollMs`（attach 轮询间隔，默认 1s）。

## 执行模型

run 以 step ctx 驱动其 body。`ctx.step(name, fn, { key? })` 派生幂等键 `name#occurrence`（或显式 key）；已完成 step 直接返回已记录结果不再执行，未完成的（重）执行并记录——执行 at-least-once，step 提交 exactly-once。取消先写终态行，在下一 step 边界生效。销毁停止驱动且不写终态：未完 run 保持可复活。

`ctx.waitFor(gate, { schema?, timeout? })` 是 HITL 挂起原语（spec 第 1 章 §6）：登记 `(runId, gate)` 键的 pending promise 行、run 转 `waiting` 并让出驱动——等待零算力，进程死掉由 boot 扫描复活，重驱动在同一 `waitFor` 读到已落账的结局直接返回。终态以 `GateResolution` 联合值返回（`resolved` / `rejected` / `timedout` / `cancelled`），超时、拒绝、取消是可编程分支而非异常。`timeout` 为毫秒时长；进程内 `setTimeout` 到点 first-wins 写 `timedout`，进程错过则由 boot 扫描先扫 overdue 再续跑。

step ctx 另暴露 `runId` 与驱动者的 `signal`。step 的 `fn` await 期间，`currentStepScope()` 返回 ambient 作用域 `{ runId, stepKey }`；在其中启动的子 run 派生确定性 runId `<runId>/<stepKey>/<kind>:<name>#<occurrence>` 并记录父子血缘——重驱动的父 run attach 子 run 而非重开（SDK 的 `ctx.agent` 与裸子 workflow 惯用式都走这条机制）。

## 扩展点

- **`JournalStore` 缝**（`./seams`）—— 引擎存储的唯一可替换接口（含 promise 行读写）；SQLite 实现为 `SqliteJournalStore`。它也是崩溃测试套件的故障注入面。promise 结算路由收在 core 内（进程内直推 + 轮询兜底）；`PromiseResolver` / `TimerScheduler` 缝待第二个实现出现时抽取。
- **定义注册表** —— 内置（ADR 0006 §2）：boot 复活需要脱离原调用者的 body。

## Model Experience

### Stored domain records

#### What the model sees

无。引擎不贡献 prompt、工具或 schema；`ctx.durable` 编排发生在别处的模型调用。

#### Token effect

零 live-request token。

#### KV Cache effect

无——ledger 永不进入 live request 前缀。

## Known Limitations and Deferred Work

- **走骨原语集** —— `ctx.step` 与 `ctx.waitFor` 已落地；`sleep` / `spawn` 随其状态机按需落地（`agent` 面在 SDK 侧已有）。
- **跨进程结算无写侧 schema 校验** —— 落盘的 `schema_json` 只是渲染投影；无 live schema 的进程写入不经校验，等待方交付前必验，不合格以 step 级失败收场。
- **无跨进程存活检测** —— boot 扫描可夺走另一*活体*进程的认领（死认领重指派按设计无需心跳，ADR 0002 §2）；两进程并发驱动同一 ledger 在 v1 操作包络之外。
- **attach 永不驱动** —— 发现未完且本进程未驱动的 run 只轮询；复活发生在定义登记后跑过 boot 扫描的进程里。
- **`RunOptions.meta` 不落盘** —— 走骨 `runs` 表无 meta 列；meta 只存在于进程内句柄上。
- **运行时 invariant 伴随包是占位** —— core 保持无 Cordis 事件流的形态（无流可挂）；run/journal/promise 状态机由故障注入套件逐 append 点断言（spec 第 1 章 §9）。
- **不独立发布** —— 引擎随 `@daypaw/sdk` tarball vendored 分发（ADR 0011）；消费方经 `@daypaw/sdk` import 其面。
