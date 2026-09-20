# Agent Note：引擎核心里的一张停放等待表与一处终态解码

Status: implemented

[English](2026-09-17-daypaw-engine-parked-wait-table.md) | 中文

## 问题

`DurableEngineCore` 重复了两套机制。两个悬挂路径——`suspendOnGate` 与 `suspendOnSteer`——手搭同一套停放序列：一个捕获 resolve/reject 的 promise、一个给被遗弃等待用的已处理标记、一个把账本当跨进程兜底的 `setInterval`、一个意为「取消或销毁」的 abort 监听器，以及必须在两种情况下都幂等的入口、间隔、监听器拆卸。`suspendOnSteer` 自己的文档注释就承认它镜像 `suspendOnGate`；两张等待表也都是手写 map，键是手搭的字符串。

从 run 行到终态的译码写了四遍：`statusFromRow`、`settledResult`、`terminalRejection`，以及 attach 轮询里内联的 switch。四份里有两份——`settledResult` 与轮询 switch——是同一张判定表套了不同管道；另外两份则复述了它的片段（cancelled 的 cause、failed 的 error）。每一份都对，也都可能单独漂移。单写者与 first-terminal-wins 恰恰就押在这里：`done` 意味着解析后的 `output_json`，`failed` 意味着 `RUN_FAILED` 携解析后的 `error_json`，`cancelled` 意味着 `RUN_CANCELLED` 携 `cancel_cause`（[票 #117](https://github.com/0xnicholas/daypaw-pro/issues/117)）。

## 决策

`WaitTable<T, E>` 是引擎核心唯一的停放等待实现。悬挂路径登记一份 `WaitSpec`——表键、驱动器 signal、重复停放的报错文案、外部写者投递所经的 entry、返回 `WaitVerdict`（`wait` / `deliver` / `fail`）的 `poll()`、abort 的含义，以及可选截止时刻——其余归表所有：promise、被遗弃标记、`ended` 闩后面的唯一一次投递或失败收尾、跨进程间隔、截止定时器、abort 监听器，以及随首次收尾对上述全部的拆卸。`gateWaiters` 与 `steerWaiters` 是它的两个实例。

悬挂路径仍要供给的，是让它成其为自己的部分。gate 的 entry 携带 `resolveGate` 用来校验同进程结算的活值契约，并在投递时把它的 run 释放出 `waiting`。steer 的 entry 携带 body 已消费的段计数，不带载荷地唤醒 body，abort 时以拒绝收场。gate 的超时保持自己的 first-wins 规则：到期时写 `timedout`，再经推送路径同一条严格读取器投递，于是刚结算完却报行仍 pending 的账本会让等待响亮失败，而不是让它永久停放。

`settledOutcome(row)` 是把 run 行译成 `SettledOutcome` 的唯一一处——`done` 带记录的输出，`failed` 与 `cancelled` 带拒绝所报的载荷——而行尚在飞行中时返回 `undefined`。每个读者都走它：`statusFromRow` 把结果投影到公共状态 union（丢掉 `done` 的输出），`run()` 的 attach 分支改问「有没有结果」而不是先测 `isTerminal` 再译一次，`settledResult` 与 attach 轮询把它变成 resolve 或 reject，`terminalRejection` 从它取 cancelled 那一支。`rejectionOf` 一处构造已结算行所报的每个 `EngineRunError`，于是没有读者能与它读到的行不一致。

驱动器退出清扫改按停放条目自身的 `runId` 选取，不再扫复合键前缀，因此不再依赖 `gateWaiterKey` 造出的键格式。

公共面零变化：无导出、无 `@Remote` 端点、无 ADR 0002/0006/0010 陈述。

## 考虑过的替代方案

**两份手写孪生加一句「二者相仿」的注释。** 那正是本决策要移除的状态。第二份实现是对的，但只有读第一份才推得出来：轮询接线、abort 语义、拆卸纪律的任何改动都得在两边各做一遍，而文件里没有任何东西说明哪部分是共用机制、哪部分是该悬挂路径自己。

**每条悬挂路径一个子类，共用基类。** `GateWait` / `SteerWait` 这对子类要实现自己的账本读取，就得拿到运行中的核心（store、轮询间隔、销毁标志），从而把等待对象耦合到引擎私有面。spec 对象让表对两者都不知道，同时把悬挂路径自己的增量留在了它的调用点可见处。

**只在终态上定义、对飞行中行抛错的译码器。** 它在已结算调用点读起来很好、在飞行中调用点响亮失败，但那个 throw 不可达——`run()` 与轮询只会译它们已经看到离开飞行态的行——而逐文件 100% 覆盖门不接受没有测试能执行到的一支。对这两种状态返回 `undefined` 让译码保持全域，并给两个调用点各一个真实分支。

**把已结算读者的参数收窄为已结算行类型。** TypeScript 收窄的是 `row.status`，不是 `RunRow` 接口，因此「已结算行」谓词加收窄参数要么需要一次强制断言，要么需要对同一行再译一遍。`undefined` 那一支不需要其中任何一件就携带同样的信息。

## 后果

- `done` 行上的 `handle.status()` 解析 `output_json`；输出解析不动的行在该处响亮失败，因为 run 到头来是什么以账本为准。
- 完成竞速的 cancelled 那一支改经译码读取，因此 `failed` 行若 `error_json` 解析不动，暴露的是该解析错误，而非 `reached terminal state … before completion` 文案。
- 针对新缝的变异探针——删掉投递的释放、两条驱动器退出清扫、轮询的 pending 支、截止写入、abort 收尾、译码的 cancel cause——查出三件测试只在执行、从未断言的事实：gate 投递的 `waiting` → `running` 释放，以及两条退出清扫的效果。`tests/gate.spec.ts` 补上释放断言，`tests/fault-injection.spec.ts` 补上被遗弃的 gate 等待，并把被遗弃的 steer 等待强化为断言它名字本已承诺的那次拒绝。
- `ended` 闩是重复劳动的防护，不是可观察保证：首次收尾即注销条目，因此第二次收尾实际不可达，删掉闩的探针让套件保持全绿。
- `core.ts` 守住逐文件 100% 覆盖门，`pnpm run duplication` 全树仍报零克隆。
