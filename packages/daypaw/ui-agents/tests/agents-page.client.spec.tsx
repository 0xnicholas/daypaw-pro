// @vitest-environment jsdom
/** AgentsPage: the load lifecycle states, the card grid, and the detail view (name@version identity, no version operations). */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { AgentsPage, type AgentsPageProps } from '../src/client/agents-page.tsx'
import { CatalogStore } from '../src/client/catalog-store.ts'
import type { CatalogApi } from '../src/client/definitions-api.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: AgentsPageProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('the catalog page must not read session hooks') }) as never

const CARDS_API: CatalogApi = {
  listDefinitions: () => Promise.resolve([
    { kind: 'agent', name: 'weekly-report', version: '1.2.0', display: { title: '周报助手', description: '汇总本周进展，生成周报草稿。' } },
    { kind: 'agent', name: 'invoice-checker', version: '0.3.1' },
  ]),
}

function mountPage(api: CatalogApi = CARDS_API) {
  const store = new CatalogStore(api)
  render(
    <AgentsPage
      sessionId={undefined}
      useSession={neverHook} useProjection={neverHook}
      useInput={neverHook} inputActions={undefined as never}
      useSessions={neverHook} useWorkspaces={neverHook}
      useCatalog={bindSnapshotSelector(store.store)}
      store={store}
      t={t}
    />,
  )
  return store
}

describe('AgentsPage', () => {
  it('loads on first open and renders the catalog cards (title + description, technical-name fallback)', async () => {
    mountPage()
    // The loading state shows while the wire call is in flight.
    expect(screen.getByText('正在加载…')).toBeTruthy()
    const card = await screen.findByRole('button', { name: /周报助手/ })
    expect(card.textContent).toContain('汇总本周进展，生成周报草稿。')
    // The undeclared definition falls back to its technical name and renders
    // no empty description row.
    const plain = screen.getByRole('button', { name: 'invoice-checker' })
    expect(plain.querySelectorAll('p')).toHaveLength(0)
  })

  it('opens the detail view with the name@version identity and no version operation', async () => {
    mountPage()
    const card = await screen.findByRole('button', { name: /周报助手/ })
    act(() => { card.click() })
    expect(screen.getByRole('heading', { name: '周报助手' })).toBeTruthy()
    expect(screen.getByText('weekly-report@1.2.0')).toBeTruthy()
    // v1: the only action is leaving the detail — no version controls.
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['返回目录'])
    act(() => { screen.getByRole('button', { name: '返回目录' }).click() })
    expect(screen.getByRole('button', { name: /周报助手/ })).toBeTruthy()
  })

  it('renders the empty state when the registry holds no agent definitions', async () => {
    mountPage({ listDefinitions: () => Promise.resolve([{ kind: 'workflow', name: 'close-the-books', version: '2.0.0' }]) })
    expect(await screen.findByText('暂无可用 Agent')).toBeTruthy()
  })

  it('renders the inline failure when the roster load fails', async () => {
    mountPage({ listDefinitions: () => Promise.reject(new Error('boom')) })
    expect(await screen.findByText('Agent 目录加载失败')).toBeTruthy()
  })

  it('renders the grid when the selection names a card the roster no longer carries', async () => {
    const store = mountPage()
    await screen.findByRole('button', { name: /周报助手/ })
    act(() => {
      store.store.update((s) => { s.selected = 'ghost@0' })
    })
    // The orphaned selection falls back to the grid rather than a blank page.
    expect(screen.getByRole('button', { name: /周报助手/ })).toBeTruthy()
  })
})
