/**
 * The `approvalHistory` projection unit: mounting the plugin beside the
 * projection registry serves the ordered approval audit list folded from the
 * `approval/asked` + `approval/decided` pair; unmounting removes the key (HMR
 * safety). The fold itself runs against the exported definition directly for
 * the pairing edges: every outcome value, an ask without its decision, an
 * unknown-id decision (ignored — the ask always precedes in a valid log),
 * interleaved approvals keeping log order, and the same-reference no-op the
 * registry's Object.is gate requires for unrelated events.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-user-approval'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval/types'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import * as ApprovalHistoryPlugin from '@daypaw/approval-history'
import { approvalHistoryProjectionDefinition } from '@daypaw/approval-history/src/projection.ts'
import type { ApprovalHistoryProjection } from '@daypaw/approval-history/types'

const OUTCOMES: readonly ApprovalOutcome[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

/** The `approval/asked` payload; an absent reason stays absent (never undefined-valued). */
function askedData(id: string, toolName: string, reason?: string): { id: ApprovalRequestId; toolName: string; reason?: string } {
  const data: { id: ApprovalRequestId; toolName: string; reason?: string } = { id: ApprovalRequestId(id), toolName }
  if (reason !== undefined) data.reason = reason
  return data
}

/** Build one synthetic committed event. */
function at(seq: number, type: string, data: unknown): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

/** Fold a synthetic event list through the definition and view the result. */
function fold(events: readonly SessionEvent[]): ApprovalHistoryProjection {
  const state = events.reduce(
    (folded, event) => approvalHistoryProjectionDefinition.apply(folded, event),
    approvalHistoryProjectionDefinition.init(),
  )
  return approvalHistoryProjectionDefinition.wire.view(state)
}

describe('approvalHistory fold', () => {
  it('starts empty and appends one entry per approval/asked, in log order', () => {
    expect(fold([])).toEqual([])
    expect(fold([
      at(0, 'approval/asked', askedData('req-1', 'bash', 'writes outside the workspace')),
      at(1, 'approval/asked', askedData('req-2', 'write')),
    ])).toEqual([
      { id: 'req-1', toolName: 'bash', reason: 'writes outside the workspace' },
      { id: 'req-2', toolName: 'write' },
    ])
  })

  it('keeps an absent reason ABSENT (never an undefined-valued key)', () => {
    const [entry] = fold([at(0, 'approval/asked', askedData('req-1', 'bash'))])
    expect(entry).toEqual({ id: 'req-1', toolName: 'bash' })
    expect(entry !== undefined && 'reason' in entry).toBe(false)
  })

  it('pairs approval/decided by id with every outcome value', () => {
    for (const outcome of OUTCOMES) {
      expect(fold([
        at(0, 'approval/asked', askedData('req-1', 'bash')),
        at(1, 'approval/decided', { id: ApprovalRequestId('req-1'), outcome }),
      ])).toEqual([{ id: 'req-1', toolName: 'bash', outcome }])
    }
  })

  it('keeps an unanswered ask outcome-less', () => {
    const [entry] = fold([at(0, 'approval/asked', askedData('req-1', 'bash', 'why'))])
    expect(entry).toEqual({ id: 'req-1', toolName: 'bash', reason: 'why' })
    expect(entry !== undefined && 'outcome' in entry).toBe(false)
  })

  it('keeps log order across interleaved approvals and pairs each decision to its own ask', () => {
    expect(fold([
      at(0, 'approval/asked', askedData('a', 'bash')),
      at(1, 'approval/asked', askedData('b', 'write')),
      at(2, 'approval/decided', { id: ApprovalRequestId('b'), outcome: 'rejected' }),
      at(3, 'approval/asked', askedData('c', 'read')),
      at(4, 'approval/decided', { id: ApprovalRequestId('a'), outcome: 'allowed-once' }),
    ])).toEqual([
      { id: 'a', toolName: 'bash', outcome: 'allowed-once' },
      { id: 'b', toolName: 'write', outcome: 'rejected' },
      { id: 'c', toolName: 'read' },
    ])
  })

  it('ignores a decision whose id no ask recorded (same reference)', () => {
    const folded = approvalHistoryProjectionDefinition.apply(
      approvalHistoryProjectionDefinition.init(),
      at(0, 'approval/asked', askedData('a', 'bash')),
    )
    // The service appends the asked/decided pair in order, so an unknown id
    // cannot appear in a valid log; there is nothing to pair with.
    expect(approvalHistoryProjectionDefinition.apply(
      folded,
      at(1, 'approval/decided', { id: ApprovalRequestId('ghost'), outcome: 'allowed-once' }),
    )).toBe(folded)
  })

  it('returns the same reference for unrelated events (the registry Object.is no-op gate)', () => {
    const state = approvalHistoryProjectionDefinition.apply(
      approvalHistoryProjectionDefinition.init(),
      at(0, 'approval/asked', askedData('a', 'bash')),
    )
    expect(approvalHistoryProjectionDefinition.apply(state, at(1, 'turn/start', { turn: 1 }))).toBe(state)
  })
})

async function harness(withPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withPlugin) await ctx.plugin(ApprovalHistoryPlugin)
  return { ctx, session: ctx.sessions.create(SessionId('approvals')) }
}

describe('approvalHistory projection unit (registry drive)', () => {
  it('serves an empty list on the empty log', async () => {
    const { ctx, session } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.approvalHistory).toEqual([])
  })

  it('serves asks and their paired outcomes through the composed registry', async () => {
    const { ctx, session } = await harness(true)
    session.append('approval/asked', askedData('req-1', 'bash', 'writes outside the workspace'))
    session.append('approval/asked', askedData('req-2', 'write'))
    session.append('approval/decided', { id: ApprovalRequestId('req-1'), outcome: 'allowed-once' })
    expect(ctx.sessionProjections.snapshot(session).values.approvalHistory).toEqual([
      { id: 'req-1', toolName: 'bash', reason: 'writes outside the workspace', outcome: 'allowed-once' },
      { id: 'req-2', toolName: 'write' },
    ])
  })

  it('notifies the change feed with the schema-validated value and the causing seq', async () => {
    const { ctx, session } = await harness(true)
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    const asked = session.append('approval/asked', askedData('req-1', 'bash'))
    const decided = session.append('approval/decided', { id: ApprovalRequestId('req-1'), outcome: 'rejected' })
    // An unrelated event folds to the same reference and stays silent.
    session.append('turn/start', { turn: 1 })
    expect(changes).toEqual([
      { key: 'approvalHistory', value: [{ id: 'req-1', toolName: 'bash' }], seq: asked.seq },
      { key: 'approvalHistory', value: [{ id: 'req-1', toolName: 'bash', outcome: 'rejected' }], seq: decided.seq },
    ])
  })

  it('folds events already in the log when the plugin mounts late (lazy cell build)', async () => {
    const { ctx, session } = await harness(false)
    session.append('approval/asked', askedData('req-1', 'bash'))
    session.append('approval/decided', { id: ApprovalRequestId('req-1'), outcome: 'cancelled' })
    await ctx.plugin(ApprovalHistoryPlugin)
    expect(ctx.sessionProjections.snapshot(session).values.approvalHistory)
      .toEqual([{ id: 'req-1', toolName: 'bash', outcome: 'cancelled' }])
  })

  it('has no approvalHistory key without the plugin, and drops it when the plugin unloads (HMR safety)', async () => {
    const { ctx, session } = await harness(false)
    expect('approvalHistory' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = await ctx.plugin(ApprovalHistoryPlugin)
    session.append('approval/asked', askedData('req-1', 'bash'))
    expect(ctx.sessionProjections.snapshot(session).values.approvalHistory)
      .toEqual([{ id: 'req-1', toolName: 'bash' }])
    await fiber.dispose()
    expect('approvalHistory' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})
