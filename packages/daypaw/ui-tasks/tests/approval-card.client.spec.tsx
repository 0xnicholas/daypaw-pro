// @vitest-environment jsdom
/** ApprovalCard: the headline join, the one-shot answer encoding, the reject note, the details expander, failure re-arm. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import type { RpcId, RpcReceipt, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { ApprovalCard, type ApprovalCardProps, type PendingApprovalWait } from '../src/client/approval-card.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ApprovalCardProps['t'] = (key, params) => {
  let text = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

/** Mint an approval wait whose respond reports to the given spy. */
function approvalWait(respond: (message: unknown) => Promise<RpcReceipt>, reason?: string): PendingApprovalWait {
  return new PendingWait(
    'approval',
    'rpc-1' as RpcId,
    's1' as SessionId,
    {
      approvalId: 'ap-1' as PendingApprovalWait['payload']['approvalId'],
      toolName: 'dangerous_tool',
      callId: 'call-1' as NonNullable<PendingApprovalWait['payload']['callId']>,
      ...reason === undefined ? {} : { reason },
    },
    respond,
  )
}

const accepted = (): Promise<RpcReceipt> => Promise.resolve({ accepted: true })

function mountCard(overrides: Partial<ApprovalCardProps> = {}) {
  const respond = vi.fn(accepted)
  const sendNote = vi.fn(() => Promise.resolve())
  const wait = approvalWait(respond, '清理临时目录')
  render(
    <ApprovalCard
      wait={wait}
      taskTitle="周报任务"
      callArgs='{"command":"rm -rf /tmp/build-cache"}'
      sendNote={sendNote}
      t={t}
      {...overrides}
    />,
  )
  return { respond, sendNote, wait }
}

describe('ApprovalCard', () => {
  it('renders the headline join and never the tool name', () => {
    mountCard()
    expect(screen.getByText('周报任务 请你确认：清理临时目录')).toBeTruthy()
    expect(screen.queryByText(/dangerous_tool/)).toBeNull()
  })

  it('falls back to the generic summary when the ask carries no reason', () => {
    mountCard({ wait: approvalWait(vi.fn(accepted)) })
    expect(screen.getByText('周报任务 请你确认：执行一项敏感操作')).toBeTruthy()
  })

  it('folds the raw command into the details expander', () => {
    mountCard()
    const summary = screen.getByText('查看原始内容')
    expect(screen.getByText('rm -rf /tmp/build-cache')).toBeTruthy()
    fireEvent.click(summary)
  })

  it('renders args verbatim when they carry no command string, and hides details without a paired call', () => {
    mountCard({ callArgs: '{"path":"/etc/hosts","content":"…"}' })
    expect(screen.getByText(/"\/etc\/hosts/)).toBeTruthy()
    cleanup()
    mountCard({ callArgs: undefined })
    expect(screen.queryByText('查看原始内容')).toBeNull()
  })

  it('shows unparseable args raw rather than dropping the verification channel', () => {
    mountCard({ callArgs: 'not-json-at-all' })
    expect(screen.getByText('not-json-at-all')).toBeTruthy()
  })

  it('answers 同意 with the domain encoding and latches the buttons', async () => {
    const { respond } = mountCard()
    const allow = screen.getByRole('button', { name: '同意' })
    fireEvent.click(allow)
    await waitFor(() => { expect(respond).toHaveBeenCalledTimes(1) })
    expect(respond).toHaveBeenCalledWith({
      type: 'client-response',
      rpcId: 'rpc-1',
      result: { ok: true, value: { sessionId: 's1', approvalId: 'ap-1', outcome: 'allowed-once' } },
    })
    expect(allow).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '拒绝' })).toHaveProperty('disabled', true)
  })

  it('rejects through the two-step note flow: first click opens the note row, confirm sends rejected plus the note', async () => {
    const { respond, sendNote } = mountCard()
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    const note = screen.getByRole('textbox', { name: '给 Agent 捎句话（可选）…' })
    fireEvent.change(note, { target: { value: ' 先别删，留着排障 ' } })
    fireEvent.click(screen.getByRole('button', { name: '确认拒绝' }))
    await waitFor(() => { expect(sendNote).toHaveBeenCalledWith('先别删，留着排障') })
    expect(respond).toHaveBeenCalledWith({
      type: 'client-response',
      rpcId: 'rpc-1',
      result: { ok: true, value: { sessionId: 's1', approvalId: 'ap-1', outcome: 'rejected' } },
    })
    expect(respond.mock.invocationCallOrder[0]!).toBeLessThan(sendNote.mock.invocationCallOrder[0]!)
  })

  it('rejects without a note when the note row stays empty', async () => {
    const { respond, sendNote } = mountCard()
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    fireEvent.click(screen.getByRole('button', { name: '确认拒绝' }))
    await waitFor(() => { expect(respond).toHaveBeenCalledTimes(1) })
    expect(sendNote).not.toHaveBeenCalled()
  })

  it('re-arms and flags the failure when the answer is not accepted', async () => {
    const respond = vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: false, reason: 'not-pending' }))
    mountCard({ wait: approvalWait(respond, '清理临时目录') })
    const allow = screen.getByRole('button', { name: '同意' })
    fireEvent.click(allow)
    await screen.findByText('操作失败，请重试')
    expect(allow).toHaveProperty('disabled', false)
  })

  it('re-arms and flags the failure when the note send fails after a rejected answer', async () => {
    const sendNote = vi.fn(() => Promise.reject(new Error('wire down')))
    mountCard({ sendNote })
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    fireEvent.change(screen.getByRole('textbox', { name: '给 Agent 捎句话（可选）…' }), { target: { value: '先别删' } })
    fireEvent.click(screen.getByRole('button', { name: '确认拒绝' }))
    await screen.findByText('操作失败，请重试')
    expect(screen.getByRole('button', { name: '确认拒绝' })).toHaveProperty('disabled', false)
  })
})
