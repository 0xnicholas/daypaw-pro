// @vitest-environment jsdom
/** SettingsPage: the four-tab rail — 通用 locale row, 凭据 inline editor, 模型 slot delegation, 关于 diagnostics copy. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import { SettingsPage, type SettingsPageProps } from '../src/client/settings-page.tsx'
import { SettingsTabController } from '../src/client/tab-store.ts'
import { createThemeRowStore } from '../src/client/theme-row.ts'
import { CredentialsStore } from '../src/client/provider-keys.ts'
import { AboutStore } from '../src/client/about-store.ts'
import { zh } from '../src/client/locales.ts'
import { FakeHostApi, fail, ok, providerView } from './fake-host-api.client.ts'

afterEach(cleanup)

const t: SettingsPageProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('settings page must not read framework hooks') }) as never

/** Fixed zh locale source (one frozen snapshot: uSES requires a stable reference); the setLocale spy records writes. */
const localeSnapshot: LocaleSnapshot = Object.freeze({
  active: 'zh' as never,
  locales: Object.freeze([{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }]) as never,
  revision: 0,
})
const localeSource = {
  getSnapshot: (): LocaleSnapshot => localeSnapshot,
  subscribe: () => () => {},
}

interface SectionCall {
  owner: Record<string, unknown>
  opts: { only?: string } | undefined
}

function mountPage(api: FakeHostApi) {
  const tabs = new SettingsTabController()
  const credentials = new CredentialsStore(api)
  const about = new AboutStore(api)
  const themeRow = createThemeRowStore({ preference: 'light' })
  const setLocale = vi.fn()
  const setTheme = vi.fn()
  const close = vi.fn()
  const sectionCalls: SectionCall[] = []
  const renderSlot: SettingsPageProps['renderSlot'] = ((_key: string, owner: object, opts?: { only?: string }) => {
    sectionCalls.push({ owner: owner as Record<string, unknown>, opts })
    return <div>models-section-seat</div>
  }) as never
  const view = render(
    <SettingsPage
      sessionId={undefined}
      useSession={neverHook} useProjection={neverHook}
      useInput={neverHook} inputActions={undefined as never}
      useSessions={neverHook} useWorkspaces={neverHook}
      close={close}
      renderSlot={renderSlot}
      useTab={bindSnapshotSelector(tabs.store)}
      useCredentials={bindSnapshotSelector(credentials.store)}
      useAbout={bindSnapshotSelector(about.store)}
      useLocale={bindSnapshotSelector(localeSource)}
      useTheme={bindSnapshotSelector(themeRow)}
      selectTab={(tab) => { tabs.select(tab) }}
      credentialsStore={credentials}
      aboutStore={about}
      setLocale={setLocale}
      setTheme={setTheme}
      t={t}
    />,
  )
  return { tabs, credentials, about, themeRow, setLocale, setTheme, close, sectionCalls, view }
}

/** Program one provider whose credential answer the case controls. */
function programProvider(api: FakeHostApi, configured: boolean, writable = true): void {
  api.onProviders = () => Promise.resolve(ok({ providers: [providerView('deepseek', 'DeepSeek')] }))
  api.onDescribeCredentials = () => Promise.resolve(ok({
    credentials: configured ? { DEEPSEEK_API_KEY: { configured: true, writable } } : {},
  }))
}

/** Open the 凭据 tab and wait for its first load to land. */
async function openCredentialsTab(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '凭据' }))
  await screen.findByText('按服务商配置 API key。')
  await screen.findByText('DeepSeek')
}

describe('SettingsPage rail', () => {
  it('opens on 通用 and follows every tab selection', async () => {
    const api = new FakeHostApi()
    const { tabs } = mountPage(api)
    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
    expect(screen.getByText('语言')).toBeTruthy()
    for (const [label, tab] of [['凭据', 'credentials'], ['模型', 'models'], ['关于', 'about'], ['通用', 'general']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(tabs.store.getSnapshot()).toBe(tab)
    }
    expect(screen.getByText('语言')).toBeTruthy()
  })

  it('switches the locale through the select', () => {
    const api = new FakeHostApi()
    const { setLocale } = mountPage(api)
    fireEvent.change(screen.getByRole('combobox', { name: '语言' }), { target: { value: 'en' } })
    expect(setLocale).toHaveBeenCalledWith('en')
  })

  it('shows the theme preference row with the light default and routes the switch', () => {
    const api = new FakeHostApi()
    const { setTheme, themeRow } = mountPage(api)
    const select = screen.getByRole('combobox', { name: '主题' }) as HTMLSelectElement
    expect([...select.options].map(option => option.textContent)).toEqual(['浅色', '深色', '跟随系统'])
    expect(select.value).toBe('light')
    fireEvent.change(select, { target: { value: 'system' } })
    expect(setTheme).toHaveBeenCalledWith('system')
    // The row renders the mirrored preference, never the resolved theme.
    act(() => { themeRow.set({ preference: 'dark' }) })
    const reloaded = screen.getByRole('combobox', { name: '主题' }) as HTMLSelectElement
    expect(reloaded.value).toBe('dark')
  })
})

describe('SettingsPage 凭据 tab', () => {
  it('loads on first open and marks an unconfigured provider with the warning dot', async () => {
    const api = new FakeHostApi()
    programProvider(api, false)
    mountPage(api)
    await openCredentialsTab()
    expect(screen.getByRole('img', { name: '未配置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
  })

  it('saves a key through the wire, reloads, and closes the editor', async () => {
    const api = new FakeHostApi()
    programProvider(api, false)
    mountPage(api)
    await openCredentialsTab()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.change(screen.getByLabelText('DeepSeek'), { target: { value: '  sk-test  ' } })
    // The wire answers configured after the write lands.
    programProvider(api, true)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('已配置')
    expect(api.callsOf('credentials.set')).toEqual([{ ref: 'DEEPSEEK_API_KEY', value: 'sk-test' }])
    expect(screen.queryByLabelText('DeepSeek')).toBeNull()
  })

  it('ignores a blank draft', async () => {
    const api = new FakeHostApi()
    programProvider(api, false)
    mountPage(api)
    await openCredentialsTab()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(api.callsOf('credentials.set')).toEqual([])
  })

  it('pins a failed save to its row and closes the editor on cancel', async () => {
    const api = new FakeHostApi()
    programProvider(api, false)
    api.onSet = () => Promise.resolve(fail('read-only layer'))
    mountPage(api)
    await openCredentialsTab()
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.change(screen.getByLabelText('DeepSeek'), { target: { value: 'sk-test' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('read-only layer')
    // The editor stays open with the failure; cancel closes both.
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByLabelText('DeepSeek')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers update and remove on a configured writable row and reports a failed remove', async () => {
    const api = new FakeHostApi()
    programProvider(api, true)
    api.onUnset = () => Promise.resolve(fail('cannot remove'))
    mountPage(api)
    await openCredentialsTab()
    expect(screen.getByRole('button', { name: '更新' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    await screen.findByRole('alert')
    expect(api.callsOf('credentials.unset')).toEqual([{ ref: 'DEEPSEEK_API_KEY' }])
    expect(screen.getByRole('alert').textContent).toBe('cannot remove')
  })

  it('hides the remove button on a configured read-only row', async () => {
    const api = new FakeHostApi()
    programProvider(api, true, false)
    mountPage(api)
    await openCredentialsTab()
    expect(screen.getByRole('button', { name: '更新' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '移除' })).toBeNull()
  })

  it('removes a key and reloads without pinning any row failure', async () => {
    const api = new FakeHostApi()
    programProvider(api, true)
    mountPage(api)
    await openCredentialsTab()
    programProvider(api, false)
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    await screen.findByRole('img', { name: '未配置' })
    expect(api.callsOf('credentials.unset')).toEqual([{ ref: 'DEEPSEEK_API_KEY' }])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders the failure row even when the error text is absent', async () => {
    const api = new FakeHostApi()
    const { tabs, credentials } = mountPage(api)
    act(() => {
      tabs.select('credentials')
      credentials.store.update((s) => { s.status = 'error' })
    })
    expect(screen.getByRole('alert').textContent).toBe('凭据加载失败: ')
  })

  it('shows the load failure with a retry that reloads', async () => {
    const api = new FakeHostApi()
    api.onProviders = () => Promise.resolve(fail('directory down'))
    mountPage(api)
    fireEvent.click(screen.getByRole('button', { name: '凭据' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('凭据加载失败')
    programProvider(api, false)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('DeepSeek')
  })
})

describe('SettingsPage 模型 tab', () => {
  it('delegates to the settings.section slot with the page close owner and the models filter', () => {
    const api = new FakeHostApi()
    const { close, sectionCalls } = mountPage(api)
    fireEvent.click(screen.getByRole('button', { name: '模型' }))
    expect(screen.getByText('models-section-seat')).toBeTruthy()
    expect(sectionCalls).toHaveLength(1)
    expect(sectionCalls[0]!.opts).toEqual({ only: 'models' })
    expect(sectionCalls[0]!.owner.close).toBe(close)
  })
})

describe('SettingsPage 关于 tab', () => {
  function programHost(api: FakeHostApi, extra: { provider?: string; model?: string } = {}): void {
    api.onHostDescribe = () => Promise.resolve(ok({
      version: '1.2.3', cwd: '/work', attachedSessions: 0, canOpenPath: true, ...extra,
    }))
  }

  function stubClipboard(writeText: (text: string) => Promise<void>): { writeText: ReturnType<typeof vi.fn> } {
    const clipboard = { writeText: vi.fn(writeText) }
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
    return clipboard
  }

  it('shows the host facts and copies the diagnostics block', async () => {
    const api = new FakeHostApi()
    programHost(api, { provider: 'deepseek', model: 'deepseek-chat' })
    const clipboard = stubClipboard(() => Promise.resolve())
    mountPage(api)
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    await screen.findByText('1.2.3')
    expect(screen.getByText('/work')).toBeTruthy()
    expect(screen.getByText('deepseek / deepseek-chat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '复制诊断信息' }))
    await screen.findByRole('button', { name: '已复制' })
    expect(clipboard.writeText).toHaveBeenCalledWith(
      'version: 1.2.3\ncwd: /work\nprovider: deepseek\nmodel: deepseek-chat\nattachedSessions: 0',
    )
  })

  it('names the provider alone when the host names no model, and omits the model row without a provider', async () => {
    const api = new FakeHostApi()
    programHost(api, { provider: 'deepseek' })
    mountPage(api)
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    await screen.findByText('deepseek')
    expect(screen.queryByText('deepseek / deepseek-chat')).toBeNull()
    cleanup()
    const second = new FakeHostApi()
    programHost(second)
    const { view } = mountPage(second)
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    await screen.findByText('1.2.3')
    // The tab rail's 模型 button always exists; the about section must not gain a model row.
    const section = view.container.querySelector('section')!
    expect(within(section).queryByText('模型')).toBeNull()
  })

  it('reports a clipboard rejection', async () => {
    const api = new FakeHostApi()
    programHost(api)
    stubClipboard(() => Promise.reject(new Error('denied')))
    mountPage(api)
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    await screen.findByText('1.2.3')
    fireEvent.click(screen.getByRole('button', { name: '复制诊断信息' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('复制失败')
  })

  it('shows the load failure with a retry', async () => {
    const api = new FakeHostApi()
    api.onHostDescribe = () => Promise.resolve(fail('describe down'))
    mountPage(api)
    fireEvent.click(screen.getByRole('button', { name: '关于' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('诊断信息加载失败')
    programHost(api)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('1.2.3')
  })

  it('renders the failure row even when the error text is absent', async () => {
    const api = new FakeHostApi()
    const { tabs, about } = mountPage(api)
    act(() => {
      tabs.select('about')
      about.store.update((s) => { s.status = 'error' })
    })
    expect(screen.getByRole('alert').textContent).toBe('诊断信息加载失败: ')
  })
})
