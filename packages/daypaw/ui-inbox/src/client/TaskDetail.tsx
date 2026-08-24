/**
 * Task detail column (the 'details' occupant, priority -1 shadowing
 * ui-conversation's placeholder): the right column's empty-state container
 * until the board tickets wire selected-task detail data.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'details' entry) in so
// PropsRuntime<'details'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import css from './TaskDetail.module.css'

/** Full component props: runtime share + locale seat (no injected face yet). */
export type TaskDetailProps =
  PropsRuntime<'details'>
  & PropsLocale<'inbox'>

/**
 * Render the detail column placeholder.
 * @param props - composed slot props (runtime share + locale seat).
 * @returns the detail element tree.
 */
export function TaskDetail({ t }: TaskDetailProps) {
  return (
    <div className={css.root}>
      <header className={css.header}><h2 className={css.title}>{t('detail.title')}</h2></header>
      <div className={css.empty}>{t('detail.empty')}</div>
    </div>
  )
}
