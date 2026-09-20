# Agent Note: 持久 timer —— `ctx.sleep`

Status: implemented

[English](2026-09-19-daypaw-durable-timer.md) | 中文

## Problem

spec 01 §6 已定 `ctx.sleep` 语义、§3.4 已设计 `timers` 表，但走骨把两者都推迟（「按需落地：首个需要 sleep 的真实 workflow 出现时实现」），[gate note](2026-08-23-durable-gate-waitfor.zh.md) 只覆盖 `ctx.waitFor`（[ticket #124](https://github.com/0xnicholas/daypaw-pro/issues/124)）。于是需要等待墙钟时间的 workflow 没有耐久原语：裸 `setTimeout` 在重驱动时重执行，进程一死等待即丢失。

四件事仍未定。原语无 name，其 step 族幂等键从何而来。已录但未到的截止在重驱动时怎么办——按录等，还是重算时长。`fired` 标志由谁写、相对 body 续跑先写还是后写。以及所有进程都不在期间错过的截止在哪里入账。

## Decision

- **`timers` 是 store 拥有的表（迁移 3）** —— 主键 `(run_id, step_key)`，列 `wake_at`、`fired`（0/1）、`created_at`，逾期查询即规格的 `fired = 0 AND wake_at <= ?`；`TimerRow` 与 `TIMERS_TABLE` 进 store 契约，golden `0003-v3.db` fixture 覆盖该段。sleep 占 step 族幂等键位，故 `journal` 不新增 `kind`。
- **键按调用序派生** —— `ctx.sleep(durationMs)` 没有 name，引擎按调用在 body 中的位置派生 `sleep:<occurrence>`，与 step 键按 `name#occurrence` 派生同理；`sleep:` 前缀与 `steer:` 一样保留，按同一序重驱动的调用重派生同一键（spec 01 §10 的确定性要求）。
- **已录截止决定重驱动行为** —— 已 fired 的行直接返回、不重等；未 fired 的行等到**已录的** `wake_at`，故崩溃既不重等也不延长（复活 body 传入的时长被忽略）；未 fired 但截止已过的行立即返回。这正是「至少醒一次、迟到不丢」。
- **唤醒先落账再投递** —— 到期先把行翻成 fired（`UPDATE … WHERE fired = 0`，first-wins），之后才让 body 续跑，故唤醒后崩溃不会重等。进程内的 `setTimeout` 到期、body 自身的过期读取、boot 扫描的补发，是同一条条件写的三个调用者。
- **挂起复用等待表** —— `ctx.sleep` 经 `WaitTable` 缝挂起（#117）：截止 = 已录 `wake_at`，轮询 = run 行（跨进程取消或他处终态结束挂起），中止 = `RUN_CANCELLED`（取消）或 `ENGINE_DISPOSED`（销毁）。sleep 期间 run 的 ledger 状态保持 `running`：sleep 不是 gate，`waiting_gate` 只记 gate，boot 复活本就把 `running` 与 `waiting` 一并覆盖。
- **boot 扫描把补记错过截止放在最后一步**（spec 01 §5 第 4 步）—— 先扫 overdue promise、再复活 run，最后把每条 `fired = 0 且 wake_at <= now` 的 timer 记 fired，包括定义无人注册、run 未复活的那些：即便没有消费者接走这次唤醒，ledger 也留有截止已过的事实。
- **SDK 继承该原语** —— `WorkflowCtx extends EngineStepCtx`，`ctx.sleep` 经引擎声明直达 workflow body；`enrichStepCtx` 透传。不加 Remote 端点、不做 Manager 视图：timer 读取面属于 Manager 子项目。

## Alternatives considered

**抽 `TimerScheduler` provider 缝。** spec 01 §7 把 timer 调度列为 daemon 化的三个可替换接口之一。本次否决：只有一个实现、也看不到第二个消费者，故 store 方法加 core 里的挂起即缝——与 [gate note](2026-08-23-durable-gate-waitfor.zh.md) 对 `PromiseResolver` 的裁决同理，抽取条件不变（出现第二个实现）。

**用 `journal` 的 `kind = 'timer'` 记 sleep。** journal 的 `kind` 列不承载 timer/sleep 值。否决：§3.4 为 timer 单立表，其 `wake_at` 与 `fired` 列正是两个读者所需（body 的去重读、boot 扫描的逾期扫描）；记进 journal 会让一次调用出现第二个去重权威，且 journal 的读者（step 时间线、steer 段）要多虑一个 kind。spec 01 §3.2 把 sleep 路由到 `timers` 表。

**`ctx.sleep(name, duration)`。** 有 name 即可手写每处 sleep 的键，省掉派生假设。否决：spec 与 ADR 0003 已把签名定为 `ctx.sleep(duration)`；step 先例本就按调用序派生键；保留前缀即可把派生键与用户键隔开——`steer:` 先例。

**裸 `setTimeout` 加中止监听。** 最省的挂起，截止同样是时间戳。否决：睡数小时的 run 要到截止才察觉跨进程 `cancel`；遗留 timer 需另写 driver 退场清理；而 `WaitTable` 挂起本就提供轮询、截止、中止语义与拆卸这三者（#117 正为这第三处挂起落的缝）。

**只在 boot 扫描写 fired，或只在 body 的读取里写。** 单一写点更易推演。否决：body 的读取本就要回答「我的截止是否已入账」以去重；只靠扫描会让已复活但扫描未跑的 body 挂在一个已过的截止上。两处同走一条带 `fired = 0` 守卫的更新，彼此收敛而非依赖先后。

**sleep 期间把 run 标成 `waiting`。** 这样睡眠中的 run 能经 gate 用的同一状态判别可见。否决：`waiting_gate` 存的是 gate 名、`RunStatus.waiting` 也带该名；steer 挂起本就保持 `running`；复活的认领同样覆盖 `running`。

## Consequences

- workflow 现在可以耐久地跨墙钟等待：睡中杀掉、过截止复活，它会跨过该 sleep 续跑而不重跑前后的 step，ledger 上留一条 fired 的 timer 行（`sleep:0`）与已完成的 step。
- timer 刻意不准时——没有东西去唤醒进程——故没有进程在跑时，唤醒发生在截止之后的第一次 boot（spec 01 §10 的运维注记，现由已落地行为支撑）。
- `fired` 记录的是截止已过，而非 body 已消费：boot 扫描会为无人复活的 run 的 timer 落 fired，之后的 re-drive 立即返回。被取消或销毁的 run 其 timer 保持未 fired——那次 sleep 从未醒来。
- 引擎维持 per-file 100% 覆盖率门：`tests/sleep.spec.ts` 承载 14 个行为用例（落账与唤醒、逾期补发、按已录截止等待、fired 去重、不可复活 run 的扫尾、零时长、并发 sleep、同进程与跨进程取消（含无 cause）、他处终态行、销毁、睡中重驱动、被弃置的等待），故障注入套件新增 9 个 timer 用例（查/插/到期写/逾期写/扫描故障、挂起轮询故障，以及注入时钟跨重启补发逾期 timer 且不翻倍副作用）。
- 示例的 SIGKILL 证明线增添 timer 场景：走骨 workflow 接受 `sleepMs` 输入，`tests/sigkill.spec.ts` 在其睡眠中杀死宿主、过截止后回来，断言 fired timer 两侧 step 各恰一次。
- `JournalStore` 读面新增三个 timer 方法与逾期扫描；`SqliteJournalStore` 的实现与 store 迁移是它们旁边的机械件。
