/**
 * New-task dialog store: the engine's definition roster
 * (`durable/listDefinitions`, ruling #65: the registry IS the roster — agent
 * and workflow definitions alike) and the submit sequence — mint one run id
 * per task attempt, `durable/startRun` (start-or-attach, so a retried submit
 * reuses the minted id and never double-creates), then hand the owner what to
 * open. An agent run's session identity IS its runId, so the submit waits for
 * that session twin to reach the list projection (`sessions.open` fails loud
 * on unlisted ids) and answers with the session; a workflow run has no
 * session (ADR 0016), so it answers with the run id itself. The host stays
 * the single fact source; a failure anywhere lands inline on the dialog and
 * keeps the minted run id for the retry.
 */
import { randomUuid } from './random-uuid.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LatestLoad } from '@daypaw/client-load'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DurableClient, WireDefinition } from '@daypaw/durable-client/client'

/** One selectable roster row: an engine definition the dialog can start. */
export interface DefinitionOption {
  /** Registry identity (`name@version`); the submit's exact resolution target. */
  id: string
  /** Business name (an agent's display title), falling back to the technical name. */
  label: string
  /** Definition family: only an agent run gains a session twin to open. */
  kind: WireDefinition['kind']
  /** Input presentation the dialog renders for this definition. */
  inputKind: WireDefinition['inputKind']
}

/**
 * What one successful submit hands the owner: the created agent run's session
 * (the middle column opens its conversation), or the created workflow run's
 * id (a session-less run opens as the run itself).
 */
export type NewTaskOutcome =
  | { readonly kind: 'task'; readonly sessionId: SessionId }
  | { readonly kind: 'run'; readonly runId: string }

/** Dialog snapshot. */
export interface NewTaskState {
  /** Roster load lifecycle; idle until the first dialog open. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Engine definitions in registration order (agent and workflow rows alike). */
  definitions: readonly DefinitionOption[]
  /** The picked row's registry identity; undefined when the roster is empty or unsettled. */
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
    status: 'idle', definitions: [], selected: undefined, text: '', json: '', submitting: false, submitFailed: false,
  })

  /** Latest roster load wins; an older response never overwrites a newer one. */
  private readonly loads = new LatestLoad(this.store)
  /** The run id minted for the task in flight; kept across failed submits so a retry attaches. */
  private pendingRunId: string | undefined

  /**
   * @param api - the durable wire face (durable/listDefinitions + durable/startRun).
   * @param sessions - the sessions service (list projection for the twin wait).
   * @param timers - the twin-wait timer driver (tests).
   */
  constructor(
    private readonly api: DurableClient,
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

  /** The selected definition's roster row, when one is picked. */
  private selectedDefinition(): DefinitionOption | undefined {
    const state = this.store.getSnapshot()
    return state.definitions.find(row => row.id === state.selected)
  }

  /**
   * Fetch the definition roster from the engine registry: business label from
   * an agent's declared display title (technical name otherwise), first row
   * preselected. Safe to call again; only an idle dialog skips it.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    await this.loads.run(() => this.api.listDefinitions(), {
      start: (s) => { s.status = 'loading' },
      success: (s, definitions) => {
        const rows = definitions.map(projectDefinitionOption)
        s.status = 'ready'
        s.definitions = rows
        s.selected = rows[0]?.id
      },
      failure: (s) => { s.status = 'error' },
    })
  }

  /** Pick a roster row.
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
   * Start the task: `durable/startRun` with a dialog-minted run id, then
   * resolve what the owner opens. An agent run's session twin must reach the
   * list projection first (sessionId ≡ runId) so its conversation can open; a
   * workflow run has no session, so its run id is the answer. A failed submit
   * keeps the minted id: the retry's start-or-attach lands on the same run
   * instead of creating a second one.
   * @returns the created run's open outcome, or undefined when the submit was
   *   rejected (guard) or failed (the snapshot flags the inline failure).
   */
  async submit(): Promise<NewTaskOutcome | undefined> {
    const state = this.store.getSnapshot()
    if (state.submitting || state.status !== 'ready') return undefined
    const definition = this.selectedDefinition()
    if (definition === undefined) return undefined
    const input = composeInput(definition.inputKind, state, () => this.parseJsonDraft())
    if (input === undefined) return undefined
    const [defName, defVersion] = splitIdentity(definition.id)
    this.store.update((s) => { s.submitting = true; s.submitFailed = false })
    try {
      this.pendingRunId ??= randomUuid()
      const started = await this.api.startRun({ defName, defVersion, input, runId: this.pendingRunId })
      if (definition.kind === 'agent') await this.whenListed(started.runId)
      this.pendingRunId = undefined
      this.store.update((s) => { s.submitting = false; s.text = ''; s.json = '' })
      return definition.kind === 'agent'
        ? { kind: 'task', sessionId: started.runId as SessionId }
        : { kind: 'run', runId: started.runId }
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
function projectDefinitionOption(definition: WireDefinition): DefinitionOption {
  return {
    id: `${definition.name}@${definition.version}`,
    label: definition.display?.title ?? definition.name,
    kind: definition.kind,
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
 * @param inputKind - the selected definition's input presentation.
 * @param state - the dialog snapshot (the drafts).
 * @param parseJson - JSON-draft parse (inline validation).
 * @returns the wire input value, or undefined when the draft is unusable
 *   (blank text, or a malformed JSON draft).
 */
function composeInput(
  inputKind: WireDefinition['inputKind'],
  state: NewTaskState,
  parseJson: () => unknown,
): unknown {
  if (inputKind === 'json' || inputKind === null) {
    // A workflow definition carries no wire face (ADR 0012 attaches one to
    // agents), and neither does an engine-native definition: both take the
    // JSON box, where the engine inserts the value as given and the
    // definition's own input contract validates it.
    const parsed = parseJson()
    return parsed instanceof SyntaxError ? undefined : parsed
  }
  const text = state.text.trim()
  return text === '' ? undefined : text
}
