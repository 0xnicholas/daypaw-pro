// @vitest-environment jsdom
/**
 * DetailBody (the 'inbox.detail.body' occupant): the four sections — 进度
 * (workflow step timeline / session business tail), 子任务, 产出物, 审批历史 —
 * their empty copies, and the stale-session guard (the seat may carry another
 * task's session while a workflow run is selected).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type {
  ChatSnapshot, ConversationSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import { EMPTY_CONVERSATION_VIEWS } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  TaskDetailView, WireJournalEntry, WireRun, WireRunLineage,
} from '@daypaw/ui-inbox/client'
import type { ApprovalHistoryEntry } from '@daypaw/approval-history/types'
import { DetailBody, type DetailBodyProps } from '../src/client/detail-body.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: DetailBodyProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('the detail body must not read this hook') }) as never

let seq = 0

/** Mint one visible business-readable Chat node. */
function userNode(text: string): ChatNode<'user'> {
  seq += 1
  return {
    key: `n${seq}`, kind: 'user', id: `id${seq}`, target: 'chat', anchorSeq: seq,
    location: { kind: 'unresolved' }, visibility: 'visible',
    data: { kind: 'user', seq, time: seq * 1000, source: null, content: [{ type: 'text', text }] },
  }
}

/** Mint one terminal failure marker node. */
function errorNode(): ChatNode<'turn-error'> {
  seq += 1
  return {
    key: `n${seq}`, kind: 'turn-error', id: `id${seq}`, target: 'chat', anchorSeq: seq,
    location: { kind: 'unresolved' }, visibility: 'visible',
    data: { kind: 'turn-error', seq, time: 1, turn: 1, step: 1, message: 'provider exploded' },
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

const EMPTY_CHAT = chatWith([])

/** A ConversationSnapshot carrying only what the body reads. */
function sessionWith(sessionId: string, chat: ChatSnapshot, running: boolean): ConversationSnapshot {
  return {
    sessionId: sessionId as SessionId, views: EMPTY_CONVERSATION_VIEWS, chat, nodes: [],
    turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

/** A run row fixture (workflow by default). */
function run(over: Partial<WireRun> = {}): WireRun {
  return {
    runId: 'r1', defKind: 'workflow', defName: '周报流程', status: 'running',
    parentRunId: null, outputJson: null, updatedAt: 1, ...over,
  }
}

/** A journal step fixture. */
function step(name: string, status: WireJournalEntry['status']): WireJournalEntry {
  return {
    stepKey: name, name, occurrence: 1, kind: 'step', status,
    sessionId: null, startedAt: 1, finishedAt: status === 'started' ? null : 2,
  }
}

/** A run detail view fixture. */
function runDetail(over: Partial<WireRun> & {
  lineage?: WireRunLineage | undefined
  timeline?: readonly WireJournalEntry[] | undefined
  output?: unknown
} = {}): TaskDetailView {
  const { lineage, timeline, output, ...runOver } = over
  return { kind: 'run', run: run(runOver), lineage, timeline, output, retry: undefined }
}

interface MountOptions {
  /** The session seat's id (defaults to matching a session-kind detail's 's1'). */
  seatSessionId?: string
  /** The session seat's snapshot. */
  session?: ConversationSnapshot
  /** The seat's approvalHistory projection value (undefined = capability absent). */
  approvals?: readonly ApprovalHistoryEntry[] | undefined
}

function mountBody(detail: TaskDetailView, opts: MountOptions = {}) {
  const session = opts.session ?? sessionWith('s1', EMPTY_CHAT, false)
  const useSession: DetailBodyProps['useSession'] = sel => sel(session)
  const useProjection = ((key: string) => key === 'approvalHistory' ? opts.approvals : undefined) as DetailBodyProps['useProjection']
  return render(
    <DetailBody
      detail={detail} useSession={useSession} useProjection={useProjection}
      sessionId={(opts.seatSessionId ?? 's1') as SessionId}
      useInput={neverHook} inputActions={undefined as never}
      useSessions={neverHook} useWorkspaces={neverHook} t={t}
    />,
  )
}

const approval = (id: string, over: Partial<ApprovalHistoryEntry> = {}): ApprovalHistoryEntry => ({
  id, toolName: 'bash', ...over,
})

describe('DetailBody', () => {
  it('renders nothing for the none selection', () => {
    const { container } = mountBody({ kind: 'none' })
    expect(container.textContent).toBe('')
  })

  it('draws the workflow step timeline with strict status copy, ignoring a stale session seat', () => {
    mountBody(runDetail({
      status: 'failed',
      timeline: [step('收集数据', 'completed'), step('生成周报', 'failed'), step('发送通知', 'started')],
    }), {
      // The seat carries another task's live session; ledger facts still render.
      seatSessionId: 'other',
      session: sessionWith('other', chatWith([userNode('别的任务')]), true),
      approvals: [approval('a1', { outcome: 'allowed-once' })],
    })
    expect(screen.getByText('收集数据')).toBeTruthy()
    expect(screen.getByText('生成周报')).toBeTruthy()
    expect(screen.getByText('已完成')).toBeTruthy()
    expect(screen.getByText('出错了')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    // The stale seat's conversation and approvals never leak into the run's detail.
    expect(screen.queryByText('别的任务')).toBeNull()
    expect(screen.getAllByText('暂无审批记录')).toHaveLength(1)
  })

  it('shows the progress empty copy while the workflow timeline is absent or empty', () => {
    mountBody(runDetail({ timeline: undefined }))
    expect(screen.getByText('暂无进度')).toBeTruthy()
    cleanup()
    mountBody(runDetail({ timeline: [] }))
    expect(screen.getByText('暂无进度')).toBeTruthy()
  })

  it('draws an agent run from the matching session seat: the business tail and the running line', () => {
    mountBody(runDetail({
      defKind: 'agent', runId: 'agent-1', status: 'running',
      timeline: undefined,
      lineage: { run: undefined, parent: undefined, children: [
        run({ runId: 'c1', defName: '子任务甲', status: 'done' }),
        run({ runId: 'c2', defName: '子任务乙', status: 'failed' }),
      ] },
      output: { summary: '写完了', count: 2, meta: { pages: 3 }, extra: null },
    }), {
      seatSessionId: 'agent-1',
      session: sessionWith('agent-1', chatWith([
        userNode('第一条'), userNode('第二条'), userNode('第三条'), userNode('第四条'), errorNode(),
      ]), true),
      approvals: [
        approval('a1', { reason: '要删除临时文件', outcome: 'allowed-once' }),
        approval('a2', { outcome: 'rejected' }),
        approval('a3', { outcome: 'cancelled' }),
        approval('a4', { outcome: 'unavailable' }),
        approval('a5'),
      ],
    })
    // Only the last three business rows render; the failure marker reads as copy
    // (one 出错了 in 进度, one in 子任务 for the failed child).
    expect(screen.queryByText('第一条')).toBeNull()
    expect(screen.queryByText('第二条')).toBeNull()
    expect(screen.getByText('第三条')).toBeTruthy()
    expect(screen.getByText('第四条')).toBeTruthy()
    expect(screen.getAllByText('出错了')).toHaveLength(2)
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.queryByText('provider exploded')).toBeNull()
    // 子任务: defName + strict status text.
    expect(screen.getByText('子任务甲')).toBeTruthy()
    expect(screen.getByText('子任务乙')).toBeTruthy()
    expect(screen.getByText('已完成')).toBeTruthy()
    // 产出物: one row per entry — scalars direct, objects JSON, null stringified.
    expect(screen.getByText('summary')).toBeTruthy()
    expect(screen.getByText('写完了')).toBeTruthy()
    expect(screen.getByText('count')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('{"pages":3}')).toBeTruthy()
    expect(screen.getByText('null')).toBeTruthy()
    // 审批历史: reason beats toolName; every outcome maps to the strict copy.
    expect(screen.getByText('要删除临时文件')).toBeTruthy()
    expect(screen.getAllByText('bash')).toHaveLength(4)
    expect(screen.getByText('同意')).toBeTruthy()
    expect(screen.getByText('拒绝')).toBeTruthy()
    expect(screen.getByText('已取消')).toBeTruthy()
    expect(screen.getByText('未回应')).toBeTruthy()
    expect(screen.getByText('等待确认')).toBeTruthy()
  })

  it('guards an agent run against a stale session seat', () => {
    mountBody(runDetail({ defKind: 'agent', runId: 'agent-1', timeline: undefined }), {
      seatSessionId: 'other',
      session: sessionWith('other', chatWith([userNode('别的任务')]), false),
      approvals: [approval('a1', { outcome: 'allowed-once' })],
    })
    expect(screen.getByText('暂无进度')).toBeTruthy()
    expect(screen.queryByText('别的任务')).toBeNull()
    expect(screen.getByText('暂无审批记录')).toBeTruthy()
  })

  it('draws a session task from its matching seat: rows without the running line once settled', () => {
    mountBody({ kind: 'session', sessionId: 's1' as SessionId }, {
      session: sessionWith('s1', chatWith([userNode('写一首诗')]), false),
      approvals: undefined,
    })
    expect(screen.getByText('写一首诗')).toBeTruthy()
    expect(screen.queryByText('进行中')).toBeNull()
    expect(screen.getByText('暂无子任务')).toBeTruthy()
    expect(screen.getByText('暂无产出物')).toBeTruthy()
    // Capability absent: the projection key reads undefined.
    expect(screen.getByText('暂无审批记录')).toBeTruthy()
  })

  it('shows the running line alone while a session task has no rows yet', () => {
    mountBody({ kind: 'session', sessionId: 's1' as SessionId }, {
      session: sessionWith('s1', EMPTY_CHAT, true),
    })
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.queryByText('暂无进度')).toBeNull()
  })

  it('shows the progress empty copy for a settled session task without rows', () => {
    mountBody({ kind: 'session', sessionId: 's1' as SessionId })
    expect(screen.getByText('暂无进度')).toBeTruthy()
  })

  it('guards a session task against a stale seat', () => {
    mountBody({ kind: 'session', sessionId: 's1' as SessionId }, {
      seatSessionId: 'other',
      session: sessionWith('other', chatWith([userNode('别的任务')]), false),
      approvals: [],
    })
    expect(screen.getByText('暂无进度')).toBeTruthy()
    expect(screen.queryByText('别的任务')).toBeNull()
  })

  it('renders a scalar deliverable as a single row and an empty object as the empty copy', () => {
    mountBody(runDetail({ status: 'done', output: '周报.md' }))
    expect(screen.getByText('周报.md')).toBeTruthy()
    cleanup()
    mountBody(runDetail({ status: 'done', output: {} }))
    expect(screen.getByText('暂无产出物')).toBeTruthy()
  })

  it('shows the subtasks empty copy when the lineage carries no children', () => {
    mountBody(runDetail({ lineage: { run: undefined, parent: undefined, children: [] } }))
    expect(screen.getByText('暂无子任务')).toBeTruthy()
  })

  it('shows the approvals empty copy for an empty projection', () => {
    mountBody({ kind: 'session', sessionId: 's1' as SessionId }, { approvals: [] })
    expect(screen.getByText('暂无审批记录')).toBeTruthy()
  })
})
