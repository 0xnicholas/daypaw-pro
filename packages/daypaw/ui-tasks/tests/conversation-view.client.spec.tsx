// @vitest-environment jsdom
/** ConversationView: the business-language whitelist projection, the running status row, the error marker, the disabled follow-up seat. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  ChatSnapshot, ConversationSnapshot, SteeringMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { EMPTY_CONVERSATION_VIEWS } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ChatNode, ChatNodeKind } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConversationView, type ConversationViewProps } from '../src/client/conversation-view.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ConversationViewProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('the conversation view must not read this hook') }) as never

let seq = 0

/** Mint one visible Chat node with the given kind's payload. */
function node<Kind extends ChatNodeKind>(kind: Kind, data: ChatNode<Kind>['data'], hidden = false): ChatNode<Kind> {
  seq += 1
  return {
    key: `n${seq}`, kind, id: `id${seq}`, target: 'chat', anchorSeq: seq,
    location: { kind: 'unresolved' }, visibility: hidden ? 'hidden' : 'visible', data,
  }
}

/** Assemble a Chat snapshot over the given nodes (fixture-shaped readers). */
function chatWith(nodes: readonly ChatNode[]): ChatSnapshot {
  const byKey = new Map(nodes.map(n => [n.key, n]))
  return {
    order: nodes.map(n => n.key),
    nodes: { get: key => byKey.get(key), values: () => nodes },
    locations: { getTurn: () => [], getStep: () => [] },
    timeline: { turnOrder: [], turns: new Map() },
    legacy: { nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [] },
  }
}

/** A ConversationSnapshot carrying only what the view reads. */
function sessionWith(chat: ChatSnapshot, running: boolean): ConversationSnapshot {
  return {
    sessionId: 's1' as SessionId, views: EMPTY_CONVERSATION_VIEWS, chat, nodes: [],
    turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

function mountView(session: ConversationSnapshot | undefined) {
  const useSession: ConversationViewProps['useSession'] = sel => session === undefined ? undefined : sel(session)
  const view = render(
    <ConversationView
      useSession={useSession} sessionId={session?.sessionId} useProjection={neverHook}
      useInput={neverHook} inputActions={undefined}
      useSessions={neverHook} useWorkspaces={neverHook} t={t}
    />,
  )
  return view
}

const userNode = (text: string, hidden = false) => node('user', {
  kind: 'user', seq, time: seq * 1000, source: null,
  content: [{ type: 'text', text }, { type: 'reasoning', text: '内部依据' }],
}, hidden)

const steeringNode = (text: string) => node('steering', {
  kind: 'steering', messageId: 'm1' as SteeringMessageNode['messageId'], seq, time: seq * 1000, source: null,
  content: [{ type: 'text', text }],
})

const assistantNode = (text: string, hidden = false) => node('assistant-step', {
  status: 'settled', turn: 1, step: 1, time: seq * 1000,
  blocks: [{ kind: 'reasoning', text: '思考过程' }, { kind: 'text', text }],
}, hidden)

describe('ConversationView', () => {
  it('renders the business rows in flow order and filters everything else', () => {
    mountView(sessionWith(chatWith([
      userNode('写一首诗'),
      assistantNode('好的，这是你的诗'),
      steeringNode('再短一点'),
      node('turn-tail', { turn: 1, seq, time: 1, closing: null, branchUnavailable: false }),
      userNode('被替换的草稿', true),
    ]), false))
    const flow = screen.getByText('写一首诗').closest('div')!.parentElement!
    expect(flow.textContent).toBe('写一首诗好的，这是你的诗再短一点')
    // Whitelist, not per-kind exclusion: no turn-tail, hidden, or reasoning text leaks.
    expect(flow.textContent).not.toContain('被替换的草稿')
    expect(flow.textContent).not.toContain('思考过程')
    expect(flow.textContent).not.toContain('内部依据')
    expect(screen.queryByText('进行中')).toBeNull()
  })

  it('shows the running status row while the task runs', () => {
    mountView(sessionWith(chatWith([userNode('写一首诗')]), true))
    expect(screen.getByText('进行中')).toBeTruthy()
  })

  it('renders the terminal failure marker as localized copy, not the raw error', () => {
    mountView(sessionWith(chatWith([
      userNode('写一首诗'),
      node('turn-error', { kind: 'turn-error', seq, time: 1, turn: 1, step: 1, message: 'provider exploded' }),
    ]), false))
    expect(screen.getByText('出错了')).toBeTruthy()
    expect(screen.queryByText(/provider exploded/)).toBeNull()
  })

  it('renders the empty state without a session and keeps the follow-up seat disabled', () => {
    mountView(undefined)
    expect(screen.getByText('暂无对话内容')).toBeTruthy()
    const followup = screen.getByRole('textbox', { name: '追问即将上线' })
    expect(followup).toHaveProperty('disabled', true)
    // The seat is inert: the no-op change handler stays a no-op.
    fireEvent.change(followup, { target: { value: '现在还不能追问' } })
    expect(screen.getByText('暂无对话内容')).toBeTruthy()
  })

  it('skips whitelisted nodes whose content carries no text', () => {
    mountView(sessionWith(chatWith([
      userNode('写一首诗'),
      node('user', { kind: 'user', seq, time: 1, source: null, content: [{ type: 'reasoning', text: '内部依据' }] }),
      node('steering', { kind: 'steering', messageId: 'm2' as SteeringMessageNode['messageId'], seq, time: 1, source: null, content: [] }),
      node('assistant-step', { status: 'settled', turn: 1, step: 1, time: 1, blocks: [{ kind: 'reasoning', text: '思考过程' }] }),
    ]), false))
    const flow = screen.getByText('写一首诗').closest('div')!.parentElement!
    expect(flow.textContent).toBe('写一首诗')
  })

  it('matches the mixed-flow snapshot', () => {
    const { container } = mountView(sessionWith(chatWith([
      userNode('写一首诗'),
      assistantNode('床前明月光'),
      node('turn-error', { kind: 'turn-error', seq, time: 1, turn: 1, step: 1, message: 'x' }),
    ]), true))
    expect(container).toMatchSnapshot()
  })
})
