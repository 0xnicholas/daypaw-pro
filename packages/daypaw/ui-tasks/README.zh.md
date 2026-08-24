# @daypaw/ui-tasks

[English](README.md) | 中文

daypaw 的任务面，fork 的 client UI 插件，占据 [`@daypaw/ui-inbox`](../ui-inbox/README.md) 在其导航与工作台注册上声明的三个子槽：新任务对话框、收件箱分组的任务列表、选中任务的业务语言对话视图。它实现 [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) 的任务半边——「任务」是 session 的产品词，这个面不把 run/session/journal 词汇带上屏幕。事实走 connection wire 面（`agentPresets.list`、`sessions.create`）与 sessions 服务（list 投影、`open`、`binding`）；host 是唯一事实源。

一个 `apply` 里三次注册，全部是纯 props 组件，数据来自 apply 闭包自有的 store 与标准槽位套件：

- `NewTaskDialog` 占据 `'inbox.new-task.dialog'`（single，root；Modal 外壳留在 `InboxNav`）。Agent 选择器只列健康 preset（broken preset 永远组不出任务，所以过滤掉而非展示；预选部署默认项），加任务文本框与提交行。提交走 创建→等列表→打开→首条 prompt 序列：`sessions.open` 对未列出的 id 会 loud 失败，而 host 的 session-added 帧与 create 响应竞态，所以 store 先等 list 投影载上新行再打开。失败以通用本地化文案内联落在对话框上——host 原始错误措辞从不上屏；成功把新 session id 交给 owner 的 `openTask`，由它导航并关闭对话框。
- `TaskList` 占据 `'inbox.workspace.tasks'`（single，root）。渲染 owner 投影的行——标题、执行该任务的 Agent 与「最近动态」最后活跃行（时钟由 owner 注入）——点击行打开其对话。投影本身在 ui-inbox（`projectInboxBoard`），导航计数与此列表共享同一事实源；空分组渲染列表自己的「暂无任务」。
- `ConversationView` 占据 `'inbox.workspace.conversation'`（single，session-maybe；当前会话已是选中的任务，由 ui-inbox 的 selection 单向驱动）。渲染 `projectBusinessRows`：对已组装 Chat 快照的白名单投影——用户消息、任务中途的 steering、助手文本，以及一条本地化的终态失败标记。工具调用、命令、重试、指标与隐藏节点一律按白名单排除，而非逐 kind 排除。会话运行时显示「进行中」状态行（崩溃恢复期的停顿读起来就是普通进度），禁用的输入框标记追问席位，等它自己的票落地。

文案走插件自有 `daypaw-tasks` locale 命名空间（zh 产品文案为 key 集权威，外加机制要求的 en 词典；locales 规格保证两种语言都不出现 run/session/journal 措辞）。样式只用 CSS Modules 消费 `--dsw-alias-*` 语义 token。

## Model Experience

### 任务对话框、列表与对话 UI

#### What the model sees

这个面上没有模型可见的界面零件。对话框提交的任务文本确实会作为会话的首条用户消息到达模型——走普通的 `session.prompt` wire 路径，与任何 prompt 一样落日志；组件本身不贡献任何 prompt、工具或 schema。

#### Token effect

除用户自己的任务文本外，零 live-request token。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **任务是 sessions 投影，不是任务引擎**——分组由 sessions 列表的 `blank`/`running` 位推导（pending 恒为空）；任务源票会把它换成引擎的查询面。
- **追问是禁用席位**——追问输入框渲染「追问即将上线」，等追问票落地。
- **失败标记没有重试**——终态 turn 错误渲染「出错了」，无恢复入口。
- **审批不进这个面**——业务语言流没有审批卡槽位；那属于审批票。
