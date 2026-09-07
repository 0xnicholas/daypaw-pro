# Agent Note: 轻对话入口回归 daypaw 收件箱

Status: implemented

[English](2026-09-07-daypaw-light-chat-entry.md) | 中文

## Problem

上游 dsh web 壳一直有直接对话的入口；daypaw 重做 IA 时把一切对话收进任务面（map #1 的「一切皆任务」立场）。使用证据（[#102](https://github.com/0xnicholas/daypaw-pro/issues/102)，2026-09-02 使用证据盘点）显示 owner 日常对话全在 daypaw 之外、任务面 10 天仅 3 run：该立场既没留住对话也没养成任务习惯。裁决 [#98](https://github.com/0xnicholas/daypaw-pro/issues/98)（map #95，缺口②自 map #77 移交）裁「接回」——最便宜的日常驻留实验；立场松动对 spec 05 §1 的正式影响归定位裁决（#99）与修订定稿（#101），不在本变更。

## Decision

收件箱导航在「+ 新任务」旁携带「直接和助手聊」：展开列的全宽 outline 按钮与折叠轨上的对话图标（`@daypaw/ui-inbox` InboxNav，文案在 `inbox` locale 命名空间）。入口经 `ctx.sessions.create()` 开**普通会话**——不经引擎 run、不选定义、无 `startRun`——并走既有 `kind: 'task'` 选中路径，对话因此经既有中栏占据者渲染，零新增选中管道。建会话失败仅警告（导航列是无状态纯 props；上游 ui-workspace New Session 的失败先例），且绝不移动选中态。

对话席位（`@daypaw/ui-tasks` ConversationView）对无 run 会话保持输入可用：任务的持久 run 未完时席位照旧 steer（#94），无 run 会话——轻对话场景——经审批拒绝附言所走的同一发送器发普通排队 session prompt（`binding.session.prompt(..., 'queue')`），永不走 steer。对话席文案在 `daypaw-tasks` 命名空间（`conversation.chat.*`）。

无 run 会话行本就由 `projectInboxBoard` 的 session-rows 路径投影；新建的空 session 保持不可见草稿，首个被接受的 prompt 翻掉 blank 位后按状态分组列出，并在每次投影通过时从持久 sessions 列表重建——刷新重建的正是同一张脸。

## Consequences

不经任务弹窗即可开聊；定稿的对话以无 run 行出现在「已完成」分组，经持久 sessions 列表跨刷新保真。席位活性规则从「仅未完 run」放宽为「未完 run 或无 run」：刚启动的引擎任务在其账面行尚未载入的瞬态窗口内会短暂渲染轻对话占位符，板块 tick 落位后切回追问席；该窗口内发出的 prompt 走排队通道，由引擎会话当 steering 消费——与拒绝附言依赖的语义相同。反复点入口会新建多个收件箱隐藏的空 session（空草稿永不上行）；host 将它们留作普通空会话。daypaw 产品词汇由此获得第一个非任务对话词（聊天），与任务词汇同驻 locale 词典。

## Alternatives considered

**不接入口（挂账观察或明确不做）**：裁决 #98 否决——使用证据表明任务唯一立场既没留住对话也没养成任务习惯，而收件箱本就渲染无 run 行、会话选中路径现成，入口是通往日常驻留最便宜的实验。

**点击时复用既有空草稿（上游 New Session 复用规则）**：否决——上游复用按 cwd 加 workspace 归属匹配，daypaw 的建会话路径不带这些事实；而足够宽松的匹配规则可能窃取引擎孪生诞生瞬间的空会话。每次点击铸造一个新的不可见草稿是更小的危害。

**专设 `kind: 'chat'` 选中种**：否决——`kind: 'task'` 路径已单向驱动 `sessions.open` 并解析对话席位；并行选中种会为零行为差异复制选中管道，投影本就把轻对话当作无 run 会话行。

**导航列上的内联建会话失败面**：否决——InboxNav 今天是无状态纯 props；为 host 宕机的边缘情形在列上引入无对话框的错误态，代价高于保持组件契约不变的警告路径（上游 New Session 失败先例）。
