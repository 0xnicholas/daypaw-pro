# Agent Note: 耐久 gate 原语——`ctx.waitFor` / `resolveGate`

Status: implemented

[English](2026-08-23-durable-gate-waitfor.md) | 中文

## 问题

spec 01 §6 把 durable promise 定义为 HITL gate：workflow 挂在一个具名 gate 上，外部行动者 resolve 它，而 run 必须在其间扛住进程死亡。[走骨 note](../architecture/2026-08-19-daypaw-walking-skeleton.md) 把 promise 存储与 `waiting` 状态推迟到这次按需落地（issue #47）。四个决策开放：gate 单独落地还是与 `ctx.sleep` 一起、promise 决议是否单设缝包、payload schema 在哪一级校验、两个决议竞态时采哪种结算语义。

## 决策

- **gate 先行，sleep 缓议** —— `ctx.waitFor` 单独落在 `EngineStepCtx` 上（SDK 侧为 `WorkflowCtx.waitFor`，其 zod 选项 schema 经 `adaptGateSchema` 适配为 JSON Schema）；`ctx.sleep`、timers 表与任何 `PromiseResolver`/`TimerScheduler` 缝在有调度调用方之前不建。
- **决议收在 core，不新设缝包** —— promise 行经 `JournalStore` 新增的七个方法（`insertPromise`、`selectPromise`、first-wins 的 `settlePromise`、`selectOverduePromises`、`cancelPendingPromises`、`setRunWaiting`、`resumeRun`），底层是 store 包迁移 2 的 `promises` 表（主键 `(run_id, gate)`，五态 pending/resolved/rejected/timedout/cancelled）；store 实现恰有一个，此时抽 `PromiseResolver` 是投机式泛化。
- **两级 schema 校验** —— 写侧仅当本进程存在 waiter 时校验（让决议调用方失败、不落账），因为经另一引擎实例写入的跨进程决议无法在该点检查；投递侧在把值交给 waiter 之前必验落账行，落账但非法的决议使 run 失败而非投递。
- **first-wins 结算** —— `settlePromise` 的条件 UPDATE 让首个落账结算胜出，对齐 dsh jobs 结算先例与 Resonate strict 模式；败北的 `resolveGate` 观察到的是已落账的行，而非覆盖它。
- **每个 waiter 三路唤醒** —— 本进程 waiter 由 `resolveGate` 直推；跨进程结算靠 `pollMs` 轮询发现；按 `timeoutMs` 武装的 `setTimeout` 结算 `timedout`。abort 投递的是 `cancelled` *值*（workflow 可分支的合法 gate 结局），引擎销毁则 reject `ENGINE_DISPOSED`；waiter promise 预挂 handled 标记，被遗弃的等待永不击垮进程。
- **boot 扫描扫尾逾期 promise** 先于复活驱动者，将其结算为 `timedout` 并通知存活 waiter；`waiting` 以 `{ state: 'waiting', gate }` 加入 `EngineRunStatus`，从行的 `waiting_gate` 列读回，waiting 行上 gate 为 null 按账实不符上报；`cancelRun`（改为异步）与驱动者侧取消会取消 pending promise，驱动者 `finally` 遗弃孤儿 waiter，使死于等待中的 body 不在 `db.close()` 之后泄漏轮询定时器。

同一次改动浮现并修复了两个潜伏 bug：`finalizeCancelledFromDriver` 的 `status !== 'running'` 守卫会跳过 waiting run 的 finalize（现改为基于 `isTerminal`），修复前的 `cancelRun` 同步抛错破坏了其 promise 契约。

## 曾考虑的替代方案

- **gate 与 sleep 一起落地** —— 否决于范围：timer 侧有自己开放的语义（delay 还是 cron、漏发策略）且尚无调用方；gate 原语对 HITL 独立可用。
- **预先抽 `PromiseResolver`/`TimerScheduler` 缝包** —— 否决：实现只有一个；七个 store 方法就是缝，现在抽象是无第二个消费者时臆造边界。
- **仅决议侧校验** —— 否决：跨进程决议方（未来的 Manager/webhook 或裸 SQL）会绕过它；投递侧校验是每个决议必经的唯一点。
- **last-wins 或先写后报错结算** —— 否决：竞态决议方会翻转已结算的 gate 或让胜者含糊；first-wins 保持 ledger 权威并对齐 jobs 结算先例。

## 结果

workflow 可以耐久地挂在人工输入上：挂在 gate 上的 run 零算力消耗，`SIGKILL` 后凭 promise 行重新锚定复活，且恰好观察到一个结算。取消 waiting run 会取消其 pending promise，而不波及同名 gate 上邻 run 的 waiter。跨进程决议方没有写侧校验——已在引擎 README 记为已知限制——因为那里的合法性只能在投递侧强制。invariant 伴随包保持有解释的占位：core 不持可挂的 Cordis 事件流（缺口 2 裁决），gate 状态机由故障注入套件在每个 journal 追加点（14 个用例）外加 19 个行为用例断言；`ctx.sleep`、timers 表与 Manager/webhook 调用方留作后续工作。
