/**
 * `daypaw-agents` namespace dictionaries: the agent catalog page copy (grid,
 * detail, and the load lifecycle states). Product vocabulary rule: no
 * run/session/journal wording on this surface — an agent is an agent.
 */

/** Simplified Chinese dictionary (the key-set source of truth; product copy). */
export const zh = {
  'page.title': 'Agents',
  'page.subtitle': '选择一个 Agent 查看详情',
  'page.loading': '正在加载…',
  'page.load-failed': 'Agent 目录加载失败',
  'page.empty': '暂无可用 Agent',
  'detail.back': '返回目录',
  'detail.identity': '标识',
} satisfies Record<string, string>

/** The daypaw-agents namespace key union. */
export type DaypawAgentsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'page.title': 'Agents',
  'page.subtitle': 'Pick an agent to see its details',
  'page.loading': 'Loading…',
  'page.load-failed': 'Failed to load the agent catalog',
  'page.empty': 'No agents yet',
  'detail.back': 'Back to catalog',
  'detail.identity': 'ID',
} satisfies Record<DaypawAgentsKey, string>
