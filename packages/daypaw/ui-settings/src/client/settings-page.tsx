/**
 * Settings single page (the 'inbox.settings.page' occupant): a left tab rail
 * over the four sections — 通用 (language row plus the theme preference row),
 * 凭据 (per-provider API-key rows with inline set/update/remove), 模型 (the
 * upstream ui-settings-models section, rendered through the 'settings.section'
 * slot this page declares), 关于 (host version/cwd/model plus the
 * copy-diagnostics button). The active tab lives in the package's
 * apply-closure store so the first-run banner can preset 凭据.
 */
import { useState } from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { LocaleRuntime, LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-inbox's SlotMap merge (the 'inbox.settings.page' entry).
import type {} from '@daypaw/ui-inbox/client'
// Type-only: pulls the settings domain base's SlotMap merge (the
// 'settings.section' entry this page declares and renders).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { diagnosticsText, type AboutState, type AboutStore } from './about-store.ts'
import type { CredentialRow, CredentialsState, CredentialsStore } from './provider-keys.ts'
import { useLazyTabLoad } from './lazy-refresh.ts'
import type { ThemeRowState } from './theme-row.ts'
import type { SettingsTab } from './tab-store.ts'
import type { DaypawSettingsKey } from './locales.ts'
import css from './settings-page.module.css'

/** Registration-side business face for the settings page. */
export interface SettingsPageInjected {
  hooks: {
    /** Active tab, bound by the renderer as useTab. */
    tab: SnapshotStore<SettingsTab>
    /** Credentials tab snapshot, bound as useCredentials. */
    credentials: SnapshotStore<CredentialsState>
    /** About tab snapshot, bound as useAbout. */
    about: SnapshotStore<AboutState>
    /** Locale face (active locale + selectable list), bound as useLocale. */
    locale: LocaleRuntime
    /** Theme preference mirror, bound as useTheme. */
    theme: SnapshotStore<ThemeRowState>
  }
  /** Switch the active tab. */
  selectTab: (tab: SettingsTab) => void
  /** Credentials tab controller (load/set/unset write path). */
  credentialsStore: CredentialsStore
  /** About tab controller (host describe load). */
  aboutStore: AboutStore
  /** Switch the active locale (the locale service's only write entry). */
  setLocale: (id: string) => void
  /** Switch the theme preference (the theme service's only write entry). */
  setTheme: (id: ThemePreference) => void
}

/** Full component props: runtime share + child render share + injected face + locale seat. */
export type SettingsPageProps =
  PropsRuntime<'inbox.settings.page'>
  & PropsRenderSlots<'settings.section'>
  & InjectFace<SettingsPageInjected>
  & PropsLocale<'daypaw-settings'>

/** The four tabs in rail order. */
const TAB_IDS: readonly SettingsTab[] = ['general', 'credentials', 'models', 'about']

/** Tab label keys, in TABS order's key space. */
const TAB_LABEL: Record<SettingsTab, DaypawSettingsKey> = {
  general: 'tab.general',
  credentials: 'tab.credentials',
  models: 'tab.models',
  about: 'tab.about',
}

type Translate = TranslateNS<'daypaw-settings'>

/**
 * Render the settings page.
 * @param props - composed slot props (runtime share + child render share + injected face + locale seat).
 * @returns the page element tree.
 */
export function SettingsPage({
  close, renderSlot, useTab, useCredentials, useAbout, useLocale, useTheme,
  selectTab, credentialsStore, aboutStore, setLocale, setTheme, t,
}: SettingsPageProps) {
  const tab = useTab(s => s)
  const credentials = useCredentials(s => s)
  const about = useAbout(s => s)
  const locale = useLocale(s => s)
  const theme = useTheme(s => s)
  return (
    <div className={css.root}>
      <header className={css.header}><h1 className={css.title}>{t('title')}</h1></header>
      <div className={css.body}>
        <nav className={css.tabs}>
          {TAB_IDS.map(id => (
            <button
              key={id}
              type="button"
              className={clsx(css.tab, tab === id && css.tabActive)}
              aria-pressed={tab === id}
              onClick={() => { selectTab(id) }}
            >
              {t(TAB_LABEL[id])}
            </button>
          ))}
        </nav>
        <div className={css.content}>
          {tab === 'general'
            ? <GeneralTab locale={locale} setLocale={setLocale} theme={theme} setTheme={setTheme} t={t} />
            : tab === 'credentials'
              ? <CredentialsTab state={credentials} store={credentialsStore} t={t} />
              : tab === 'models'
                ? renderSlot('settings.section', { close }, { only: 'models' })
                : <AboutTab state={about} store={aboutStore} t={t} />}
        </div>
      </div>
    </div>
  )
}

/** 通用: the language row plus the theme preference row (light default, spec 05 §7). */
function GeneralTab({ locale, setLocale, theme, setTheme, t }: {
  locale: LocaleSnapshot
  setLocale: (id: string) => void
  theme: ThemeRowState
  setTheme: (id: ThemePreference) => void
  t: Translate
}) {
  return (
    <section>
      <div className={css.row}>
        <span className={css.rowLabel}>{t('general.language')}</span>
        <select
          className={css.select}
          aria-label={t('general.language')}
          value={locale.active}
          onChange={(event) => { setLocale(event.target.value) }}
        >
          {locale.locales.map(option => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </div>
      <div className={css.row}>
        <span className={css.rowLabel}>{t('general.theme')}</span>
        <select
          className={css.select}
          aria-label={t('general.theme')}
          value={theme.preference}
          onChange={(event) => { setTheme(event.target.value as ThemePreference) }}
        >
          <option value="light">{t('general.theme.light')}</option>
          <option value="dark">{t('general.theme.dark')}</option>
          <option value="system">{t('general.theme.system')}</option>
        </select>
      </div>
    </section>
  )
}

/** One failure pinned to the row it came from (save and remove share it). */
interface RowFailure {
  ref: string
  message: string
}

/** Whole-tab load failure with a retry (both lazy tabs render it identically). */
function TabLoadFailure({ message, retry, t }: {
  /** The composed `load-failed: detail` line. */
  message: string
  /** Re-run the tab's load. */
  retry: () => void
  t: Translate
}) {
  return (
    <section>
      <p className={css.error} role="alert">{message}</p>
      <button type="button" className={css.button} onClick={retry}>
        {t('retry')}
      </button>
    </section>
  )
}

/** 凭据: one inline-editing row per configurable provider. */
function CredentialsTab({ state, store, t }: {
  state: CredentialsState
  store: CredentialsStore
  t: Translate
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<RowFailure | null>(null)
  useLazyTabLoad(state, store)

  if (state.status === 'error') {
    return <TabLoadFailure message={`${t('credentials.load-failed')}: ${state.error ?? ''}`} retry={() => { void store.load() }} t={t} />
  }

  const openEditor = (row: CredentialRow): void => {
    setEditing(row.ref)
    setDraft('')
    setFailure(null)
  }
  const save = (row: CredentialRow): void => {
    const value = draft.trim()
    if (value === '') return
    void store.set(row.ref, value).then((message) => {
      if (message !== undefined) {
        setFailure({ ref: row.ref, message })
        return
      }
      setEditing(null)
      setDraft('')
      setFailure(null)
    })
  }
  const remove = (row: CredentialRow): void => {
    void store.unset(row.ref).then((message) => {
      setFailure(message === undefined ? null : { ref: row.ref, message })
    })
  }

  return (
    <section>
      <p className={css.intro}>{t('credentials.intro')}</p>
      <ul className={css.rows}>
        {state.rows.map(row => (
          <li key={row.ref} className={css.row}>
            <span className={css.rowLabel}>{row.displayName}</span>
            {row.credential.configured
              ? <span className={css.rowState}>{t('credentials.configured')}</span>
              : (
                <span className={css.rowState}>
                  <span
                    className={css.warningDot}
                    role="img"
                    aria-label={t('credentials.missing')}
                    title={t('credentials.missing')}
                  />
                  {t('credentials.missing')}
                </span>
              )}
            {editing === row.ref
              ? (
                <span className={css.rowEditor}>
                  <input
                    className={css.input}
                    type="password"
                    aria-label={row.displayName}
                    placeholder={t('credentials.placeholder')}
                    value={draft}
                    onChange={(event) => { setDraft(event.target.value) }}
                  />
                  <button type="button" className={css.button} onClick={() => { save(row) }}>
                    {t('credentials.save')}
                  </button>
                  <button type="button" className={css.button} onClick={() => { setEditing(null); setFailure(null) }}>
                    {t('credentials.cancel')}
                  </button>
                </span>
              )
              : (
                <span className={css.rowActions}>
                  <button type="button" className={css.button} onClick={() => { openEditor(row) }}>
                    {row.credential.configured ? t('credentials.update') : t('credentials.set')}
                  </button>
                  {row.credential.configured && row.credential.writable
                    ? (
                      <button type="button" className={css.button} onClick={() => { remove(row) }}>
                        {t('credentials.remove')}
                      </button>
                    )
                    : null}
                </span>
              )}
            {failure !== null && failure.ref === row.ref
              ? <span className={css.error} role="alert">{failure.message}</span>
              : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 关于: host facts plus the copy-diagnostics button. */
function AboutTab({ state, store, t }: {
  state: AboutState
  store: AboutStore
  t: Translate
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  useLazyTabLoad(state, store)

  if (state.status === 'error') {
    return <TabLoadFailure message={`${t('about.load-failed')}: ${state.error ?? ''}`} retry={() => { void store.load() }} t={t} />
  }
  const description = state.description
  if (description === null) return null

  const copy = (): void => {
    navigator.clipboard.writeText(diagnosticsText(description)).then(
      () => { setCopied(true); setCopyFailed(false) },
      // The clipboard promise rejects on permission denial; the row says so.
      () => { setCopyFailed(true) },
    )
  }

  return (
    <section>
      <div className={css.row}>
        <span className={css.rowLabel}>{t('about.model')}</span>
        <span className={css.rowValue}>{description.provider} / {description.model}</span>
      </div>
      <div className={css.row}>
        <span className={css.rowLabel}>{t('about.attached')}</span>
        <span className={css.rowValue}>{description.attachedSessions}</span>
      </div>
      <div className={css.row}>
        <button type="button" className={css.button} onClick={copy}>
          {copied ? t('about.copied') : t('about.copy')}
        </button>
      </div>
      {copyFailed ? <p className={css.error} role="alert">{t('about.copy-failed')}</p> : null}
    </section>
  )
}
