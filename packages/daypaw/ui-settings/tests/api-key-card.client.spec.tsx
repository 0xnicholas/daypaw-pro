// @vitest-environment jsdom
/** ApiKeyCard: the first-run yellow card — undecided states render nothing, visibility drives the composer block seat. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { ApiKeyCard, type ApiKeyCardProps } from '../src/client/api-key-card.tsx'
import { ApiKeyCardStore } from '../src/client/card-store.ts'
import { zh } from '../src/client/locales.ts'
import { FakeHostApi } from './fake-host-api.client.ts'

afterEach(cleanup)

const t: ApiKeyCardProps['t'] = (key, params) =>
  ((zh as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => {
    const value: unknown = params?.[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
const neverHook = (() => { throw new Error('banner must not read framework hooks') }) as never

function mountCard(options: { sessionId?: SessionId; configured?: boolean } = {}) {
  const api = new FakeHostApi()
  const card = new ApiKeyCardStore(api)
  const openSettings = vi.fn()
  const openCredentialsTab = vi.fn()
  const setInputBlock = vi.fn()
  const view = render(
    <ApiKeyCard
      sessionId={options.sessionId}
      useSession={neverHook} useProjection={neverHook}
      useInput={neverHook} inputActions={undefined as never}
      useSessions={neverHook} useWorkspaces={neverHook} useConversation={neverHook} useSessionPendingInteraction={neverHook}
      openSettings={openSettings}
      useCard={bindSnapshotSelector(card.store)}
      openCredentialsTab={openCredentialsTab}
      setInputBlock={setInputBlock}
      t={t}
    />,
  )
  const settle = (ready: { name: string; configured: boolean }): void => {
    act(() => {
      card.store.set({ status: 'ready', name: ready.name, configured: ready.configured })
    })
  }
  return { card, openSettings, openCredentialsTab, setInputBlock, settle, unmount: view.unmount }
}

describe('ApiKeyCard visibility', () => {
  it.each(['idle', 'loading', 'error'] as const)('renders nothing while the check is %s', (status) => {
    const { card } = mountCard()
    act(() => { card.store.update((s) => { s.status = status }) })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing once the key is configured', () => {
    const { settle } = mountCard()
    settle({ name: '小爪', configured: true })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the yellow card while the key is missing, navigating to the credentials tab on click', () => {
    const { settle, openSettings, openCredentialsTab } = mountCard()
    settle({ name: '小爪', configured: false })
    const card = screen.getByText('小爪 需要 API key 才能开始工作').parentElement!
    expect(card).toMatchSnapshot()
    fireEvent.click(screen.getByRole('button', { name: '去设置里配置' }))
    expect(openCredentialsTab).toHaveBeenCalledOnce()
    expect(openSettings).toHaveBeenCalledOnce()
  })
})

describe('ApiKeyCard composer block seat', () => {
  it('raises the block while visible, clears it on dismissal, and clears it again on unmount', () => {
    const sessionId = 's1' as SessionId
    const { settle, setInputBlock, unmount } = mountCard({ sessionId })
    // Mounted undecided: the seat is explicitly clear.
    expect(setInputBlock).toHaveBeenLastCalledWith(sessionId, false)
    settle({ name: '小爪', configured: false })
    expect(setInputBlock).toHaveBeenLastCalledWith(sessionId, true)
    settle({ name: '小爪', configured: true })
    expect(setInputBlock).toHaveBeenLastCalledWith(sessionId, false)
    unmount()
    expect(setInputBlock).toHaveBeenLastCalledWith(sessionId, false)
  })

  it('never touches the block without a current session', () => {
    const { settle, setInputBlock } = mountCard()
    settle({ name: '小爪', configured: false })
    expect(setInputBlock).not.toHaveBeenCalled()
  })
})
