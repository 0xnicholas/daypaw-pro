// @vitest-environment jsdom
/** ConversationView: the business-language whitelist projection, the running status row, the error marker, the disabled follow-up seat. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ChatSnapshot, ConversationSnapshot, SessionListState, SteeringMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { EMPTY_CONVERSATION_VIEWS, PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import type { RpcId, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ChatNode, ChatNodeKind } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConversationView, type ConversationViewProps } from '../src/client/conversation-view.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ConversationViewProps['t'] = (key, params) => {
  let text = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}
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
function sessionWith(chat: ChatSnapshot, running: boolean, pending: ConversationSnapshot['pending'] = [], runningCalls: ConversationSnapshot['runningCalls'] = []): ConversationSnapshot {
  return {
    sessionId: 's1' as SessionId, views: EMPTY_CONVERSATION_VIEWS, chat, nodes: [],
    turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls,
    pending, queue: [], running, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

function mountView(
  session: ConversationSnapshot | undefined,
  sendNote: ConversationViewProps['sendNote'] = () => Promise.resolve(),
  titles: Record<string, string> = {},
) {
  const useSession: ConversationViewProps['useSession'] = sel => session === undefined ? undefined : sel(session)
  const byId: SessionListState['byId'] = {}
  for (const [id, title] of Object.entries(titles)) {
    byId[id as SessionId] = { id: id as SessionId, displayTitle: title, running: false, blank: false, updatedAt: 1 }
  }
  const useSessions: ConversationViewProps['useSessions'] = sel => sel({
    ids: Object.keys(byId) as SessionId[], byId, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const view = render(
    <ConversationView
      useSession={useSession} sessionId={session?.sessionId} useProjection={neverHook}
      useInput={neverHook} inputActions={undefined}
      useSessions={useSessions} useWorkspaces={neverHook} sendNote={sendNote} t={t}
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

  it('pins the approval card atop the flow with the task title and the paired raw command', () => {
    const wait = new PendingWait(
      'approval',
      'rpc-1' as RpcId,
      's1' as SessionId,
      {
        approvalId: 'ap-1' as never,
        toolName: 'dangerous_tool',
        callId: 'call-1' as never,
        reason: '清理临时目录',
      },
      () => Promise.resolve({ accepted: true }),
    )
    mountView(
      sessionWith(
        chatWith([userNode('写一首诗')]),
        true,
        [wait],
        [{ callId: 'call-1', name: 'bash', argsRaw: '{"command":"rm -rf /tmp/build-cache"}', turn: 1, step: 0, time: 1, callView: null, subCalls: [] }],
      ),
      undefined,
      { s1: '周报任务' },
    )
    expect(screen.getByText('周报任务 请你确认：清理临时目录')).toBeTruthy()
    expect(screen.getByText('rm -rf /tmp/build-cache')).toBeTruthy()
    // The card hides the tool name; the flow still renders beneath it.
    expect(screen.queryByText(/dangerous_tool/)).toBeNull()
    expect(screen.getByText('写一首诗')).toBeTruthy()
  })

  it('renders no card for question-kind waits or an empty pending list', () => {
    const question = new PendingWait(
      'question',
      'rpc-2' as RpcId,
      's1' as SessionId,
      { questions: [] },
      () => Promise.resolve({ accepted: true }),
    )
    mountView(sessionWith(chatWith([userNode('写一首诗')]), true, [question]))
    expect(screen.queryByText(/请你确认/)).toBeNull()
    cleanup()
    mountView(sessionWith(chatWith([userNode('写一首诗')]), true))
    expect(screen.queryByText(/请你确认/)).toBeNull()
  })

  it('renders the card without the details expander when the ask carries no callId, and falls back to an empty title', () => {
    const wait = new PendingWait(
      'approval',
      'rpc-3' as RpcId,
      's1' as SessionId,
      { approvalId: 'ap-2' as never, toolName: 'dangerous_tool' },
      () => Promise.resolve({ accepted: true }),
    )
    // s1 is absent from the list stub: the headline joins on the empty title.
    mountView(sessionWith(chatWith([userNode('写一首诗')]), true, [wait]))
    expect(screen.getByText('请你确认：执行一项敏感操作')).toBeTruthy()
    expect(screen.queryByText('查看原始内容')).toBeNull()
  })

  it('wires the reject note through the injected sendNote with the seat session', async () => {
    const sendNote = vi.fn(() => Promise.resolve())
    const wait = new PendingWait(
      'approval',
      'rpc-4' as RpcId,
      's1' as SessionId,
      { approvalId: 'ap-3' as never, toolName: 'dangerous_tool', reason: '清理临时目录' },
      () => Promise.resolve({ accepted: true }),
    )
    mountView(sessionWith(chatWith([userNode('写一首诗')]), true, [wait]), sendNote)
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    fireEvent.change(screen.getByRole('textbox', { name: '给 Agent 捎句话（可选）…' }), { target: { value: '先别删' } })
    fireEvent.click(screen.getByRole('button', { name: '确认拒绝' }))
    await waitFor(() => { expect(sendNote).toHaveBeenCalledWith('s1', '先别删') })
  })

  it('renders no card without a session even when the seat is warm', () => {
    mountView(undefined)
    expect(screen.queryByText(/请你确认/)).toBeNull()
  })
})
