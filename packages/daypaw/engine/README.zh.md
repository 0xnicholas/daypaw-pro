# @daypaw/engine

[English](README.md) | 中文

durable 执行引擎（`ctx.durable`）：run 生命周期、step 去重续跑、单写者认领与 boot 扫描复活，落在 [`@daypaw/store`](../store/README.md) ledger 之上。作为 Cordis 插件加载；应用经类型化 [`@daypaw/sdk`](../sdk/README.md) facade 调用。语义：[spec 第 1 章](../../../docs/spec/01-durable-execution.md)；走骨范围：[ADR 0008](../../../docs/adr/0008-landing-order-walking-skeleton.md)。

## Service API

`ctx.durable`（插件 `@daypaw/engine`）：

- `register(def)` —— 登记不透明定义（kind/name/version + body thunk）供执行与 boot 复活。同身份不同 body 拒绝；登记会触发 boot 扫描，可能复活前一进程留下的未完 run。
- `run(def, input, { runId?, signal? })` —— 幂等 start-or-attach：未知 runId 插入并驱动；终态 run 从行结算；本进程在驱动的 run 返回活句柄；其余按 `pollMs` 轮询——attach 永不夺权，复活是 boot 扫描的职责。
- `idle()` —— 本进程不驱动任何 run 时 resolve。

配置（schemastery）：`path`（ledger 文件或 `:memory:`）、`pollMs`（attach 轮询间隔，默认 1s）。

## 执行模型

run 以 step ctx 驱动其 body。`ctx.step(name, fn, { key? })` 派生幂等键 `name#occurrence`（或显式 key）；已完成 step 直接返回已记录结果不再执行，未完成的（重）执行并记录——执行 at-least-once，step 提交 exactly-once。取消先写终态行，在下一 step 边界生效。销毁停止驱动且不写终态：未完 run 保持可复活。

## 扩展点

- **`JournalStore` 缝**（`./seams`）—— 走骨落地的唯一可替换接口；SQLite 实现为 `SqliteJournalStore`。它也是崩溃测试套件的故障注入面。promise/timer 缝随其原语落地。
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

- **走骨原语集** —— 仅 `ctx.step`；`sleep` / `waitFor` / `agent` / `spawn` 随其状态机按需落地，届时 `status()` 不再对 `waiting` 行抛错。
- **无跨进程存活检测** —— boot 扫描可夺走另一*活体*进程的认领（死认领重指派按设计无需心跳，ADR 0002 §2）；两进程并发驱动同一 ledger 在 v1 操作包络之外。
- **attach 永不驱动** —— 发现未完且本进程未驱动的 run 只轮询；复活发生在定义登记后跑过 boot 扫描的进程里。
- **`RunOptions.meta` 不落盘** —— 走骨 `runs` 表无 meta 列；meta 只存在于进程内句柄上。
- **运行时 invariant 伴随包是占位** —— 关系检查随其守护的 promise/timer 状态落地；在此之前由故障注入套件断言状态机（spec 第 1 章 §9）。
