// @vitest-environment jsdom
/** WorkspaceSwitch: the middle column switches its container with the shared selection, and delegates the banner/settings holes. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { WorkspaceSwitch, type WorkspaceSwitchProps } from '../src/client/WorkspaceSwitch.tsx'
import type { InboxBannerOwnerProps, InboxSettingsPageOwnerProps } from '../src/client/contract.ts'
import { InboxSelectionController } from '../src/client/selection.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WorkspaceSwitchProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('workspace must not read framework hooks') }) as never

interface RenderedCall {
  key: string
  owner: Record<string, unknown>
  opts: { fallback?: unknown } | undefined
}

function mountWorkspace(renderChild?: (call: RenderedCall) => React.ReactNode) {
  const controller = new InboxSelectionController()
  const calls: RenderedCall[] = []
  const renderSlot: WorkspaceSwitchProps['renderSlot'] = ((key: string, owner: object, opts?: { fallback?: unknown }) => {
    const call: RenderedCall = { key, owner: owner as Record<string, unknown>, opts }
    calls.push(call)
    return renderChild === undefined ? (opts?.fallback ?? null) : renderChild(call)
  }) as never
  render(
    <WorkspaceSwitch
      sessionId={undefined}
      useSession={neverHook} useProjection={neverHook}
      useInput={neverHook} inputActions={undefined as never}
      useSessions={neverHook} useWorkspaces={neverHook}
      useSelection={bindSnapshotSelector(controller.store)}
      select={(next) => { controller.select(next) }}
      renderSlot={renderSlot}
      t={t}
    />,
  )
  return { controller, calls }
}

describe('WorkspaceSwitch', () => {
  it('shows the running group container by default and follows group selection', () => {
    const { controller } = mountWorkspace()
    expect(screen.getByRole('heading', { name: '进行中' })).toBeTruthy()
    expect(screen.getByText('暂无进行中的任务')).toBeTruthy()
    act(() => { controller.select({ kind: 'group', group: 'pending' }) })
    expect(screen.getByRole('heading', { name: '等待你确认' })).toBeTruthy()
    expect(screen.getByText('暂无等待确认的任务')).toBeTruthy()
    act(() => { controller.select({ kind: 'group', group: 'done' }) })
    expect(screen.getByRole('heading', { name: '已完成' })).toBeTruthy()
    expect(screen.getByText('暂无已完成的任务')).toBeTruthy()
  })

  it('switches to the Agents placeholder page', () => {
    const { controller } = mountWorkspace()
    act(() => { controller.select({ kind: 'agents' }) })
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(screen.getByText('Agent 目录即将上线')).toBeTruthy()
  })

  it('renders the banner strip atop every group container with an openSettings that selects settings', () => {
    const { controller, calls } = mountWorkspace(call =>
      call.key === 'inbox.workspace.banner' ? <div>banner-seat</div> : null)
    expect(screen.getByText('banner-seat')).toBeTruthy()
    const banner = calls.find(call => call.key === 'inbox.workspace.banner')!
    ;(banner.owner as unknown as InboxBannerOwnerProps).openSettings()
    expect(controller.store.getSnapshot()).toEqual({ kind: 'settings' })
    // Group containers for other selections carry the strip too.
    act(() => { controller.select({ kind: 'group', group: 'pending' }) })
    expect(screen.getByText('banner-seat')).toBeTruthy()
  })

  it('renders the settings page slot for the settings selection, falling back to the placeholder when empty', () => {
    const { controller } = mountWorkspace()
    act(() => { controller.select({ kind: 'settings' }) })
    // Empty slot: the owner's placeholder copy stays.
    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
    expect(screen.getByText('设置页即将上线')).toBeTruthy()
  })

  it('hands the settings page a close owner that returns to the running group', () => {
    const { controller, calls } = mountWorkspace(call =>
      call.key === 'inbox.settings.page' ? <div>settings-page</div> : (call.opts?.fallback ?? null) as React.ReactNode)
    act(() => { controller.select({ kind: 'settings' }) })
    expect(screen.getByText('settings-page')).toBeTruthy()
    expect(screen.queryByText('设置页即将上线')).toBeNull()
    const page = calls.find(call => call.key === 'inbox.settings.page')!
    ;(page.owner as unknown as InboxSettingsPageOwnerProps).close()
    expect(controller.store.getSnapshot()).toEqual({ kind: 'group', group: 'running' })
  })
})
