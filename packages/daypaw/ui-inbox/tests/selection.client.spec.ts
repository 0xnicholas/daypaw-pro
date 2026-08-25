/** InboxSelectionController: the shared selection source and the one-way runtime-session drive (task selections only). */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_SELECTION, InboxSelectionController } from '../src/client/selection.ts'

describe('InboxSelectionController', () => {
  it('boots on the running group', () => {
    const controller = new InboxSelectionController(vi.fn())
    expect(controller.store.getSnapshot()).toEqual(DEFAULT_SELECTION)
    expect(DEFAULT_SELECTION).toEqual({ kind: 'group', group: 'running' })
  })

  it('drives the runtime current session only for task selections', () => {
    const openSession = vi.fn()
    const controller = new InboxSelectionController(openSession)
    controller.select({ kind: 'task', sessionId: 's1' as SessionId })
    expect(controller.store.getSnapshot()).toEqual({ kind: 'task', sessionId: 's1' })
    expect(openSession).toHaveBeenCalledWith('s1')
    // A session-less workflow run never touches the runtime current session.
    controller.select({ kind: 'run', runId: 'r1' })
    expect(controller.store.getSnapshot()).toEqual({ kind: 'run', runId: 'r1' })
    controller.select({ kind: 'group', group: 'done' })
    controller.select({ kind: 'agents' })
    controller.select({ kind: 'settings' })
    expect(openSession).toHaveBeenCalledTimes(1)
  })
})
