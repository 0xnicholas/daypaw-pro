# @daypaw/ui-inbox

[English](README.md) | 中文

daypaw 壳 IA 骨架（收件箱工作台），fork 的 client UI 插件，包形对齐上游 [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.md)。它按 [docs/spec/05-product-shell.md §3](../../../docs/spec/05-product-shell.md) 在整包复用的 [`ui-layout`](../../client/ui-layout/README.md) 三栏框架上实现三栏 IA，只用呈现层词汇（任务/新任务/等待你确认/进行中/已完成/设置/任务详情——引擎词不出现在文案里）。契约：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

一个 `apply` 里三次注册，全部是纯 props、零 ctx 的组件：

- `InboxNav` 占据 `'sidebar'`（root scope），在 [`@daypaw/web-app`](../web-app/cordis.patch.yml) 的 roster 里整行替换上游 ui-sidebar。展开态：wordmark、最显眼的主色「+ 新任务」大按钮（打开一个最小可关闭的对话框桩）、带计数位的三个收件箱分组「等待你确认/进行中/已完成」、以及钉在底部的 Agents/设置 次要导航。折叠态：`'sidebar'` 占据者契约要求的紧凑控制轨（侧栏开关 + 新任务图标按钮）。
- `WorkspaceSwitch` 以优先级 -1 占据 `'conversation'`（session-maybe scope），遮蔽 ui-conversation 优先级 0 的占位占据者，其声明的席位仍为休眠生态保留。它按选中项切换中栏容器：收件箱分组的任务容器（空态）、Agents 占位页或 设置 页。另为 fork 组合声明两个子槽：`'inbox.workspace.banner'`（list，session-maybe）渲染在每个分组容器顶部，承载首跑与工作区级通知；`'inbox.settings.page'`（single，session-maybe）承载设置面——由 [`@daypaw/ui-settings`](../ui-settings/README.md) 占据，槽位空时回落到属主的占位页。
- `TaskDetail` 以同样的遮蔽优先级占据 `'details'`（session scope）：选中任务详情容器的空态占位（「选择任务查看详情」）。

共享选中态（`{ kind: 'group', group } | { kind: 'agents' } | { kind: 'settings' }`，默认「进行中」分组）经一个 apply 闭包自有的 `InboxSelectionController` 跨越三个 slot scope：一个 store 句柄不能挂在两个 scope 下，因此裸 snapshot 源走每个 register 调用 inject 的 `hooks` 舱位，渲染器把它绑成各组件的 `useSelection` hook。新任务对话框的开关态是组件局部 state。文案走插件自有 `inbox` locale 命名空间的类型化 `t` 位（zh 产品文案，外加机制要求的 en 词典）。样式只用 CSS Modules 消费 `--dsw-alias-*` 语义 token。

## Model Experience

### 收件箱工作台 UI

#### What the model sees

无。本包只渲染面向任务的 UI；`InboxNav`、`WorkspaceSwitch`、`TaskDetail` 不贡献任何 prompt、工具或 schema，这里没有任何东西进入模型请求。

#### Token effect

零 live-request token。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **分组计数与任务条目未接线**——计数位渲染占位零，每个分组容器显示各自的空态；run/审批数据接线归板块票。
- **新任务对话框是桩**——agent 选择内容归 agent 目录票；当前对话框只是最小可关闭的壳。
- **Agents 页是占位**——次要导航只把中栏切到静态占位容器。
- **详情栏是占位**——`TaskDetail` 只渲染空态，选中任务数据接线归板块票。
- **上游 conversation/details 占据者是遮蔽而非移除**——ui-conversation 的 roster 行保持挂载（其声明的席位服务休眠占位生态）；本包以优先级 -1 赢得两个单元格，移除上游行是后续板块决策。
