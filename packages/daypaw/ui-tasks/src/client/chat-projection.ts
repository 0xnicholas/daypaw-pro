/**
 * Business-language projection of the assembled Chat snapshot: the
 * conversation view renders only what a task owner reads — their own
 * messages, mid-task steering, the assistant's text, and a terminal failure
 * marker. Tool calls, commands, retries, metrics, and every other node kind
 * stay off this surface by whitelist, not by per-kind exclusion.
 */
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** One renderable business row. */
export interface BusinessRow {
  /** Stable chat node key (the React key). */
  key: string
  /** Row role: who speaks, or the failure marker. */
  kind: 'user' | 'steering' | 'assistant' | 'error'
  /** The row's text (empty for the failure marker — the copy is localized). */
  text: string
}

/** Join the text blocks of a user/steering message's content. */
function contentText(content: ChatNode<'user'>['data']['content']): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/** Join an assistant step's text blocks (reasoning and tool heads stay off). */
function assistantText(blocks: ChatNode<'assistant-step'>['data']['blocks']): string {
  return blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n')
}

/**
 * Project the chat snapshot into business rows, in flow order. Hidden nodes
 * (superseded streams, retry-shadowed failures) and non-whitelisted kinds
 * project nothing.
 * @param chat - the assembled Chat snapshot.
 * @returns the rows to render.
 */
export function projectBusinessRows(chat: ChatSnapshot): BusinessRow[] {
  const rows: BusinessRow[] = []
  for (const key of chat.order) {
    const node = chat.nodes.get(key)
    if (node === undefined || node.visibility !== 'visible') continue
    switch (node.kind) {
      case 'user': {
        const text = contentText((node as ChatNode<'user'>).data.content)
        if (text !== '') rows.push({ key, kind: 'user', text })
        break
      }
      case 'steering': {
        const text = contentText((node as ChatNode<'steering'>).data.content)
        if (text !== '') rows.push({ key, kind: 'steering', text })
        break
      }
      case 'assistant-step': {
        const text = assistantText((node as ChatNode<'assistant-step'>).data.blocks)
        if (text !== '') rows.push({ key, kind: 'assistant', text })
        break
      }
      case 'turn-error':
        rows.push({ key, kind: 'error', text: '' })
        break
      default:
        break
    }
  }
  return rows
}
