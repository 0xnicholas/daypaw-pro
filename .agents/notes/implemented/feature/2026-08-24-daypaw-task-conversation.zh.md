# Agent Note: daypaw 任务对话（新任务对话框、任务列表、业务语言视图）

Status: implemented

[English](2026-08-24-daypaw-task-conversation.md) | 中文

## Problem

Issue #56 把[壳 IA 骨架](2026-08-24-daypaw-shell-ia-skeleton.zh.md)的分组计数、新任务占位与对话占位变成可用的任务面：从导航栏对话框创建任务（Agent 选择 + 首条 prompt）、列出收件箱分组的任务、以业务语言阅读单个任务的对话。沿用[设置票](2026-08-24-daypaw-settings-first-run-card.zh.md)的约束——上游 `packages/client/` 不动、host 为唯一事实源、zh 为文案 key 集权威——之外还要回答三个新问题：产品还没有任务引擎时「任务」是什么；对话栏如何不 fork 上游 chat 而渲染业务语言；组装态 fork 组合如何补上两票都挂账的快照覆盖。

## Decision

新增 fork client UI 插件 `packages/daypaw/ui-tasks`（`@daypaw/ui-tasks`，private，0.0.0），占据 ui-inbox 声明的三个子槽；并落地 fork 的组装级 web 快照车道（`apps/daypaw-web/tests/`、`vitest.web.daypaw.config.ts`、根 `test:web:daypaw` 脚本）：

- **任务即 session 的投影**——ui-inbox 的 `projectInboxBoard`（`src/client/task-projection.ts`）是从 sessions 列表出发的唯一投影：非空且 running → 进行中，非空且已停 → 已完成，pending 恒空。导航计数与任务列表共享它，两个面不可能不一致。列表行渲染每个任务的「最近动态」最后活跃时间（时钟由 owner 注入），崩溃恢复期的停顿读起来就是一个新近还在动的任务。[任务进度板块](2026-08-26-daypaw-task-progress.zh.md)把引擎 run ledger 并入同一投影；「任务」一词不漏任何 run/session/journal 措辞（locales 规格在两种词典里都拒绝该词表）。
- **对话视图是白名单投影，不是 chat fork**——`projectBusinessRows`（`src/client/chat-projection.ts`）走已组装的 Chat 快照，只保留用户消息、steering、助手文本与一条本地化的终态失败标记；工具调用、命令、重试、指标与隐藏节点按白名单出局。`ConversationView` 在会话运行时加「进行中」状态行（崩溃恢复期的停顿读起来就是普通进度，恢复本身不可见），并留一个禁用的追问输入席位。
- **selection 单向驱动 runtime 当前会话**——ui-inbox 的 `InboxSelectionController` 现在接 `ctx.sessions.open`：选中任务同时 set selection 并 open 会话，session-maybe 的对话席位由此解析到选中的任务。分组与页面选择从不触碰 runtime 会话。
- **提交扛住 create/list 竞态**——`sessions.open` 对未列出的 id 会 loud 失败，而 host 的 session-added 帧与 create 响应竞态，所以 `NewTaskStore.submit` 先等 list 投影载上新行（`whenListed` 订阅）再 open → `binding` → 首条 prompt。失败以通用本地化文案内联落在对话框——host 原始错误措辞从不上屏；只有成功才调 owner 的 `openTask`（由它导航并关闭）。
- **组装快照车道从构建产物启动 fork roster**——`apps/daypaw-web/tests/assembled-boot.ts` 沿用 apps/web 先例（AppWebEntry ModuleLoader + 免 key 的 FixtureApiClient，钉英文），roster 取 cordis.patch.yml 的 client 行。roster 含 `@deepseek-ai/dsh-client-ui-conversation`，尽管没有任何上游 chat 面渲染：Chat 节点定义（`user`/`assistant-step`/`turn-error`…）由该包注册进 `ctx.conversationEvents`，缺了它组装出的 Chat 快照是空的，白名单投影无米下锅。它 priority-0 的 `conversation`/`details` 占位仍被 ui-inbox 的 -1 遮蔽。

测试走 [GUI 测试体系](../process/2026-07-20-gui-testing-system.zh.md)的零脚手架路径：store 规格覆盖可编程 wire 假件（roster 健康过滤、默认预选、latest-wins 代际、提交守卫、whenListed 等待、非 Error 拒绝），jsdom 组件规格（对话框流程、列表行、白名单投影含隐藏/空文本跳过、禁用追问席位），`toMatchSnapshot`，以及在真实 `SlotRegistry` + `LocaleRuntime` 上钉三个席位与拆卸的 apply 规格，外加组装旅程快照（对话框 → 提交 → 流式回声 → golden 文本 shape）。包 src 保持 per-file 100% 覆盖。新增 core touch（tsconfig.client.json 的 reference/include 行、knip workspace 与 web-app 豁免、根 test:web:daypaw 脚本）已登记 [CORE_TOUCHES.md](../../../../docs/fork/CORE_TOUCHES.md)。

## Alternatives considered

- **每个任务配独立对话 store**——否决：session-maybe 席位已经通过标准 `useSession` 套件把当前 `ConversationSnapshot` 交给占位者；第二个 store 会分叉事实源。视图保持纯投影模块加标准 hook。
- **逐 kind 排除而非白名单**——否决：chat 组装的节点 kind 是可 merge 扩展的，任何已装插件都能加；枚举「要隐藏什么」会把每个未来 kind 静默漏给非技术用户。白名单失败即关。
- **快照 roster 不含 ui-conversation**（方案原文「不进图」）——证据否决：client-runtime 只给 `EMPTY_CHAT_SNAPSHOT`；填充它的节点定义在 ui-conversation 的 conversation-nodes 注册里。车道要的是它的数据，不是它（已被遮蔽）的占位者。

## Consequences

fork 组合现在启动即可走完任务闭环：导航 → 新任务对话框 → 流式的业务语言对话，由免 key 的组装快照端到端钉住。该车道同时关掉前两票挂的组装级 web 覆盖账。代价：任务分组的 session 侧仍由 sessions 列表的 `blank`/`running` 位推导（pending 恒空、崩溃恢复期读作进行中；[任务进度板块](2026-08-26-daypaw-task-progress.zh.md)把 run ledger 并入同一投影）；追问输入是惰性席位；对话席位的 session-maybe scope 意味着无当前会话时渲染 owner 占位，永不渲染视图本身。

## Deferred

可用的追问输入（追问票）与流内审批卡（审批票）仍为后续票范围，与包 README 的 Known Limitations 互镜；引擎-backed 查询面、run 级重试与选中任务详情栏随[任务进度板块](2026-08-26-daypaw-task-progress.zh.md)落地。
