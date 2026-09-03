// @vitest-environment jsdom
/**
 * ConversationView: the business-language whitelist projection, the running status
 * row, the error marker, the approval card, the live follow-up steer seat.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ChatSnapshot, ConversationNode, RunningToolCall } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'
import { ConversationView, type ConversationViewProps } from '../src/client/conversation-view.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ConversationViewProps['t'] = (key, params) => {
  let text = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}
const neverHook = (() => { throw new Error('the conversation view must not read this hook') }) as never

/** Running counter handing out seqs (the projection's React keys derive from them). */
let seq = 0

/** Assemble a Chat snapshot over the given legacy conversation nodes and running calls. */
function chatWith(nodes: readonly ConversationNode[], runningCalls: readonly RunningToolCall[] = []): ChatSnapshot {
  return {
    order: [], nodes: { get: () => undefined, values: () => [] },
    locations: { getTurn: () => [], getStep: () => [] },
    navigation: { items: () => [] },
    timeline: { turnOrder: [], turns: new Map() },
    legacy: { nodes, turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls },
  }
}

const userNode = (text: string, withReasoning = true): ConversationNode => {
  seq += 1
  return { kind: 'user', seq, time: seq * 1000, source: null,
    content: [{ type: 'text', text }, ...withReasoning ? [{ type: 'reasoning' as const, text: '内部依据' }] : []] }
}

const steeringNode = (text: string): ConversationNode => {
  seq += 1
  return { kind: 'steering', messageId: `m${seq}` as never, seq, time: seq * 1000, source: null,
    content: [{ type: 'text', text }] }
}

const assistantNode = (text: string): ConversationNode => {
  seq += 1
  return { kind: 'assistant', seq, time: seq * 1000, turn: 1, step: 1,
    blocks: [{ kind: 'reasoning', text: '思考过程' }, { kind: 'text', text }] }
}

const errorNode = (): ConversationNode => {
  seq += 1
  return { kind: 'turn-error', seq, time: seq * 1000, turn: 1, step: 1, message: 'provider exploded' }
}

/** One running tool call record (the approval pairing source). */
const runningCall = (callId: string, argsRaw: string): RunningToolCall =>
  ({ callId, name: 'bash', argsRaw, turn: 1, step: 0, time: 1, subCalls: [] })

function mountView(
  options: {
    chat?: ChatSnapshot
    running?: boolean
    pending?: PendingApproval
    runningCalls?: readonly RunningToolCall[]
    titles?: Record<string, string>
    sendNote?: ConversationViewProps['sendNote']
    runStatus?: ConversationViewProps['runStatus']
    steer?: ConversationViewProps['steer']
  } = {},
) {
  const session = {
    sessionId: 's1' as SessionId, queue: [], pendingSubmissions: [], running: options.running ?? false,
    subagent: null, removed: false, openState: 'open' as const, openError: null, hasMore: false,
    loadingOlder: false, promptError: null, blank: false, lastAgentError: null,
    promptAttempted: false, awaitingFirstTurn: false,
  }
  const chat = options.chat ?? chatWith([])
  const useSession: ConversationViewProps['useSession'] = sel => sel(session)
  const useChat: ConversationViewProps['useChat'] = sel => sel(chat)
  const useSessionPendingInteraction: ConversationViewProps['useSessionPendingInteraction'] =
    sel => sel(options.pending === undefined ? new Map() : new Map([[session.sessionId, options.pending]]))
  const byId: SessionListState['byId'] = {}
  for (const [id, title] of Object.entries(options.titles ?? {})) {
    byId[id as SessionId] = { id: id as SessionId, displayTitle: title, running: false, blank: false, updatedAt: 1 }
  }
  const useSessions: ConversationViewProps['useSessions'] = sel => sel({
    ids: Object.keys(byId) as SessionId[], byId, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const view = render(
    <ConversationView
      useSession={useSession} sessionId={session.sessionId} useProjection={neverHook}
      useConversation={neverHook} useTrajectory={neverHook}
      useInput={neverHook} inputActions={undefined as never}
      useChat={useChat}
      useSessionPendingInteraction={useSessionPendingInteraction}
      useSessions={useSessions} useWorkspaces={neverHook}
      sendNote={options.sendNote ?? (() => Promise.resolve())}
      steer={options.steer ?? (() => Promise.resolve())}
      runStatus={options.runStatus} t={t}
    />,
  )
  return view
}

/** Mint one pending approval (the real carrier; answer is spied per case). */
/** Structural pending approval: the card reads key/reason/callId and calls answer. */
function approvalWait(options: { callId?: string; reason?: string } = {}): PendingApproval {
  let serial = 0
  serial += 1
  return {
    kind: 'approval',
    key: `approval:${String(serial)}`,
    sessionId: 's1' as SessionId,
    toolName: 'dangerous_tool',
    callId: options.callId as never,
    reason: options.reason,
    result: Promise.resolve('allowed-once' as const),
    answer: () => Promise.resolve(),
  } as unknown as PendingApproval
}

describe('ConversationView', () => {
  it('renders the business rows in flow order and filters everything else', () => {
    mountView({ chat: chatWith([
      userNode('写一首诗'),
      assistantNode('好的，这是你的诗'),
      steeringNode('再短一点'),
      errorNode(),
      // Non-whitelisted kinds stay off the surface by kind, not by content.
      { kind: 'command', seq: ++seq, time: 1, outcome: null } as unknown as ConversationNode,
    ]) })
    const flow = screen.getByText('写一首诗').closest('div')!.parentElement!
    expect(flow.textContent).toBe('写一首诗好的，这是你的诗再短一点出错了')
    // Whitelist, not per-kind exclusion: no command/tool/error text leaks.
    expect(flow.textContent).not.toContain('思考过程')
    expect(flow.textContent).not.toContain('内部依据')
    expect(flow.textContent).not.toContain('provider exploded')
    expect(screen.queryByText('进行中')).toBeNull()
  })

  it('shows the running status row while the task runs', () => {
    mountView({ chat: chatWith([userNode('写一首诗')]), running: true })
    expect(screen.getByText('进行中')).toBeTruthy()
  })

  it('renders the terminal failure marker as localized copy, not the raw error', () => {
    mountView({ chat: chatWith([userNode('写一首诗'), errorNode()]) })
    expect(screen.getByText('出错了')).toBeTruthy()
    expect(screen.queryByText(/provider exploded/)).toBeNull()
  })

  it('renders the empty state and keeps the follow-up seat closed without a live run', () => {
    mountView({})
    expect(screen.getByText('暂无对话内容')).toBeTruthy()
    const followup = screen.getByRole('textbox', { name: '追问…' })
    expect(followup).toHaveProperty('disabled', true)
    expect(followup).toHaveProperty('placeholder', '任务已结束')
  })

  it('steers the run from the follow-up seat while the ledger row is unfinished (issue #94)', async () => {
    const steer = vi.fn(() => Promise.resolve())
    const runStatus = 'running' as const
    mountView({ chat: chatWith([userNode('写一首诗')]), runStatus, steer })
    const followup = screen.getByRole('textbox', { name: '追问…' })
    expect(followup).toHaveProperty('disabled', false)
    fireEvent.change(followup, { target: { value: '再短一点' } })
    fireEvent.submit(followup.closest('form')!)
    await waitFor(() => { expect(steer).toHaveBeenCalledWith('s1' as SessionId, '再短一点') })
    // A landed steer clears the draft.
    await waitFor(() => { expect(followup).toHaveProperty('value', '') })
    expect(screen.queryByText('追问失败，请重试')).toBeNull()
  })

  it('keeps the draft and shows the inline failure when the steer wire call fails', async () => {
    const steer = vi.fn(() => Promise.reject(new Error('wire down')))
    mountView({ chat: chatWith([userNode('写一首诗')]), runStatus: 'running', steer })
    const followup = screen.getByRole('textbox', { name: '追问…' })
    fireEvent.change(followup, { target: { value: '再短一点' } })
    fireEvent.submit(followup.closest('form')!)
    await waitFor(() => { expect(screen.getByText('追问失败，请重试')).toBeTruthy() })
    expect(followup).toHaveProperty('value', '再短一点')
  })

  it('keeps the seat closed while a steer is in flight', () => {
    const steer = vi.fn(() => new Promise<void>(() => {}))
    mountView({ chat: chatWith([userNode('写一首诗')]), runStatus: 'running', steer })
    const followup = screen.getByRole('textbox', { name: '追问…' })
    fireEvent.change(followup, { target: { value: '再短一点' } })
    fireEvent.submit(followup.closest('form')!)
    expect(followup).toHaveProperty('disabled', true)
  })

  it('skips whitelisted nodes whose content carries no text', () => {
    mountView({ chat: chatWith([
      userNode('写一首诗'),
      { kind: 'user', seq: ++seq, time: 1, source: null, content: [{ type: 'reasoning', text: '内部依据' }] },
      { kind: 'steering', messageId: 'm9' as never, seq: ++seq, time: 1, source: null, content: [] },
      { kind: 'assistant', seq: ++seq, time: 1, turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: '思考过程' }] },
    ]) })
    const flow = screen.getByText('写一首诗').closest('div')!.parentElement!
    expect(flow.textContent).toBe('写一首诗')
  })

  it('matches the mixed-flow snapshot', () => {
    const { container } = mountView({ chat: chatWith([
      userNode('写一首诗'),
      assistantNode('床前明月光'),
      errorNode(),
    ]), running: true })
    expect(container).toMatchSnapshot()
  })

  it('pins the approval card atop the flow with the task title and the paired raw command', () => {
    mountView({
      chat: chatWith([userNode('写一首诗')], [runningCall('call-1', '{"command":"rm -rf /tmp/build-cache"}')]),
      running: true,
      pending: approvalWait({ callId: 'call-1', reason: '清理临时目录' }),
      titles: { s1: '周报任务' },
    })
    expect(screen.getByText('周报任务 请你确认：清理临时目录')).toBeTruthy()
    expect(screen.getByText('rm -rf /tmp/build-cache')).toBeTruthy()
    // The card hides the tool name; the flow still renders beneath it.
    expect(screen.queryByText(/dangerous_tool/)).toBeNull()
    expect(screen.getByText('写一首诗')).toBeTruthy()
  })

  it('renders no card when the roster holds no approval', () => {
    mountView({ chat: chatWith([userNode('写一首诗')]), running: true })
    expect(screen.queryByText(/请你确认/)).toBeNull()
  })

  it('renders the card without the details expander when the ask carries no callId, and falls back to an empty title', () => {
    mountView({
      chat: chatWith([userNode('写一首诗')]),
      running: true,
      // s1 is absent from the list stub: the headline joins on the empty title.
      pending: approvalWait(),
    })
    expect(screen.getByText('请你确认：执行一项敏感操作')).toBeTruthy()
    expect(screen.queryByText('查看原始内容')).toBeNull()
  })

  it('wires the reject note through the injected sendNote with the seat session', async () => {
    const sendNote = vi.fn(() => Promise.resolve())
    const wait = approvalWait({ reason: '清理临时目录' })
    vi.spyOn(wait, 'answer').mockResolvedValue(undefined)
    mountView({ chat: chatWith([userNode('写一首诗')]), running: true, pending: wait, sendNote })
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    fireEvent.change(screen.getByRole('textbox', { name: '给 Agent 捎句话（可选）…' }), { target: { value: '先别删' } })
    fireEvent.click(screen.getByRole('button', { name: '确认拒绝' }))
    await waitFor(() => { expect(sendNote).toHaveBeenCalledWith('s1', '先别删') })
  })
})
