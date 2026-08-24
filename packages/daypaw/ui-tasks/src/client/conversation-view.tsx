/**
 * Task conversation view (the 'inbox.workspace.conversation' occupant): the
 * selected task's business-language flow — user messages, steering, assistant
 * text, and the terminal failure marker — with a 「进行中」 status row while
 * the task runs (a crash-revival pause reads as ordinary progress; the
 * revival itself stays invisible) and a disabled follow-up input seat (追问
 * lands with its own ticket). Everything else the chat assembles (tool
 * calls, commands, retries, metrics) is filtered by the whitelist projection.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-inbox's SlotMap merge (the conversation seat) in so
// PropsRuntime<'inbox.workspace.conversation'> resolves.
import type {} from '@daypaw/ui-inbox/client'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { projectBusinessRows } from './chat-projection.ts'
import css from './conversation-view.module.css'

/** Full component props: session-maybe runtime share + locale seat. */
export type ConversationViewProps =
  PropsRuntime<'inbox.workspace.conversation'>
  & PropsLocale<'daypaw-tasks'>

/**
 * Render the selected task's conversation.
 * @param props - composed slot props (session-maybe standard kit + locale seat).
 * @returns the conversation element tree.
 */
export function ConversationView({ useSession, t }: ConversationViewProps) {
  const chat = useSession(s => s.chat)
  const running = useSession(s => s.running) ?? false
  const rows = chat === undefined ? [] : projectBusinessRows(chat)

  return (
    <div className={css.root}>
      {running && <div className={css.statusRow}>{t('conversation.running')}</div>}
      <div className={css.flow}>
        {rows.length === 0
          ? <div className={css.empty}>{t('conversation.empty')}</div>
          : rows.map(row => row.kind === 'error'
            ? <div key={row.key} className={css.errorRow}>{t('conversation.error')}</div>
            : (
              <div key={row.key} className={row.kind === 'assistant' ? css.assistantRow : css.userRow}>
                <p className={css.rowText}>{row.text}</p>
              </div>
            ))}
      </div>
      <div className={css.followup}>
        <Input
          disabled
          aria-label={t('conversation.followup.placeholder')}
          placeholder={t('conversation.followup.placeholder')}
          value=""
          onChange={() => {}}
        />
      </div>
    </div>
  )
}
