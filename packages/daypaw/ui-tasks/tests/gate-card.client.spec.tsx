// @vitest-environment jsdom
/**
 * GateCard: the pending gate's answer card — the gate name, the approve/reject
 * paths over the drafts, inline JSON validation, the three outcome copies, and
 * the per-run draft reset (issue #128).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { GateAnswerStore } from '../src/client/gate-answer-store.ts'
import { GateCard, type GateCardProps } from '../src/client/gate-card.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: GateCardProps['t'] = key => (zh as Record<string, string>)[key] ?? key

/** Mount the card over one programmable answer face. */
function mountCard(
  answer: (runId: string, gate: string, settlement: unknown) => Promise<boolean> = () => Promise.resolve(true),
  runId = 'r1',
) {
  const resolveGate = vi.fn(answer)
  const store = new GateAnswerStore({ resolveGate })
  const view = render(
    <GateCard runId={runId} gate="owner-approval" answer={store} useAnswer={bindSnapshotSelector(store.store)} t={t} />,
  )
  return { store, resolveGate, view }
}

const valueBox = (): HTMLElement => screen.getByRole('textbox', { name: '答复内容（JSON）' })
const reasonBox = (): HTMLElement => screen.getByRole('textbox', { name: '拒绝理由（可选）' })
const approveButton = (): HTMLElement => screen.getByRole('button', { name: '同意' })
const rejectButton = (): HTMLElement => screen.getByRole('button', { name: '拒绝' })

describe('GateCard', () => {
  it('shows the gate name and approves with the draft value', async () => {
    const { resolveGate } = mountCard()
    expect(screen.getByText('owner-approval')).toBeTruthy()
    // The opening draft is an empty object: a value most gate contracts accept.
    expect((valueBox() as HTMLTextAreaElement).value).toBe('{}')
    fireEvent.change(valueBox(), { target: { value: '{"approve":true}' } })
    fireEvent.click(approveButton())
    await waitFor(() => { expect(resolveGate).toHaveBeenCalledTimes(1) })
    expect(resolveGate.mock.calls[0]).toEqual([
      'r1', 'owner-approval', { state: 'resolved', value: { approve: true } },
    ])
    await screen.findByText('已作答，任务继续执行')
  })

  it('rejects with the reason draft', async () => {
    const { resolveGate } = mountCard()
    fireEvent.change(reasonBox(), { target: { value: '还没准备好' } })
    fireEvent.click(rejectButton())
    await waitFor(() => { expect(resolveGate).toHaveBeenCalledTimes(1) })
    expect(resolveGate.mock.calls[0]).toEqual([
      'r1', 'owner-approval', { state: 'rejected', reason: '还没准备好' },
    ])
  })

  it('keeps approve disabled while the JSON draft is malformed', () => {
    mountCard()
    fireEvent.change(valueBox(), { target: { value: '{oops' } })
    expect(screen.getByText('JSON 格式有误，请检查后重试')).toBeTruthy()
    expect(approveButton()).toHaveProperty('disabled', true)
    // The rejection path takes free text and stays available.
    expect(rejectButton()).toHaveProperty('disabled', false)
  })

  it('reads a lost settlement as superseded', async () => {
    mountCard(() => Promise.resolve(false))
    fireEvent.click(approveButton())
    await screen.findByText('这个确认已被作答或已超时')
  })

  it('shows the inline failure without leaking host wording', async () => {
    mountCard(() => Promise.reject(new Error('durable/resolveGate failed (durable/gate-unknown): raw host text')))
    fireEvent.click(approveButton())
    await screen.findByText('提交失败，请重试')
    expect(screen.queryByText(/raw host text/)).toBeNull()
  })

  it('resets the drafts when the selection moves to another run', async () => {
    const resolveGate = vi.fn(() => Promise.resolve(true))
    const store = new GateAnswerStore({ resolveGate })
    const view = render(
      <GateCard runId="r1" gate="owner-approval" answer={store} useAnswer={bindSnapshotSelector(store.store)} t={t} />,
    )
    fireEvent.change(valueBox(), { target: { value: '{"approve":false}' } })
    fireEvent.change(reasonBox(), { target: { value: '草稿' } })
    view.rerender(
      <GateCard runId="r2" gate="owner-approval" answer={store} useAnswer={bindSnapshotSelector(store.store)} t={t} />,
    )
    await waitFor(() => { expect((valueBox() as HTMLTextAreaElement).value).toBe('{}') })
    expect((reasonBox() as HTMLTextAreaElement).value).toBe('')
  })
})
