// Shared scaffolding for the daypaw assembled-jsdom snapshots: the real built
// workspace `lib/client.js` artifacts of the fork roster (packages/daypaw/
// web-app/cordis.patch.yml's client rows) booted through AppWebEntry's
// ModuleLoader path (loadBundle) against the keyless FixtureApiClient
// transport. Every file that mounts this graph needs the same boot entry list,
// the same bundle map, the same jsdom globals, and the same mount call, and
// differs only in what it asserts afterwards, so the scaffolding lives here
// (the apps/web/tests/assembled-boot.ts precedent with the fork roster).
//
// Keyless and deterministic: the fixture is the fake server, so nothing here
// reaches a model or the network.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import type { WebBootEntry } from '@deepseek-ai/dsh-client-modules/client'
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

/** Boot entries for the fork's assembled graph, each carrying the workspace bundle it loads. */
const PLUGINS: readonly (WebBootEntry & { bundlePath: string })[] = [
  { id: '@deepseek-ai/dsh-typert-registry', bundlePath: 'packages/typert/registry/lib/client.js', url: '/plugins/typert-registry.js', rev: 'fx', inject: [], immediately: true },
  { id: '@deepseek-ai/dsh-client-connection', bundlePath: 'packages/client/connection/lib/client.js', url: '/plugins/connection.js', rev: 'fx', inject: [], immediately: true },
  { id: '@deepseek-ai/dsh-api-gateway', bundlePath: 'packages/api/gateway/lib/client.js', url: '/plugins/api-gateway.js', rev: 'fx', inject: ['@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-client-connection'], immediately: true },
  { id: '@deepseek-ai/dsh-api-remotes', bundlePath: 'packages/api/remotes/lib/client.js', url: '/plugins/api-remotes.js', rev: 'fx', inject: ['@deepseek-ai/dsh-api-gateway'], immediately: true },
  // The settings domain base: the only provider of ctx.settingsScope, which the
  // locale and ui-theme rows below inject for their preference rows. Without it
  // both stay pending and ui-layout never activates, so nothing renders.
  { id: '@deepseek-ai/dsh-client-ui-settings', bundlePath: 'packages/client/ui-settings/lib/client.js', url: '/plugins/ui-settings.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-api-remotes'], immediately: true },
  { id: '@deepseek-ai/dsh-client-runtime', bundlePath: 'packages/client/runtime/lib/client.js', url: '/plugins/runtime.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-api-remotes'], immediately: true },
  { id: '@deepseek-ai/dsh-client-ui-theme', bundlePath: 'packages/client/ui-theme/lib/client.js', url: '/plugins/ui-theme.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-api-remotes'], immediately: true },
  { id: '@deepseek-ai/dsh-client-locale', bundlePath: 'packages/client/locale/lib/client.js', url: '/plugins/locale.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-api-remotes'], immediately: true },
  { id: '@deepseek-ai/dsh-client-ui-layout', bundlePath: 'packages/client/ui-layout/lib/client.js', url: '/plugins/ui-layout.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-theme'] },
  // The brand token layer rides the theme service; asserting it needs the
  // service already provided, so the row follows ui-theme (and ui-layout's
  // presenter) here exactly as the cordis.patch.yml roster orders it.
  { id: '@daypaw/ui-brand', bundlePath: 'packages/daypaw/ui-brand/lib/client.js', url: '/plugins/daypaw-ui-brand.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-ui-theme'] },
  // The chat node definitions live here: without this row the assembled Chat
  // snapshot is empty and the conversation seat has nothing to project.
  { id: '@deepseek-ai/dsh-client-ui-conversation', bundlePath: 'packages/client/ui-conversation/lib/client.js', url: '/plugins/ui-conversation.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-api-remotes', '@deepseek-ai/dsh-client-ui-layout'] },
  { id: '@daypaw/ui-inbox', bundlePath: 'packages/daypaw/ui-inbox/lib/client.js', url: '/plugins/daypaw-ui-inbox.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-locale'] },
  { id: '@daypaw/ui-settings', bundlePath: 'packages/daypaw/ui-settings/lib/client.js', url: '/plugins/daypaw-ui-settings.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-runtime', '@daypaw/ui-inbox', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-api-remotes'] },
  { id: '@daypaw/ui-tasks', bundlePath: 'packages/daypaw/ui-tasks/lib/client.js', url: '/plugins/daypaw-ui-tasks.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-runtime', '@daypaw/ui-inbox', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-api-remotes'] },
  { id: '@daypaw/ui-agents', bundlePath: 'packages/daypaw/ui-agents/lib/client.js', url: '/plugins/daypaw-ui-agents.js', rev: 'fx', inject: ['@deepseek-ai/dsh-client-runtime', '@daypaw/ui-inbox', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-connection'] },
]

const bundles = new Map(PLUGINS.map(plugin => [
  plugin.url,
  readFileSync(join(process.cwd(), plugin.bundlePath), 'utf8'),
]))

interface FixtureWindow extends Window {
  __DSH_BOOT__?: { rev: string; entries: WebBootEntry[] }
  __ModuleLoader__?: unknown
}

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

const win = window as FixtureWindow
let unmount: (() => void) | undefined

/**
 * Register the per-test jsdom setup and teardown the assembled boot needs:
 * English pinned before boot so role/text locators stay deterministic across
 * localized component migrations (the newEnglishPage e2e convention), the
 * observers and frame callbacks jsdom lacks, and a full reset of the document,
 * the boot globals, and the injected plugin styles afterwards.
 */
export function installAssembledBootEnv(): void {
  beforeEach(() => {
    localStorage.clear()
    // The locale service derives its provisional locale from the browser and
    // takes an explicit choice only from Host settings, which this lane's
    // fixture transport does not serve; pinning the navigator is what selects
    // English here.
    Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true })
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    document.title = 'daypaw'
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => { callback(0) }, 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { clearTimeout(id) })
  })

  afterEach(() => {
    act(() => { unmount?.() })
    unmount = undefined
    cleanup()
    delete win.__DSH_BOOT__
    delete win.__ModuleLoader__
    document.body.innerHTML = ''
    document.head.querySelectorAll('style[data-plugin]').forEach((style) => { style.remove() })
    document.title = ''
    history.replaceState(null, '', '/')
    // Deleting the own properties uncovers jsdom's own accessors again
    // (Navigator declares both readonly, hence the erased receiver).
    const ownNavigator = navigator as unknown as Record<string, unknown>
    delete ownNavigator.languages
    delete ownNavigator.language
    vi.unstubAllGlobals()
  })
}

/**
 * Mount the assembled application on the fixture transport; the teardown
 * registered by installAssembledBootEnv disposes it.
 */
export function mountAssembledApp(): void {
  history.replaceState(null, '', '/?fixture')
  const root = document.createElement('div')
  root.id = 'root'
  document.body.appendChild(root)
  win.__DSH_BOOT__ = { rev: 'fx', entries: PLUGINS.map(({ bundlePath: _bundlePath, ...plugin }) => plugin) }
  act(() => {
    const entry = new AppWebEntry(root, {
      loadBundle: async (url) => {
        const code = bundles.get(url)
        if (code === undefined) throw new Error(`missing built bundle ${url}`)
        ;(0, eval)(code)
      },
    })
    void entry.run()
    unmount = () => { entry.dispose() }
  })
}

/**
 * Match a CSS-module class by its logical name.
 * Module class names carry a per-build hash in one of two schemes —
 * ui-primitives emits `_<name>_<hash>` (name bounded by underscores),
 * feature bundles emit `<hash>_<name>` (name at the end) — and a longer name
 * containing this one must not match (`line` must not hit `lineNumber`).
 * @param el - element whose class list is inspected.
 * @param name - logical (unhashed) module class name.
 * @returns whether the element carries that module class.
 */
export function hasClass(el: Element, name: string): boolean {
  return [...el.classList].some(cls => cls === name || cls.endsWith(`_${name}`) || cls.startsWith(`_${name}_`) || cls.includes(`_${name}_`))
}

/**
 * Whether this run rewrites its golden instead of comparing against it, set by
 * the snapshot gate's `DSH_SNAPSHOT` mode (`record` re-runs the scenarios from
 * scratch, `refresh` re-derives the expected text from the existing ones).
 */
export const REFRESHING_GOLDEN = process.env.DSH_SNAPSHOT === 'record' || process.env.DSH_SNAPSHOT === 'refresh'
