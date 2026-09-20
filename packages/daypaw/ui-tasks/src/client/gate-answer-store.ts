/**
 * Gate answer store: the durable run's pending `ctx.waitFor` gate (issue
 * #128) and the answer sequence the detail column's card drives — the JSON
 * value an approval sends, the reason a rejection carries, and the first-wins
 * outcome the wire reports. Drafts belong to one run: binding a different run
 * resets them, so a draft never travels between tasks. Failures land inline on
 * the card as generic localized copy; raw host wording never reaches the
 * screen.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DurableClient, WireGateSettlement } from '@daypaw/durable-client/client'

/** The JSON draft a card opens with: a value most gate contracts accept (an empty object). */
export const EMPTY_GATE_VALUE = '{}'

/** Gate answer snapshot. */
export interface GateAnswerState {
  /** The run the drafts and outcome belong to; a different run resets everything. */
  runId: string | undefined
  /** The approval value draft (JSON text). */
  value: string
  /** The rejection reason draft (free text; the wire takes it as given). */
  reason: string
  /** An answer is in flight. */
  submitting: boolean
  /**
   * The last answer's outcome: `answered` won the settlement, `superseded` lost
   * it (another answer, a timeout, or a cancellation), `failed` never reached
   * the ledger. Undefined while clean.
   */
  outcome: 'answered' | 'superseded' | 'failed' | undefined
}

const EMPTY: GateAnswerState = {
  runId: undefined, value: EMPTY_GATE_VALUE, reason: '', submitting: false, outcome: undefined,
}

/** The gate answer controller (one per apply). */
export class GateAnswerStore {
  /** The snapshot the card renders from (uSES-safe store). */
  readonly store: SnapshotStore<GateAnswerState> = createSnapshotStore(EMPTY)

  /**
   * @param api - the durable wire face (durable/resolveGate).
   */
  constructor(private readonly api: Pick<DurableClient, 'resolveGate'>) {}

  /**
   * Point the drafts and outcome at one run; an unchanged target is a no-op.
   * @param runId - the run whose gate card is on screen.
   */
  bind(runId: string): void {
    if (this.store.getSnapshot().runId === runId) return
    this.store.set({ ...EMPTY, runId })
  }

  /** Edit the approval value draft.
   * @param value - the new JSON text. */
  setValue(value: string): void {
    this.store.update((s) => { s.value = value; s.outcome = undefined })
  }

  /** Edit the rejection reason draft.
   * @param reason - the new free text. */
  setReason(reason: string): void {
    this.store.update((s) => { s.reason = reason; s.outcome = undefined })
  }

  /**
   * The parsed value draft. Inline validation for the JSON box: the card
   * checks syntax locally; the gate's own contract validates host-side when the
   * settlement reaches the engine.
   * @returns the parsed value (any JSON value the gate's contract takes), or
   *   the SyntaxError the draft produced — callers narrow with `instanceof`.
   */
  parseValue(): unknown {
    try {
      return JSON.parse(this.store.getSnapshot().value)
    } catch (error) {
      return error
    }
  }

  /**
   * Approve the bound run's gate with the parsed value draft.
   * @param gate - the gate name the card shows.
   * @returns nothing; the snapshot carries the outcome.
   */
  async approve(gate: string): Promise<void> {
    const runId = this.store.getSnapshot().runId
    const value = this.parseValue()
    if (runId === undefined || value instanceof SyntaxError) return
    await this.settle(runId, gate, { state: 'resolved', value })
  }

  /**
   * Reject the bound run's gate, carrying the reason draft.
   * @param gate - the gate name the card shows.
   * @returns nothing; the snapshot carries the outcome.
   */
  async reject(gate: string): Promise<void> {
    const runId = this.store.getSnapshot().runId
    if (runId === undefined) return
    await this.settle(runId, gate, { state: 'rejected', reason: this.store.getSnapshot().reason })
  }

  /** Send one settlement and record its outcome. */
  private async settle(runId: string, gate: string, settlement: WireGateSettlement): Promise<void> {
    if (this.store.getSnapshot().submitting) return
    this.store.update((s) => { s.submitting = true; s.outcome = undefined })
    try {
      const won = await this.api.resolveGate(runId, gate, settlement)
      this.store.update((s) => { s.submitting = false; s.outcome = won ? 'answered' : 'superseded' })
    } catch {
      // Any wire or contract failure reads as the same generic inline failure;
      // raw host wording never reaches the card.
      this.store.update((s) => { s.submitting = false; s.outcome = 'failed' })
    }
  }
}
