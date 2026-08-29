/**
 * New-task dialog store: the engine's agent-definition roster
 * (`durable/listDefinitions`, ruling #65: the registry IS the roster) and the
 * submit sequence — mint one run id per task attempt, `durable/startRun`
 * (start-or-attach, so a retried submit reuses the minted id and never
 * double-creates), wait for the run's session twin to reach the list
 * projection (an agent run's sessionId IS its runId, and `sessions.open`
 * fails loud on unlisted ids), then hand the id back for the owner's
 * openTask. The host stays the single fact source; a failure anywhere lands
 * inline on the dialog and keeps the minted run id for the retry.
 */
import { randomUuid } from './random-uuid.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { NewTaskApi, WireAgentDefinition } from './new-task-api.ts'

/** One selectable agent row. */
export interface AgentOption {
  /** Registry identity (`name@version`); the submit's exact resolution target. */
  id: string
  /** Business name, falling back to the technical name. */
  label: string
  /** Input presentation the dialog renders for this agent. */
  inputKind: 'text' | 'json' | null
}

/** Dialog snapshot. */
export interface NewTaskState {
  /** Roster load lifecycle; idle until the first dialog open. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Agent definitions in registration order. */
  agents: readonly AgentOption[]
  /** The picked agent's registry identity; undefined when the roster is empty or unsettled. */
  selected: string | undefined
  /** The free-text draft (the text input kinds). */
  text: string
  /** The JSON draft (the json input kind). */
  json: string
  /** A start→wait sequence is in flight. */
  submitting: boolean
  /** The last submit failed (the dialog shows the generic inline failure); false while clean. */
  submitFailed: boolean
}

/** The sessions-service members the dialog consumes (the twin wait). */
export type NewTaskSessions = { list: ObservableSnapshot<SessionListState> }

/**
 * Upper bound on the session-twin wait (ms). The engine creates the run's
 * session on the first drive — before any model call — so the twin normally
 * lands within one push; the bound retires the dialog (inline failure, run id
 * kept for an attaching retry) when a run failed before creating one. A
 * browser-boot product constant: the boot graph carries no per-plugin config
 * channel (the RUNS_BOARD_POLL_MS precedent).
 */
export const TWIN_WAIT_MS = 10_000

/** Injectable wait driver so unit tests own the timer. */
export interface NewTaskTimers {
  /** Defaults to the platform `setTimeout`. */
  readonly setTimeoutFn?: (fn: () => void, ms: number) => unknown
  /** Defaults to the platform `clearTimeout`. */
  readonly clearTimeoutFn?: (timer: unknown) => void
}

/** The new-task dialog controller (one per apply). */
export class NewTaskStore {
  /** The snapshot the dialog renders from (uSES-safe store). */
  readonly store: SnapshotStore<NewTaskState> = createSnapshotStore<NewTaskState>({
    status: 'idle', agents: [], selected: undefined, text: '', json: '', submitting: false, submitFailed: false,
  })

  /** Latest roster load wins; an older response never overwrites a newer one. */
  private generation = 0
  /** The run id minted for the task in flight; kept across failed submits so a retry attaches. */
  private pendingRunId: string | undefined

  /**
   * @param api - the wire face (durable/listDefinitions + durable/startRun).
   * @param sessions - the sessions service (list projection for the twin wait).
   * @param timers - the twin-wait timer driver (tests).
   */
  constructor(
    private readonly api: NewTaskApi,
    private readonly sessions: NewTaskSessions,
    timers: NewTaskTimers = {},
  ) {
    this.setTimeoutFn = timers.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimeoutFn = timers.clearTimeoutFn ?? ((timer) => { clearTimeout(timer as never) })
  }

  /** The twin-wait timer arm (injectable; the platform `setTimeout`). */
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown
  /** The twin-wait timer release (injectable; the platform `clearTimeout`). */
  private readonly clearTimeoutFn: (timer: unknown) => void

  /** The selected agent's roster row, when one is picked. */
  private selectedAgent(): AgentOption | undefined {
    const state = this.store.getSnapshot()
    return state.agents.find(agent => agent.id === state.selected)
  }

  /**
   * Fetch the agent roster from the engine registry: business label from the
   * declared display title (technical name otherwise), first row
   * preselected. Safe to call again; only an idle dialog skips it.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading' })
    try {
      const definitions = await this.api.listDefinitions()
      const agents = definitions.map(projectAgentOption)
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.agents = agents
        s.selected = agents[0]?.id
      })
    } catch {
      if (generation !== this.generation) return
      this.store.update((s) => { s.status = 'error' })
    }
  }

  /** Pick an agent.
   * @param id - the registry identity (`name@version`). */
  select(id: string): void {
    this.store.update((s) => { s.selected = id })
  }

  /** Edit the free-text draft.
   * @param text - the new draft. */
  setText(text: string): void {
    this.store.update((s) => { s.text = text })
  }

  /** Edit the JSON draft.
   * @param json - the new draft. */
  setJson(json: string): void {
    this.store.update((s) => { s.json = json })
  }

  /**
   * The parsed JSON draft, or the parse failure. Inline validation for the
   * json input kind: the dialog checks JSON syntax locally (a `SyntaxError`
   * marks a malformed draft); the definition's own contract still validates
   * host-side before the run inserts.
   * @returns the parsed value, or the SyntaxError the draft produced.
   */
  parseJsonDraft(): unknown {
    try {
      return JSON.parse(this.store.getSnapshot().json)
    } catch (error) {
      return error
    }
  }

  /**
   * Start the task: `durable/startRun` with a dialog-minted run id, then wait
   * until the sessions list carries the run's session twin (sessionId ≡
   * runId) so the owner can open the conversation. A failed submit keeps the
   * minted id: the retry's start-or-attach lands on the same run instead of
   * creating a second one.
   * @returns the run's session id, or undefined when the submit was rejected
   *   (guard) or failed (the snapshot flags the inline failure).
   */
  async submit(): Promise<SessionId | undefined> {
    const state = this.store.getSnapshot()
    if (state.submitting || state.status !== 'ready') return undefined
    const agent = this.selectedAgent()
    if (agent === undefined) return undefined
    const input = composeInput(agent.inputKind, state, () => this.parseJsonDraft())
    if (input === undefined) return undefined
    const [defName, defVersion] = splitIdentity(agent.id)
    this.store.update((s) => { s.submitting = true; s.submitFailed = false })
    try {
      this.pendingRunId ??= randomUuid()
      const started = await this.api.startRun({ defName, defVersion, input, runId: this.pendingRunId })
      await this.whenListed(started.runId)
      this.pendingRunId = undefined
      this.store.update((s) => { s.submitting = false; s.text = ''; s.json = '' })
      return started.runId as SessionId
    } catch {
      // Any wire or invariant failure reads as the same generic inline
      // failure; raw host wording never reaches the dialog. The minted run
      // id stays for the retry (start-or-attach).
      this.store.update((s) => { s.submitting = false; s.submitFailed = true })
      return undefined
    }
  }

  /** Resolve once the list projection carries the run's session twin, or fail at the bound. */
  private async whenListed(runId: string): Promise<void> {
    const list = this.sessions.list
    if (list.getSnapshot().byId[runId as SessionId] !== undefined) return
    await new Promise<void>((resolve, reject) => {
      // The bound cannot race the twin: whichever fires first disposes the
      // other arm, so the subscription never outlives the wait.
      const timer = this.setTimeoutFn(() => {
        off()
        reject(new Error(`ui-tasks: run "${runId}" session twin never listed`))
      }, TWIN_WAIT_MS)
      const off = (): void => {
        this.clearTimeoutFn(timer)
        disposeList()
      }
      const disposeList = list.subscribe(() => {
        if (list.getSnapshot().byId[runId as SessionId] === undefined) return
        off()
        resolve()
      })
    })
  }
}

/** Project one wire definition to a selectable roster row. */
function projectAgentOption(definition: WireAgentDefinition): AgentOption {
  return {
    id: `${definition.name}@${definition.version}`,
    label: definition.display?.title ?? definition.name,
    inputKind: definition.inputKind,
  }
}

/** Split a `name@version` registry identity. */
function splitIdentity(id: string): [name: string, version: string] {
  const at = id.lastIndexOf('@')
  return [id.slice(0, at), id.slice(at + 1)]
}

/**
 * Compose the start input for one input kind.
 * @param inputKind - the selected agent's input presentation.
 * @param state - the dialog snapshot (the drafts).
 * @param parseJson - JSON-draft parse (inline validation).
 * @returns the wire input value, or undefined when the draft is unusable
 *   (blank text, or a malformed JSON draft).
 */
function composeInput(
  inputKind: 'text' | 'json' | null,
  state: NewTaskState,
  parseJson: () => unknown,
): unknown {
  if (inputKind === 'json' || inputKind === null) {
    // A null kind (engine-native definition without a wire face) takes the
    // JSON box too: the engine inserts the value as given.
    const parsed = parseJson()
    return parsed instanceof SyntaxError ? undefined : parsed
  }
  const text = state.text.trim()
  return text === '' ? undefined : text
}
