# Agent Note：从壳上作答 durable gate

Status: implemented

[English](2026-09-19-daypaw-gate-answer-surface.md) | 中文

## Problem

人审 gate 是支柱①的承诺之一：ADR 0002 §3 定下唯一的 durable promise 缝，其 resolve 入口 = SDK 调用 / Manager UI /（留口）webhook；壳的「等待你确认」分诊也把一个 waiting run 呈现为需要人来处理的任务。

而浏览器平面**完全没有 gate 事实**：`WireRun` 丢弃 `runs.waiting_gate`，`resolveGate` 不带 `@Remote` 标记，于是这条缝唯一的写入者是产品进程内的 host 代码。挂在 `ctx.waitFor` 上的 workflow 因此走到超时分支，而它的看板行却读作「等你确认」（[票 #128](https://github.com/0xnicholas/daypaw-pro/issues/128)；首个真 workflow 负载记下的正是 `resolution_source` 为空的超时）。

gate 的批准值是任意 JSON——引擎持久化它的 `schema_json` 供表单渲染（ADR 0002 §3）——所以作答面需要一个调用方写出的值，而不是一对固定按钮。

## Decision

- **读面就是 run 行。** `WireRun.waitingGate` 镜像 `runs.waiting_gate`；账本行本就随 `durable/listRuns` 过线，故浏览器平面是**保留一个此前丢弃的字段**，而不是新增第二次读取。停泊 run 的 gate 名正是分诊与作答卡共用的依据。
- **一份分诊、一个标记。** `TaskRow.awaiting: 'approval' | 'gate'` 供给「等待你确认」分组：会话的挂起审批与挂在自身 gate 上的 run 落在一起，靠 kind 区分；两种情况下行的状态文案都是严格的等待文案。
- **写面是 `@Remote('resolveGate')`。** 浏览器省略 `source`，host 记 `'manager'`（ADR 0002 §3 的 Manager UI 档），SDK 调用方照旧自带 source。wire 类型 `WireGateSettlement` 把批准值定为 `Json`：Remote 参数不能携带无约束的 `unknown`；host 缝保留 `GateSettlement` 更宽的值。first-wins 保持可观察——`false` 表示该 gate 已被他人、超时或取消结算。
- **作答卡住详情列。** 无会话的 workflow run 没有对话席位可钉卡片，故卡片渲染在 run 各区块之上：gate 名按定义声明原样显示、批准值用 JSON 框并对语法做本地校验（值本身由 gate 自己的契约在 host 侧校验）、拒绝可选填理由，结果读三种文案——已作答、已被他处结算、以及从不回显 host 措辞的内联失败。草稿属于一个 run，选中态一变即复位。
- **引擎保持静默 first-wins 语义。** 未知 run 或已过期的 gate 返回 `false` 而非抛错：那是 `resolveGate` 的既定行为，卡片把它读作「已被作答或已超时」。

## Alternatives considered

**这一步就做 schema 驱动的表单渲染。** 它要把 promise 的 `schema_json` 上 wire 再加一个表单渲染器，而 ADR 0002 §3 已经把那一面交给 Manager UI；在它落地前 JSON 框服务技术用户面，平台上新任务弹窗承接任意定义的值用的也是同一种做法。

**单开一个待作答 gate 端点。** `durable/listRuns` 已返回整行，gate 名搭看板既有的轮询即可；第二个端点会重复那份节奏，并让同一个事实有两个家。

**把 host 缝对未知/终态 run 改成抛错。** first-wins 的 no-op 是给 SDK 调用方的既定契约，而它本来要服务的浏览器情形——gate 在别处被作答，或在渲染与点击之间超时——正是这个 no-op 所报之事。

**一对不带值的同意/拒绝按钮。** 声明了值 schema 的 gate 都会拒收空批准（首个真负载的 gate 要 `{approve:true}`），于是那对按钮对现存 gate 一发一个准地失败。

## Consequences

- 真人可以作答真 workflow 的 gate，账本把壳的作答记为 `resolution_source = 'manager'`；停泊的 body 走 SDK 结算同一条投递路径恢复。
- 两个事实不上 wire：gate 的 `schema_json` 与截止时间。gate 作者期望的值只能从定义得知，卡片因此也显示不了 gate 还剩多久。这记为 Manager 后续面的具名缺口，而非静默省略。
- 覆盖率：engine 的 gate 用例断言浏览器默认 source；客户端用例覆盖 run 解析器的 gate 字段与 resolve 调用的信封和答案类型；投影用例覆盖 gate 分诊；卡片自己的用例覆盖批准、拒绝、坏 JSON、落败结算、wire 失败与草稿复位；组装车道新增 `gate-answer.golden.ts`，由 fixture 把一条 run 停在 gate 上，使分诊、卡片与一次往返都在真 built bundle 上得到证明。
- fixture 的账本多了一条 waiting run，既有组装金样随之移动：「等待你确认」计数载两项，停泊 run 的行进入该分组列表。
