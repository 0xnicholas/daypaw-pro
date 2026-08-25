/** Inbox workbench slot registrations: three columns, shared selection driving the runtime current session, shadowing, teardown. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNodeHalf } from '../src/index.ts'
import type { InboxNavInjected } from '../src/client/InboxNav.tsx'
import type { WorkspaceSwitchInjected } from '../src/client/WorkspaceSwitch.tsx'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleSidebar: vi.fn() }
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const sessions = { open: vi.fn() }
  ctx.provide('sessions', sessions as never)
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    // The frame's declarations, as ui-layout's root registration makes them.
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
  }
  return { ctx, slots, layout, sessions }
}

describe('ui-inbox apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale', 'sessions'])
  })

  it('the node half provides no host-side behavior', () => {
    applyNodeHalf()
  })

  it('occupies the three columns, shadowing the priority-0 placeholder occupants', async () => {
    const b = await bench()
    // Placeholder occupants at the default priority, as ui-conversation registers them.
    b.slots.register({ name: 'conversation' } as never, () => null)
    b.slots.register({ name: 'details' } as never, () => null)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar')).toHaveLength(1)
    expect(b.slots.entries('conversation')).toHaveLength(2)
    expect(b.slots.entries('details')).toHaveLength(2)
    // Lowest live priority renders: the -1 occupants win both cells.
    expect(b.slots.entriesOfSlot('conversation')[0]?.options.priority).toBe(-1)
    expect(b.slots.entriesOfSlot('details')[0]?.options.priority).toBe(-1)
    // The nav occupant declares the new-task dialog hole it renders.
    const navEntry = b.slots.entriesOfSlot('sidebar')[0]!
    expect(Object.keys(navEntry.children ?? {})).toEqual(['inbox.new-task.dialog'])
    expect(b.slots.snapshot('inbox.new-task.dialog')).toMatchObject([{ kind: 'single', scope: 'root' }])
    // The workspace occupant declares the five child holes it renders.
    const workspaceEntry = b.slots.entriesOfSlot('conversation')[0]!
    expect(Object.keys(workspaceEntry.children ?? {})).toEqual([
      'inbox.workspace.banner', 'inbox.settings.page', 'inbox.agents.page', 'inbox.workspace.tasks', 'inbox.workspace.conversation',
    ])
    expect(b.slots.snapshot('inbox.workspace.banner')).toMatchObject([{ kind: 'list', scope: 'session-maybe' }])
    expect(b.slots.snapshot('inbox.settings.page')).toMatchObject([{ kind: 'single', scope: 'session-maybe' }])
    expect(b.slots.snapshot('inbox.agents.page')).toMatchObject([{ kind: 'single', scope: 'session-maybe' }])
    expect(b.slots.snapshot('inbox.workspace.tasks')).toMatchObject([{ kind: 'single', scope: 'root' }])
    expect(b.slots.snapshot('inbox.workspace.conversation')).toMatchObject([{ kind: 'single', scope: 'session-maybe' }])
    // Copy rides the standard locale seat on our three occupants (the
    // placeholder dummies above carry none).
    expect(b.slots.entries('sidebar')[0]?.locale).toBe('inbox')
    expect(b.slots.entriesOfSlot('conversation')[0]?.locale).toBe('inbox')
    expect(b.slots.entriesOfSlot('details')[0]?.locale).toBe('inbox')
  })

  it('shares one selection source across the nav and workspace inject faces', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const navFace = (b.slots.entries('sidebar')[0]!.inject as unknown as () => InboxNavInjected)()
    const workspaceEntry = b.slots.entries('conversation').find(e => e.options.priority === -1)!
    const workspaceFace = (workspaceEntry.inject as unknown as () => WorkspaceSwitchInjected)()
    expect(navFace.hooks.selection).toBe(workspaceFace.hooks.selection)
    expect(navFace.hooks.selection.getSnapshot()).toEqual({ kind: 'group', group: 'running' })
    navFace.select({ kind: 'agents' })
    expect(workspaceFace.hooks.selection.getSnapshot()).toEqual({ kind: 'agents' })
    // The workspace inject face carries the same selector for its slot owners.
    workspaceFace.select({ kind: 'settings' })
    expect(navFace.hooks.selection.getSnapshot()).toEqual({ kind: 'settings' })
    navFace.toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('drives the runtime current session one-way when a task is selected', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const navFace = (b.slots.entries('sidebar')[0]!.inject as unknown as () => InboxNavInjected)()
    navFace.select({ kind: 'task', sessionId: 's1' as SessionId })
    expect(navFace.hooks.selection.getSnapshot()).toEqual({ kind: 'task', sessionId: 's1' })
    expect(b.sessions.open).toHaveBeenCalledWith('s1')
    // Group and page selections never touch the runtime current session.
    navFace.select({ kind: 'group', group: 'done' })
    navFace.select({ kind: 'settings' })
    expect(b.sessions.open).toHaveBeenCalledTimes(1)
  })

  it('fails when no live owner declared the frame slots', async () => {
    const b = await bench(false)
    await expect(b.ctx.plugin({ inject: [...inject], apply })).rejects.toThrow(/not declared/)
  })

  it('removes every entry and collapses the declared child slots on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar')).toHaveLength(0)
    expect(b.slots.entries('conversation')).toHaveLength(0)
    expect(b.slots.entries('details')).toHaveLength(0)
    expect(b.slots.snapshot('inbox.new-task.dialog')).toEqual([])
    expect(b.slots.snapshot('inbox.workspace.banner')).toEqual([])
    expect(b.slots.snapshot('inbox.settings.page')).toEqual([])
    expect(b.slots.snapshot('inbox.workspace.tasks')).toEqual([])
    expect(b.slots.snapshot('inbox.workspace.conversation')).toEqual([])
  })
})
