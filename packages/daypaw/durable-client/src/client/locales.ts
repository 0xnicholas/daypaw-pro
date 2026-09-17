/** `durable` namespace dictionaries: the five run-status words every browser surface shares. */

/** Simplified Chinese dictionary (the key-set source of truth; product copy). */
export const zh = {
  'status.running': '进行中',
  'status.waiting': '等待确认',
  'status.done': '已完成',
  'status.failed': '出错了',
  'status.cancelled': '已取消',
} satisfies Record<string, string>

/** The durable namespace key union. */
export type DurableKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'status.running': 'In progress',
  'status.waiting': 'Awaiting confirmation',
  'status.done': 'Completed',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',
} satisfies Record<DurableKey, string>
