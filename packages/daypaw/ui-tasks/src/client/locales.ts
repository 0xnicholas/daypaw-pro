/**
 * `daypaw-tasks` namespace dictionaries: the new-task dialog, the group task
 * list, and the business-language conversation view copy. Product vocabulary
 * rule: no run/session/journal wording on this surface — a task is a task.
 */

/** Simplified Chinese dictionary (the key-set source of truth; product copy). */
export const zh = {
  'dialog.agent.label': '执行 Agent',
  'dialog.agent.empty': '暂无可用 Agent',
  'dialog.text.label': '任务内容',
  'dialog.text.placeholder': '描述要完成的任务…',
  'dialog.submit': '开始任务',
  'dialog.submitting': '正在创建…',
  'dialog.load-failed': 'Agent 列表加载失败',
  'dialog.create-failed': '创建任务失败',
  'list.empty': '暂无任务',
  'list.recent': '最近动态 {time}',
  'list.time.now': '刚刚',
  'list.time.minutes': '{n} 分钟前',
  'list.time.hours': '{n} 小时前',
  'list.time.days': '{n} 天前',
  'list.time.months': '{n} 个月前',
  'list.time.years': '{n} 年前',
  'conversation.running': '进行中',
  'conversation.error': '出错了',
  'conversation.empty': '暂无对话内容',
  'conversation.followup.placeholder': '追问即将上线',
} satisfies Record<string, string>

/** The daypaw-tasks namespace key union. */
export type DaypawTasksKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'dialog.agent.label': 'Agent',
  'dialog.agent.empty': 'No agents available',
  'dialog.text.label': 'Task',
  'dialog.text.placeholder': 'Describe the task…',
  'dialog.submit': 'Start task',
  'dialog.submitting': 'Creating…',
  'dialog.load-failed': 'Failed to load the agent list',
  'dialog.create-failed': 'Failed to create the task',
  'list.empty': 'No tasks yet',
  'list.recent': 'Last activity {time}',
  'list.time.now': 'just now',
  'list.time.minutes': '{n} min ago',
  'list.time.hours': '{n} h ago',
  'list.time.days': '{n} d ago',
  'list.time.months': '{n} mo ago',
  'list.time.years': '{n} y ago',
  'conversation.running': 'In progress',
  'conversation.error': 'Something went wrong',
  'conversation.empty': 'No messages yet',
  'conversation.followup.placeholder': 'Follow-ups are coming soon',
} satisfies Record<DaypawTasksKey, string>
