// @vitest-environment jsdom
/** NewTaskDialog: first-open roster load, picker + inputKind-ruled input surfaces + submit gating, success navigation, inline failures. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { NewTaskDialog, type NewTaskDialogProps } from '../src/client/new-task-dialog.tsx'
import { NewTaskStore, type NewTaskSessions } from '../src/client/new-task-store.ts'
import { zh } from '../src/client/locales.ts'
import type { WireStartRunRequest } from '../src/client/new-task-api.ts'
import { FakeTaskApi, fail, ok, definition } from './fake-task-api.client.ts'

afterEach(cleanup)

const t: NewTaskDialogProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('dialog must not read framework hooks') }) as never

/** A sessions double whose list resolves the twin wait the moment startRun answers. */
function sessionsDouble(listOnDemand: () => SessionId | undefined = () => undefined): {
  sessions: NewTaskSessions
  listSession: (id: SessionId) => void
} {
  const list: SnapshotStore<SessionListState> = createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const listSession = (id: SessionId): void => {
    list.update((draft) => {
      draft.ids.push(id)
      draft.byId[id] = { id, displayTitle: id, running: false, blank: true, updatedAt: 1 }
    })
  }
  return { sessions: { list }, listSession: (id) => { void listOnDemand; listSession(id) } }
}

function mountDialog(api: FakeTaskApi, sessions: NewTaskSessions = sessionsDouble().sessions, store?: NewTaskStore) {
  const owned = store ?? new NewTaskStore(api, sessions)
  const openTask = vi.fn()
  const close = vi.fn()
  const view = render(
    <NewTaskDialog
      close={close} openTask={openTask}
      useSessions={neverHook} useWorkspaces={neverHook} useSessionPendingInteraction={neverHook}
      useNewTask={bindSnapshotSelector(owned.store)}
      store={owned} t={t}
    />,
  )
  return { store: owned, openTask, close, view }
}

/** Program the roster with one agent of the given input kind. */
function oneAgent(api: FakeTaskApi, inputKind: 'text' | 'json') {
  api.onListDefinitions = () => Promise.resolve(ok([
    definition('starter-assistant', { version: '1.0.0', display: { title: '通用助手' }, inputKind }),
  ]))
}

describe('NewTaskDialog', () => {
  it('loads the roster on first open and keeps submit disabled until the task text is non-blank', async () => {
    const api = new FakeTaskApi()
    api.onListDefinitions = () => Promise.resolve(ok([
      definition('alpha', { version: '2.0.0' }),
      definition('beta', { version: '0.3.1', display: { title: '周报助手' } }),
    ]))
    mountDialog(api)
    // Loading state: the submit stays disabled while the roster settles.
    expect(screen.getByRole('button', { name: '开始任务' })).toHaveProperty('disabled', true)
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    expect(api.callsOf('durable/listDefinitions')).toHaveLength(1)
    // The first registration-order row is preselected; labels are business names.
    const select = screen.getByRole('combobox', { name: '执行 Agent' }) as HTMLSelectElement
    expect(select.value).toBe('alpha@2.0.0')
    expect(screen.getByRole('option', { name: '周报助手' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'alpha' })).toBeTruthy()
    // Blank/whitespace text keeps submit disabled; typing enables it.
    const textbox = screen.getByRole('textbox', { name: '任务内容' })
    fireEvent.change(textbox, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '开始任务' })).toHaveProperty('disabled', true)
    fireEvent.change(textbox, { target: { value: '写一首诗' } })
    expect(screen.getByRole('button', { name: '开始任务' })).toHaveProperty('disabled', false)
  })

  it('submits a text-kind agent and hands the run session to the owner', async () => {
    const api = new FakeTaskApi()
    oneAgent(api, 'text')
    const twin = sessionsDouble()
    const { openTask } = mountDialog(api, twin.sessions)
    // The twin lands the moment the start answers, mirroring the host frame.
    api.onStartRun = (request) => {
      twin.listSession(request.runId as SessionId)
      return Promise.resolve(ok({ runId: request.runId }))
    }
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    fireEvent.change(screen.getByRole('textbox', { name: '任务内容' }), { target: { value: '写一首诗' } })
    fireEvent.click(screen.getByRole('button', { name: '开始任务' }))
    await waitFor(() => { expect(openTask).toHaveBeenCalledTimes(1) })
    expect(openTask.mock.calls[0]![0]).toBe((api.callsOf('durable/startRun')[0] as WireStartRunRequest).runId)
  })

  it('renders the JSON input surface for a json-kind agent with inline validation', async () => {
    const api = new FakeTaskApi()
    oneAgent(api, 'json')
    const twin = sessionsDouble()
    const { openTask } = mountDialog(api, twin.sessions)
    api.onStartRun = (request) => {
      twin.listSession(request.runId as SessionId)
      return Promise.resolve(ok({ runId: request.runId }))
    }
    await waitFor(() => { expect(screen.getByRole('textbox', { name: '任务 JSON' })).toBeTruthy() })
    expect(screen.queryByRole('textbox', { name: '任务内容' })).toBeNull()
    // Malformed JSON keeps submit disabled and shows the inline error.
    const box = screen.getByRole('textbox', { name: '任务 JSON' })
    fireEvent.change(box, { target: { value: '{oops' } })
    expect(screen.getByText('JSON 格式有误，请检查后重试')).toBeTruthy()
    expect(screen.getByRole('button', { name: '开始任务' })).toHaveProperty('disabled', true)
    fireEvent.change(box, { target: { value: '{"objective":"本周周报"}' } })
    expect(screen.queryByText('JSON 格式有误，请检查后重试')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '开始任务' }))
    await waitFor(() => { expect(openTask).toHaveBeenCalledTimes(1) })
    expect((api.callsOf('durable/startRun')[0] as WireStartRunRequest).input).toEqual({ objective: '本周周报' })
  })

  it('shows the failure inline and does not navigate', async () => {
    const api = new FakeTaskApi()
    oneAgent(api, 'text')
    api.onStartRun = () => Promise.resolve(fail('engine down'))
    const { openTask } = mountDialog(api)
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    fireEvent.change(screen.getByRole('textbox', { name: '任务内容' }), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '开始任务' }))
    await screen.findByText('创建任务失败')
    // Raw wire wording never reaches the dialog (business-language surface).
    expect(screen.queryByText(/engine down/)).toBeNull()
    expect(openTask).not.toHaveBeenCalled()
  })

  it('shows the roster load failure and retries the load on the next open', async () => {
    const api = new FakeTaskApi()
    api.onListDefinitions = () => Promise.resolve(fail('host down'))
    // The store already failed once (the previous open); mounting the dialog
    // again must re-run the load rather than wedge on the error snapshot.
    const store = new NewTaskStore(api, sessionsDouble().sessions)
    await store.load()
    expect(store.store.getSnapshot().status).toBe('error')
    api.onListDefinitions = () => Promise.resolve(ok([definition('alpha')]))
    mountDialog(api, sessionsDouble().sessions, store)
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    expect(screen.getByRole('option', { name: 'alpha' })).toBeTruthy()
  })

  it('renders the empty-roster picker copy and keeps submit disabled', async () => {
    const api = new FakeTaskApi() // default roster: empty
    mountDialog(api)
    await waitFor(() => { expect(screen.getByRole('option', { name: '暂无可用 Agent' })).toBeTruthy() })
    fireEvent.change(screen.getByRole('textbox', { name: '任务内容' }), { target: { value: '做点什么' } })
    expect(screen.getByRole('button', { name: '开始任务' })).toHaveProperty('disabled', true)
    expect(api.callsOf('durable/startRun')).toEqual([])
  })

  it('switches the picked agent through the store', async () => {
    const api = new FakeTaskApi()
    api.onListDefinitions = () => Promise.resolve(ok([definition('alpha', { version: '1' }), definition('beta', { version: '1' })]))
    const { store } = mountDialog(api)
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    fireEvent.change(screen.getByRole('combobox', { name: '执行 Agent' }), { target: { value: 'beta@1' } })
    expect(store.store.getSnapshot().selected).toBe('beta@1')
  })

  it('matches the ready dialog snapshot', async () => {
    const api = new FakeTaskApi()
    oneAgent(api, 'text')
    const { view } = mountDialog(api)
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    expect(view.container).toMatchSnapshot()
  })
})
