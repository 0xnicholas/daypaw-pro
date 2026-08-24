/** `inbox` namespace dictionaries: the daypaw shell IA skeleton copy (nav, workspace placeholders, detail placeholder). */

/** Simplified Chinese dictionary (the key-set source of truth; product copy). */
export const zh = {
  'nav.new-task': '新任务',
  'nav.new-task.label': '新建任务',
  'nav.toggle.open': '打开侧边栏',
  'nav.toggle.collapse': '收起侧边栏',
  'nav.group.pending': '等待你确认',
  'nav.group.running': '进行中',
  'nav.group.done': '已完成',
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
  'detail.title': '任务详情',
  'detail.empty': '选择任务查看详情',
} satisfies Record<string, string>

/** The inbox namespace key union. */
export type InboxKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'nav.new-task': 'New Task',
  'nav.new-task.label': 'New task',
  'nav.toggle.open': 'Open sidebar',
  'nav.toggle.collapse': 'Collapse sidebar',
  'nav.group.pending': 'Awaiting your confirmation',
  'nav.group.running': 'In progress',
  'nav.group.done': 'Completed',
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
  'detail.title': 'Task details',
  'detail.empty': 'Select a task to see its details',
} satisfies Record<InboxKey, string>
