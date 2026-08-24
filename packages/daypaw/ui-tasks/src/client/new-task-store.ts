/**
 * New-task dialog store: the healthy agent-preset roster (a broken preset can
 * never compose a task, so it is filtered, not shown) and the submit sequence
 * — create the session with the chosen preset, wait for the list projection
 * to carry it, open it, then prompt the first task text. The host stays the
 * single fact source; a failure anywhere lands inline on the dialog.
 */
import type { IApiClient, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISessions, SessionBinding, SessionFace, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** One selectable agent row (healthy presets only). */
export interface AgentOption {
  /** Preset id (also the create payload's agentPreset). */
  id: string
  /** Display name, falling back to the id. */
  label: string
  /** Whether the deployment defaults to this preset. */
  isDefault: boolean
}

/** Dialog snapshot. */
export interface NewTaskState {
  /** Roster load lifecycle; idle until the first dialog open. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Healthy presets in roster order. */
  agents: readonly AgentOption[]
  /** The picked preset id; undefined when the roster is empty or unsettled. */
  selected: string | undefined
  /** The task text draft. */
  text: string
  /** A create→open→prompt sequence is in flight. */
  submitting: boolean
  /** The last submit failed (the dialog shows the generic inline failure); false while clean. */
  submitFailed: boolean
}

/** The wire domains the dialog consumes. */
export type NewTaskApi = Pick<IApiClient, 'agentPresets'> & { sessions: Pick<IApiClient['sessions'], 'create'> }

/** The session binding members the dialog consumes (the first prompt only). */
export type NewTaskBinding = Pick<SessionBinding, 'sessionId'> & { readonly session: Pick<SessionFace, 'prompt'> }

/** The sessions-service members the dialog consumes. */
export type NewTaskSessions = Pick<ISessions, 'list' | 'open'> & {
  /** @param id - session id. @returns its binding, or undefined while unlisted. */
  binding(id: SessionId): NewTaskBinding | undefined
}

/** The new-task dialog controller (one per apply). */
export class NewTaskStore {
  /** The snapshot the dialog renders from (uSES-safe store). */
  readonly store: SnapshotStore<NewTaskState> = createSnapshotStore<NewTaskState>({
    status: 'idle', agents: [], selected: undefined, text: '', submitting: false, submitFailed: false,
  })

  /** Latest roster load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (agentPresets + sessions.create).
   * @param sessions - the sessions service (list projection + open + binding).
   */
  constructor(private readonly api: NewTaskApi, private readonly sessions: NewTaskSessions) {}

  /**
   * Fetch the agent roster: healthy presets only, default preset preselected
   * (first row otherwise). Safe to call again; only an idle dialog skips it.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading' })
    try {
      const response = await this.api.agentPresets.list({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const agents = response.result.value.presets
        .filter(preset => preset.broken === undefined)
        .map(preset => ({ id: preset.id, label: preset.name ?? preset.id, isDefault: preset.isDefault }))
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'ready'
        s.agents = agents
        s.selected = agents.find(agent => agent.isDefault)?.id ?? agents[0]?.id
      })
    } catch {
      if (generation !== this.generation) return
      this.store.update((s) => { s.status = 'error' })
    }
  }

  /** Pick an agent.
   * @param id - the preset id. */
  select(id: string): void {
    this.store.update((s) => { s.selected = id })
  }

  /** Edit the task text draft.
   * @param text - the new draft. */
  setText(text: string): void {
    this.store.update((s) => { s.text = text })
  }

  /**
   * Create the task: session.create with the picked preset, then open +
   * first prompt once the list projection carries the new row. The list wait
   * exists because open() fails loud on an unlisted id and the host's
   * session-added frame races the create response.
   * @returns the new session id, or undefined when the submit was rejected
   *   (guard) or failed (the snapshot flags the inline failure).
   */
  async submit(): Promise<SessionId | undefined> {
    const state = this.store.getSnapshot()
    if (state.submitting || state.status !== 'ready') return undefined
    const text = state.text.trim()
    if (text === '') return undefined
    this.store.update((s) => { s.submitting = true; s.submitFailed = false })
    try {
      const created = await this.api.sessions.create(
        state.selected === undefined ? {} : { agentPreset: state.selected },
      )
      if (!created.result.ok) throw new Error(created.result.error.message)
      const sessionId = created.result.value.sessionId
      await this.whenListed(sessionId)
      this.sessions.open(sessionId)
      const binding = this.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`ui-tasks: created session "${sessionId}" resolved no binding`)
      const prompted = await binding.session.prompt([{ type: 'text', text }], 'queue')
      if (!prompted.ok) throw new Error(prompted.error.message)
      this.store.update((s) => { s.submitting = false; s.text = '' })
      return sessionId
    } catch {
      // Any wire or invariant failure reads as the same generic inline
      // failure; raw host wording never reaches the dialog.
      this.store.update((s) => { s.submitting = false; s.submitFailed = true })
      return undefined
    }
  }

  /** Resolve once the list projection carries the created session. */
  private async whenListed(sessionId: SessionId): Promise<void> {
    if (this.sessions.list.getSnapshot().byId[sessionId] !== undefined) return
    await new Promise<void>((resolve) => {
      const dispose = this.sessions.list.subscribe(() => {
        if (this.sessions.list.getSnapshot().byId[sessionId] === undefined) return
        dispose()
        resolve()
      })
    })
  }
}
