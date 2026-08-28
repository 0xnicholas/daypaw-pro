/**
 * Business-language projection of the assembled Chat snapshot: the
 * conversation view renders only what a task owner reads — their own
 * messages, mid-task steering, the assistant's text, and a terminal failure
 * marker. Tool calls, commands, retries, metrics, and every other node kind
 * stay off this surface by whitelist, not by per-kind exclusion. The rows
 * read the Chat snapshot's legacy conversation slice — the documented
 * compatibility projection over the same assembled nodes the full Chat view
 * renders.
 */
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { AssistantBlock, ConversationNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** One renderable business row. */
export interface BusinessRow {
  /** Stable conversation node seq (the React key). */
  key: string
  /** Row role: who speaks, or the failure marker. */
  kind: 'user' | 'steering' | 'assistant' | 'error'
  /** The row's text (empty for the failure marker — the copy is localized). */
  text: string
}

/** Join the text blocks of a user/steering message's content. */
function contentText(content: readonly ContentBlock[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/** Join an assistant message's text blocks (reasoning and tool heads stay off). */
function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n')
}

/** Project one whitelisted node, or nothing for every other kind. */
function rowOf(node: ConversationNode): BusinessRow | undefined {
  switch (node.kind) {
    case 'user': {
      const text = contentText(node.content)
      return text === '' ? undefined : { key: `n${String(node.seq)}`, kind: 'user', text }
    }
    case 'steering': {
      const text = contentText(node.content)
      return text === '' ? undefined : { key: `n${String(node.seq)}`, kind: 'steering', text }
    }
    case 'assistant': {
      const text = assistantText(node.blocks)
      return text === '' ? undefined : { key: `n${String(node.seq)}`, kind: 'assistant', text }
    }
    case 'turn-error':
      return { key: `n${String(node.seq)}`, kind: 'error', text: '' }
    default:
      return undefined
  }
}

/**
 * Project the chat snapshot into business rows, in flow order. Non-whitelisted
 * kinds project nothing.
 * @param chat - the assembled Chat snapshot.
 * @returns the rows to render.
 */
export function projectBusinessRows(chat: ChatSnapshot): BusinessRow[] {
  const rows: BusinessRow[] = []
  for (const node of chat.legacy.nodes) {
    const row = rowOf(node)
    if (row !== undefined) rows.push(row)
  }
  return rows
}
