/**
 * Agents catalog page (the 'inbox.agents.page' occupant): the card grid over
 * the engine's definition registry read view — business name + description
 * per card (technical-name fallback when the definition declares no display
 * metadata) — and one card's detail view carrying the `name@version`
 * identity. v1 offers no version operations: the identity line is
 * information, not a control. The roster loads on first open and the detail
 * selection lives in the shared catalog store, so a re-render never refetches.
 */
import { useEffect } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-inbox's SlotMap merge (the catalog seat) in so
// PropsRuntime<'inbox.agents.page'> resolves.
import type {} from '@daypaw/ui-inbox/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CatalogState, CatalogStore } from './catalog-store.ts'
import css from './agents-page.module.css'

/** Registration-side business face for the catalog page. */
export interface AgentsPageInjected {
  hooks: {
    /** Catalog state, bound by the renderer as useCatalog. */
    catalog: SnapshotStore<CatalogState>
  }
  /** The catalog controller (load roster, open/close the detail view). */
  store: CatalogStore
}

/** Full component props: owner share + injected face + locale seat. */
export type AgentsPageProps =
  PropsRuntime<'inbox.agents.page'>
  & InjectFace<AgentsPageInjected>
  & PropsLocale<'daypaw-agents'>

/**
 * Render the agent catalog page.
 * @param props - composed slot props (owner share + injected face + locale seat).
 * @returns the catalog page tree.
 */
export function AgentsPage({ useCatalog, store, t }: AgentsPageProps) {
  const state = useCatalog(s => s)
  // First-open roster load; a later re-open reuses the ready snapshot.
  useEffect(() => {
    if (state.status === 'idle') void store.load()
  }, [state.status, store])

  if (state.status === 'error') {
    return (
      <div className={css.root}>
        <header className={css.header}><h1 className={css.title}>{t('page.title')}</h1></header>
        <p className={css.error}>{t('page.load-failed')}</p>
      </div>
    )
  }
  if (state.status !== 'ready') {
    return (
      <div className={css.root}>
        <header className={css.header}><h1 className={css.title}>{t('page.title')}</h1></header>
        <p className={css.state}>{t('page.loading')}</p>
      </div>
    )
  }

  const selected = state.selected === undefined
    ? undefined
    : state.cards.find(card => card.key === state.selected)
  if (selected !== undefined) {
    return (
      <div className={css.root}>
        <div className={css.detail}>
          <Button className={css.back} onClick={() => { store.close() }}>
            {t('detail.back')}
          </Button>
          <h1 className={css.detailTitle}>{selected.title}</h1>
          {selected.description !== '' && <p className={css.detailDescription}>{selected.description}</p>}
          <div className={css.identity}>
            <span>{t('detail.identity')}</span>
            <span className={css.identityValue}>{selected.key}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <header className={css.header}>
        <h1 className={css.title}>{t('page.title')}</h1>
        <p className={css.subtitle}>{t('page.subtitle')}</p>
      </header>
      {state.cards.length === 0
        ? <p className={css.state}>{t('page.empty')}</p>
        : (
          <div className={css.grid}>
            {state.cards.map(card => (
              <button
                key={card.key}
                type="button"
                className={css.card}
                onClick={() => { store.open(card.key) }}
              >
                <span className={css.cardTitle}>{card.title}</span>
                {card.description !== '' && <p className={css.cardDescription}>{card.description}</p>}
              </button>
            ))}
          </div>
        )}
    </div>
  )
}
