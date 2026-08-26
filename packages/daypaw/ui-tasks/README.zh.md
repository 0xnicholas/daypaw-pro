# @daypaw/ui-tasks

[English](README.md) | 中文

daypaw 的任务面，fork 的 client UI 插件，占据 [`@daypaw/ui-inbox`](../ui-inbox/README.md) 在其导航、工作台与详情注册上声明的四个子槽：新任务对话框、收件箱分组的任务列表、选中任务的业务语言对话视图、选中任务的详情正文。它实现 [docs/spec/05-product-shell.md](../../../docs/spec/05-product-shell.md) 的任务半边——「任务」是 session 或顶层 durable run 的产品词，这个面不把 run/session/journal 词汇带上屏幕。事实走 connection wire 面（`agentPresets.list`、`sessions.create`）与 sessions 服务（list 投影、`open`、`binding`）；host 是唯一事实源。

一个 `apply` 里四次注册，全部是纯 props 组件，数据来自 apply 闭包自有的 store 与标准槽位套件：

- `NewTaskDialog` 占据 `'inbox.new-task.dialog'`（single，root；Modal 外壳留在 `InboxNav`）。Agent 选择器只列健康 preset（broken preset 永远组不出任务，所以过滤掉而非展示；预选部署默认项），加任务文本框与提交行。提交走 创建→等列表→打开→首条 prompt 序列：`sessions.open` 对未列出的 id 会 loud 失败，而 host 的 session-added 帧与 create 响应竞态，所以 store 先等 list 投影载上新行再打开。失败以通用本地化文案内联落在对话框上——host 原始错误措辞从不上屏；成功把新 session id 交给 owner 的 `openTask`，由它导航并关闭对话框。
- `TaskList` 占据 `'inbox.workspace.tasks'`（single，root）。渲染 owner 投影的行——标题、执行该任务的 Agent、「最近动态」最后活跃行（时钟由 owner 注入），行来自 durable run 时加严格的五态状态文案（一份 `run-status.ts` 出处，与详情正文共享）——点击行打开其内容（有 session 的行打开会话；无 session 的 run 行走 owner 的 `openRun`）。投影本身在 ui-inbox（`projectInboxBoard`），导航计数与此列表共享同一事实源；空分组渲染列表自己的「暂无任务」。
- `ConversationView` 占据 `'inbox.workspace.conversation'`（single，session-maybe；当前会话已是选中的任务，由 ui-inbox 的 selection 单向驱动）。渲染 `projectBusinessRows`：对已组装 Chat 快照的白名单投影——用户消息、任务中途的 steering、助手文本，以及一条本地化的终态失败标记。工具调用、命令、重试、指标与隐藏节点一律按白名单排除，而非逐 kind 排除。会话运行时显示「进行中」状态行（崩溃恢复期的停顿读起来就是普通进度），禁用的输入框标记追问席位，等它自己的票落地。审批挂起期间，`ApprovalCard` 置顶于对话流（会话的 pending 列表供数，冷启动后由 mux 重放恢复，resolved 广播将其移除）：「<任务名> 请你确认：<业务动作摘要>」标题加同意/拒绝，拒绝可附言排队回对话，配对 call 的原始命令收进详情展开——工具名永不渲染。
- `DetailBody` 占据 `'inbox.detail.body'`（single，session scope；owner props 以工作台选中态为键，绝不以 session 席位为键——席位是严格 session 作用域，选中 workflow run 时可能带着陈旧会话，因此绑定 session 的区块只在席位 sessionId 与选中项的会话身份匹配时才读它）。四个区块：进度（workflow run 的 journal step 时间线；agent run 或 session 任务的业务语言尾部——最后三行加运行时的「进行中」行）、子任务（run 的血缘子 run）、产出物（已结算 run 解析后的 `output_json`）、审批历史（会话的 `approvalHistory` 投影，来自 [`@daypaw/approval-history`](../approval-history/README.md)）。

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

- **追问是禁用席位**——追问输入框渲染「追问即将上线」，等追问票落地。
- **对话的失败标记没有内联重试**——终态 turn 错误渲染「出错了」，该处无恢复入口；失败 run 的重试在详情栏头部（ui-inbox）。
- **选中 workflow run 时绑定 session 的区块为空**——workflow run 没有 session，陈旧席位守卫下其「进度」回落到 journal step 时间线，「审批历史」渲染空态。
