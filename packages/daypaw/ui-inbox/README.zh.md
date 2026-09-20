---
description: "daypaw 壳 IA 骨架（收件箱工作台），fork 的 client UI 插件，包形对齐上游 。它按 在整包复用的 三栏框架上实现三栏 IA，只用呈现层词汇（任务/新任务/等待你确认/进行中/已完成/设置/任务详情——引擎词不出现在文案里）。契约：。"
kind: "package-reference"
---

# @daypaw/ui-inbox

[English](README.md) | 中文

## 概述

## 目录



daypaw 壳 IA 骨架（收件箱工作台），fork 的 client UI 插件，包形对齐上游 [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.zh.md)。它按 [docs/spec/05-product-shell.md §3](../../../docs/spec/05-product-shell.md) 在整包复用的 [`ui-layout`](../../client/ui-layout/README.zh.md) 三栏框架上实现三栏 IA，只用呈现层词汇（任务/新任务/等待你确认/进行中/已完成/设置/任务详情——引擎词不出现在文案里）。契约：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

一个 `apply` 里三次注册，全部是纯 props、零 ctx 的组件（两处遮蔽席经 `slots.inject` 挂在席位声明上，声明归上游声明方所有——fiber 激活次序不再是契约的一部分；`'sidebar'` 仍直接注册：ui-layout 在提供本 apply 等待的 `layout` 服务的同一 effect 里声明它，缺席时失败保持大声）：

- `InboxNav` 占据 `'sidebar'`（root scope），在 [`@daypaw/web-app`](../web-app/cordis.patch.yml) 的 roster 里整行替换上游 ui-sidebar。展开态：wordmark、最显眼的主色「+ 新任务」大按钮（打开一个 Modal，正文委托给 `'inbox.new-task.dialog'` 子槽——由 [`@daypaw/ui-tasks`](../ui-tasks/README.zh.md) 占据，槽位空时显示桩文案）、旁边的「直接和助手聊」轻对话入口（issue #102：`ctx.sessions.create` 开普通会话——不经引擎 run、不选定义、无 startRun——直接选入对话；建会话失败仅警告，导航列没有内联失败面）、带实时计数的三个收件箱分组「等待你确认/进行中/已完成」（计数由混合板块 feed——run ledger ∪ sessions 列表——投影而来）、以及钉在底部的 Agents/设置 次要导航。折叠态：`'sidebar'` 占据者契约要求的紧凑控制轨（侧栏开关 + 新任务与轻对话图标按钮）。
- `WorkspaceSwitch` 以优先级 -1 占据 `'conversation'`（session-maybe scope），遮蔽 ui-conversation 优先级 0 的占位占据者，其声明的席位仍为休眠生态保留。它按选中项切换中栏容器：收件箱分组容器（任务列表由 `'inbox.workspace.tasks'` 占据者按属主投影的行渲染，无占据者时回落空态）、单个任务的对话（由 `'inbox.workspace.conversation'` 占据者渲染；属主传入按 sessionId ≡ runId 键控的账面 run 状态，占据者的追问席以 run 为准，而非会话的 agent running 位）、Agents 目录页（由 `'inbox.agents.page'` 占据者 [`@daypaw/ui-agents`](../ui-agents/README.zh.md) 渲染）或 设置 页。其余子槽：`'inbox.workspace.banner'`（list，session-maybe）渲染在每个分组容器顶部，承载首跑与工作区级通知；`'inbox.settings.page'`（single，session-maybe）承载设置面——由 [`@daypaw/ui-settings`](../ui-settings/README.zh.md) 占据，槽位空时回落到属主的占位页。中栏顶部在每个选中面上方承载连接恢复指示器（issue #93，上游设置壳指示器的业务语言移植）：复用 [`ui-primitives`](../../client/ui-primitives/README.zh.md) 的 ConnectionIndicator 药丸，直接消费 wire 服务自身的恢复出口面（`ctx.connection.state` + `ctx.connection.reconnect`，经 `useConnectionState` 钩子与重连命令注入）——健康时不渲染，断线期间显「网络连接已断开」/「正在重连」及点击重连命令，链路恢复后保持两秒「连接已恢复」确认；文案入 `inbox` 词典。
- `TaskDetail` 以同样的遮蔽优先级占据 `'details'`（session scope）：选中任务的详情容器。内容以工作台选中态为键，绝不以 session 席位为键——该槽是严格 session 作用域，选中无 session 的 workflow run 时席位可能带着陈旧会话。run 选中渲染头部（run 标题、严格状态文案、失败 run 的「重试」按钮），正文委托给 `'inbox.detail.body'` 子槽（由 [`@daypaw/ui-tasks`](../ui-tasks/README.zh.md) 占据）；其余选中回落到空态（「选择任务查看详情」）。

共享选中态（`{ kind: 'group', group } | { kind: 'task', sessionId } | { kind: 'run', runId } | { kind: 'agents' } | { kind: 'settings' }`，默认「进行中」分组）经一个 apply 闭包自有的 `InboxSelectionController` 跨越三个 slot scope：一个 store 句柄不能挂在两个 scope 下，因此裸 snapshot 源走每个 register 调用 inject 的 `hooks` 舱位，渲染器把它绑成各组件的 `useSelection` hook。选中任务还经 `ctx.sessions.open` 单向驱动 runtime 当前会话，session-maybe 的对话席位由此解析到选中的任务；run 选中不打开任何会话。两种等待经同一个 `awaiting` 标记进入「等待你确认」分诊：会话的挂起审批（`'approval'`）与挂在自身 durable gate 上的 run（`'gate'`，读 `runs.waiting_gate`；票 #128），后者由详情列的作答卡结算。任务行与分组计数共享同一投影（`projectInboxBoard`），落在混合 feed 之上——顶层 durable run ∪ 无 run 的 session，agent run 认领其 session 孪生（其 runId 即 session 身份），空 session 保持草稿身份。ledger 侧由 apply 闭包自有的 `RunsBoardStore` 每 `RUNS_BOARD_POLL_MS`（2 秒——产品常量，WebBootEntry 不携带逐插件配置通道）轮询 gateway 的 `durable/listRuns` Remote 端点而来，每个 wire 字段都在 `@daypaw/durable-client` wire face 的边界校验；`TaskDetailStore` 加载选中 run 的血缘与 journal 时间线（`durable/runLineage` + `durable/journalTimeline`），重试分发器调 `durable/rerun` 后踢板块刷新。五个 run 状态共享一份文案出处（`@daypaw/durable-client` 自持的 `'durable'` 命名空间，经详情列注入的绑定翻译函数渲染），导航计数、列表行与详情头部三处不会漂移。新任务对话框的开关态是组件局部 state，导航向它的占据者交三件 owner：`close` 关掉它、`openTask` 选中刚建的 agent run 的会话、`openRun` 选中刚建的 workflow run 自身（workflow run 没有会话）。文案走插件自有 `inbox` locale 命名空间的类型化 `t` 位（zh 产品文案，外加机制要求的 en 词典）。样式只用 CSS Modules 消费 `--dsw-alias-*` 语义 token。

## Model Experience

### 收件箱工作台 UI

#### What the model sees

无。本包只渲染面向任务的 UI；`InboxNav`、`WorkspaceSwitch`、`TaskDetail` 不贡献任何 prompt、工具或 schema，这里没有任何东西进入模型请求。

#### Token effect

零 live-request token。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **板块靠轮询，无推送**——浏览器每 2 秒刷新一次 run ledger（`RUNS_BOARD_POLL_MS` 是产品常量：WebBootEntry 启动图不携带逐插件配置通道）。spec §5 的 host 轮询 + mux 投影设计等跨 session 投影通道——session 投影严格按会话隔离，承载不了跨 run 的板块。
- **「等待你确认」以 session 的 approval 徽章为键**——行的 runtime 会话摘要带 `pendingInteraction: 'approval'` 时进分组（每次 mux open 重放恢复），因此被 question 遮蔽的 approval 不进计数，无 session 的 workflow run 永远得不到徽章（run 作用域审批通道尚不存在）。
- **上游 conversation/details 占据者是遮蔽而非移除**——ui-conversation 的 roster 行保持挂载（其声明的席位服务休眠占位生态）；本包以优先级 -1 赢得两个单元格，移除上游行是后续板块决策。

### 开发备注

**运行时 invariant：**不发布 companion。本插件是纯表现层：选择与 run store 由本包 apply/component spec 直接断言；不 emit Cordis 事件；其轮询的 engine ledger 始终是事实源。
