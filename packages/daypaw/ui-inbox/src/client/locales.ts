/**
 * `inbox` namespace dictionaries: the daypaw shell IA skeleton copy (nav,
 * workspace placeholders, detail placeholder); run-status copy lives in
 * `@daypaw/durable-client`.
 */

/** Simplified Chinese dictionary (the key-set source of truth; product copy). */
export const zh = {
  'nav.new-task': '新任务',
  'nav.new-task.label': '新建任务',
  'nav.chat': '直接和助手聊',
  'nav.toggle.open': '打开侧边栏',
  'nav.toggle.collapse': '收起侧边栏',
  'nav.group.pending': '等待你确认',
  'nav.group.running': '进行中',
  'nav.group.done': '已完成',
  'nav.brand': 'daypaw',
  'nav.agents': 'Agents',
  'nav.settings': '设置',
  'dialog.new-task.title': '新任务',
  'dialog.new-task.stub': '这里将让你选择执行任务的 Agent，敬请期待。',
  'dialog.close': '关闭',
  'workspace.empty.pending': '暂无等待确认的任务',
  'workspace.empty.running': '暂无进行中的任务',
  'workspace.empty.done': '暂无已完成的任务',
  'workspace.agents.placeholder': 'Agent 目录即将上线',
  'workspace.settings.placeholder': '设置页即将上线',
  'workspace.conversation.placeholder': '对话即将上线',
  'workspace.run.placeholder': '该任务没有对话，进度与产出见右栏详情',
  'connection.disconnected': '网络连接已断开',
  'connection.retry': '立即重连',
  'connection.connecting': '正在重连',
  'connection.recovered': '连接已恢复',
  'connection.reconnect-action': '网络连接已断开，点击立即重连',
  'connection.restart-action': '正在重连，点击重新开始连接',
  'detail.title': '任务详情',
  'detail.empty': '选择任务查看详情',
  'detail.retry': '重试',
} satisfies Record<string, string>

/** The inbox namespace key union. */
export type InboxKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'nav.new-task': 'New Task',
  'nav.new-task.label': 'New task',
  'nav.chat': 'Chat with the assistant',
  'nav.toggle.open': 'Open sidebar',
  'nav.toggle.collapse': 'Collapse sidebar',
  'nav.group.pending': 'Awaiting your confirmation',
  'nav.group.running': 'In progress',
  'nav.group.done': 'Completed',
  'nav.brand': 'daypaw',
  'nav.agents': 'Agents',
  'nav.settings': 'Settings',
  'dialog.new-task.title': 'New Task',
  'dialog.new-task.stub': 'You will pick the agent that runs the task here. Coming soon.',
  'dialog.close': 'Close',
  'workspace.empty.pending': 'No tasks awaiting confirmation',
  'workspace.empty.running': 'No tasks in progress',
  'workspace.empty.done': 'No completed tasks',
  'workspace.agents.placeholder': 'The agent catalog is coming soon',
  'workspace.settings.placeholder': 'The settings page is coming soon',
  'workspace.conversation.placeholder': 'The conversation view is coming soon',
  'workspace.run.placeholder': 'This task has no conversation — see its progress and outputs in the details column',
  'connection.disconnected': 'Connection lost',
  'connection.retry': 'Reconnect now',
  'connection.connecting': 'Reconnecting',
  'connection.recovered': 'Connection restored',
  'connection.reconnect-action': 'Connection lost, reconnect now',
  'connection.restart-action': 'Reconnecting, restart now',
  'detail.title': 'Task details',
  'detail.empty': 'Select a task to see its details',
  'detail.retry': 'Retry',
} satisfies Record<InboxKey, string>
