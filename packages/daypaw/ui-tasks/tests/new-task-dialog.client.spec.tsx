// @vitest-environment jsdom
/** NewTaskDialog: first-open roster load, picker + draft + submit gating, success navigation, inline failures. */
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
import { FakeTaskApi, fail, ok, preset } from './fake-task-api.client.ts'

afterEach(cleanup)

const t: NewTaskDialogProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('dialog must not read framework hooks') }) as never
const FX_NEW = 'fx-new' as SessionId

function sessionsDouble(): NewTaskSessions {
  // The fake host's created row ('fx-new') is listed up front, so the store's
  // whenListed wait resolves immediately — the list-wait race itself is the
  // store spec's beat.
  const list: SnapshotStore<SessionListState> = createSnapshotStore<SessionListState>({
    ids: [FX_NEW],
    byId: { [FX_NEW]: { id: FX_NEW, displayTitle: 'fx-new', running: false, blank: true, updatedAt: 1 } },
    current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  return {
    list,
    open: () => {},
    binding: id => ({
      sessionId: id,
      session: { prompt: () => Promise.resolve({ ok: true as const, value: { accepted: true as const } }) },
    }),
  }
}

function mountDialog(api: FakeTaskApi) {
  const store = new NewTaskStore(api, sessionsDouble())
  const openTask = vi.fn()
  const close = vi.fn()
  const view = render(
    <NewTaskDialog
      close={close} openTask={openTask}
      useSessions={neverHook} useWorkspaces={neverHook} useSessionPendingInteraction={neverHook}
      useNewTask={bindSnapshotSelector(store.store)}
      store={store} t={t}
    />,
  )
  return { store, openTask, close, view }
}

describe('NewTaskDialog', () => {
  it('loads the roster on first open and keeps submit disabled until the task text is non-blank', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(ok({ presets: [
      preset('alpha'), preset('beta', { name: 'Beta Agent', isDefault: true }),
    ], authorable: false, hasDocument: false }))
    mountDialog(api)
    // Loading state: the submit stays disabled while the roster settles.
    expect(screen.getByRole('button', { name: '开始任务' })).toHaveProperty('disabled', true)
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    expect(api.callsOf('agentPresets.list')).toHaveLength(1)
    // The deployment default is preselected by its display name.
    const select = screen.getByRole('combobox', { name: '执行 Agent' }) as HTMLSelectElement
    expect(select.value).toBe('beta')
    expect(screen.getByRole('option', { name: 'Beta Agent' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'alpha' })).toBeTruthy()
    // Blank/whitespace text keeps submit disabled; typing enables it.
    const textbox = screen.getByRole('textbox', { name: '任务内容' })
    fireEvent.change(textbox, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '开始任务' })).toHaveProperty('disabled', true)
    fireEvent.change(textbox, { target: { value: '写一首诗' } })
    expect(screen.getByRole('button', { name: '开始任务' })).toHaveProperty('disabled', false)
  })

  it('submits and hands the new task to the owner', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(ok({ presets: [preset('alpha', { isDefault: true })], authorable: false, hasDocument: false }))
    const { openTask } = mountDialog(api)
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    fireEvent.change(screen.getByRole('textbox', { name: '任务内容' }), { target: { value: '写一首诗' } })
    fireEvent.click(screen.getByRole('button', { name: '开始任务' }))
    // The submitting label shows while the sequence runs.
    await waitFor(() => { expect(openTask).toHaveBeenCalledWith('fx-new') })
    expect(api.callsOf('agentPresets.select')).toEqual([{ sessionId: 'fx-new', agentPreset: 'alpha' }])
  })

  it('shows the failure inline and does not navigate', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(ok({ presets: [preset('alpha', { isDefault: true })], authorable: false, hasDocument: false }))
    api.onCreateSession = () => Promise.resolve(fail('create down'))
    const { openTask } = mountDialog(api)
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    fireEvent.change(screen.getByRole('textbox', { name: '任务内容' }), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '开始任务' }))
    await screen.findByText('创建任务失败')
    // Raw wire wording never reaches the dialog (business-language surface).
    expect(screen.queryByText(/preset unknown/)).toBeNull()
    expect(openTask).not.toHaveBeenCalled()
  })

  it('shows the roster load failure and a disabled empty picker', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(fail('host down'))
    mountDialog(api)
    await screen.findByText('Agent 列表加载失败')
    expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', true)
  })

  it('renders the empty-roster picker copy and allows preset-free submit', async () => {
    const api = new FakeTaskApi() // default roster: empty
    const { openTask } = mountDialog(api)
    await waitFor(() => { expect(screen.getByRole('option', { name: '暂无可用 Agent' })).toBeTruthy() })
    fireEvent.change(screen.getByRole('textbox', { name: '任务内容' }), { target: { value: '做点什么' } })
    fireEvent.click(screen.getByRole('button', { name: '开始任务' }))
    await waitFor(() => { expect(openTask).toHaveBeenCalledWith('fx-new') })
    expect(api.callsOf('session.create')).toEqual([undefined])
  })

  it('switches the picked agent through the store', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(ok({ presets: [preset('alpha', { isDefault: true }), preset('beta')], authorable: false, hasDocument: false }))
    const { store } = mountDialog(api)
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    fireEvent.change(screen.getByRole('combobox', { name: '执行 Agent' }), { target: { value: 'beta' } })
    expect(store.store.getSnapshot().selected).toBe('beta')
  })

  it('matches the ready dialog snapshot', async () => {
    const api = new FakeTaskApi()
    api.onPresetList = () => Promise.resolve(ok({ presets: [preset('alpha', { isDefault: true })], authorable: false, hasDocument: false }))
    const { view } = mountDialog(api)
    await waitFor(() => { expect(screen.getByRole('combobox', { name: '执行 Agent' })).toHaveProperty('disabled', false) })
    expect(view.container).toMatchSnapshot()
  })
})
