/** daypaw tasks apply: the three ui-inbox seats, the dictionaries, the shared new-task store, and teardown. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionListState, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNodeHalf } from '../src/index.ts'
import { NewTaskDialog, type NewTaskDialogInjected } from '../src/client/new-task-dialog.tsx'
import { TaskList } from '../src/client/task-list.tsx'
import { ConversationView, type ConversationViewInjected } from '../src/client/conversation-view.tsx'
import { DetailBody } from '../src/client/detail-body.tsx'
import { FakeTaskApi } from './fake-task-api.client.ts'

// The locale service reads its initial locale from the browser; these specs
// assert the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const api = new FakeTaskApi()
  ctx.provide('connection', { api } as never)
  const list: SnapshotStore<SessionListState> = createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const sessions = { list, open: vi.fn(), binding: vi.fn() }
  ctx.provide('sessions', sessions as never)
  const slots = ctx.get('slots') as SlotRegistry
  // The frame's root declaration, as ui-layout's root registration makes it.
  slots.register(
    {
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
      },
    } as never,
    () => null,
  )
  // The ui-inbox occupants' declarations, as InboxNav and WorkspaceSwitch make them.
  slots.register(
    { name: 'sidebar', children: { 'inbox.new-task.dialog': { kind: 'single', scope: 'root' } } } as never,
    () => null,
  )
  slots.register(
    {
      name: 'conversation',
      children: {
        'inbox.workspace.tasks': { kind: 'single', scope: 'root' },
        'inbox.workspace.conversation': { kind: 'single', scope: 'session-maybe' },
      },
    } as never,
    () => null,
  )
  // The TaskDetail occupant's declaration, as ui-inbox's 'details' registration makes it.
  slots.register(
    { name: 'details', children: { 'inbox.detail.body': { kind: 'single', scope: 'session' } } } as never,
    () => null,
  )
  return { ctx, slots, locale, api, sessions }
}

describe('ui-tasks apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'sessions'])
  })

  it('the node half provides no host-side behavior', () => {
    applyNodeHalf()
  })

  it('occupies the four ui-inbox seats once their owners declare them', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const dialog = b.slots.entriesOfSlot('inbox.new-task.dialog')[0]!
    expect(dialog.component).toBe(NewTaskDialog)
    expect(dialog.locale).toBe('daypaw-tasks')
    expect(b.slots.entriesOfSlot('inbox.workspace.tasks')[0]!.component).toBe(TaskList)
    expect(b.slots.entriesOfSlot('inbox.workspace.conversation')[0]!.component).toBe(ConversationView)
    expect(b.slots.entriesOfSlot('inbox.detail.body')[0]!.component).toBe(DetailBody)
    // The dictionaries answer in the browser's zh locale.
    expect(b.locale.bind('daypaw-tasks')('list.empty')).toBe('暂无任务')
  })

  it('binds the dialog inject face to one shared new-task store', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (b.slots.entriesOfSlot('inbox.new-task.dialog')[0]!.inject as unknown as () => NewTaskDialogInjected)()
    expect(face.hooks.newTask).toBe(face.store.store)
    face.store.setText('写一首诗')
    expect(face.hooks.newTask.getSnapshot().text).toBe('写一首诗')
  })

  it('the conversation inject face sendNote queues the note through the session binding', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const face = (b.slots.entriesOfSlot('inbox.workspace.conversation')[0]!.inject as unknown as () => ConversationViewInjected)()
    const prompt = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
    b.sessions.binding.mockReturnValue({ session: { prompt } })
    await face.sendNote('s1' as never, '先别删')
    expect(b.sessions.binding).toHaveBeenCalledWith('s1')
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '先别删' }], 'queue')
    // Fail loud: an unlisted session throws; a rejected prompt throws.
    b.sessions.binding.mockReturnValue(undefined)
    await expect(face.sendNote('ghost' as never, 'x')).rejects.toThrow('resolved no binding')
    b.sessions.binding.mockReturnValue({ session: { prompt: () => Promise.resolve({ ok: false as const, error: { code: 'agent-busy', message: 'busy' } }) } })
    await expect(face.sendNote('s1' as never, 'x')).rejects.toThrow('busy')
  })

  it('removes every entry and frees the dictionary seats on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('inbox.new-task.dialog')).toHaveLength(0)
    expect(b.slots.entries('inbox.workspace.tasks')).toHaveLength(0)
    expect(b.slots.entries('inbox.workspace.conversation')).toHaveLength(0)
    expect(b.slots.entries('inbox.detail.body')).toHaveLength(0)
    // The (ns, locale) seats are free again — the dictionary disposers ran.
    expect(() => b.locale.register('daypaw-tasks', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('daypaw-tasks', 'en', {})).not.toThrow()
  })
})
