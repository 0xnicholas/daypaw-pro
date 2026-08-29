// @vitest-environment jsdom
// Assembled agents-catalog snapshot: boots the fork roster's real built
// workspace client bundles through AppWebEntry's ModuleLoader path against the
// keyless FixtureApiClient transport (no API key, no model round), opens the
// Agents secondary-nav page, and pins the catalog cards the engine's
// definition registry read view projects — including the technical-name
// fallback for the definition that declares no display metadata — then one
// card's detail view with its name@version identity. The per-package suites
// bench over src and cannot see the bundled wiring; this is the
// assembled-output check that a dropped slot registration, a broken wire
// adapter, or leaked run/session/journal wording fails.
//
// Keyless and deterministic: the fixture is the fake server, so the
// definition roster is fixed in the fixture, not harvested from a live host.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { hasClass, installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const GRID_EXPECTED = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/agents-catalog/grid.expected.txt')
const DETAIL_EXPECTED = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/agents-catalog/detail.expected.txt')

installAssembledBootEnv()

/** Product vocabulary rule: run/session/journal wording stays off the catalog surface. */
const FORBIDDEN = /\b(runs?|ran|running|sessions?|journals?)\b/i

/** Normalize the catalog page to stable text lines: header, then one line per card or the detail fields. */
function catalogShape(page: HTMLElement): string {
  const lines: string[] = []
  lines.push(`title=${page.querySelector('h1')?.textContent?.trim() ?? 'none'}`)
  const grid = [...page.querySelectorAll('*')].find(el => hasClass(el, 'grid'))
  if (grid !== undefined) {
    for (const card of grid.children) lines.push(`card=${card.textContent?.trim() ?? ''}`)
    return lines.join('\n')
  }
  const detail = [...page.querySelectorAll('*')].find(el => hasClass(el, 'detail'))
  for (const el of detail?.querySelectorAll('h1, p, span') ?? []) {
    const text = el.textContent?.trim()
    if (text !== undefined && text !== '') lines.push(text)
  }
  return lines.join('\n')
}

describe('assembled agents catalog', () => {
  it('renders the registry-view catalog cards and one card\'s name@version detail from the built bundles', async () => {
    mountAssembledApp()

    // The nav column boots on the running group; open the Agents page.
    const nav = await screen.findByRole('button', { name: 'Agents' }, { timeout: 10_000 })
    fireEvent.click(nav)
    // The fixture registry: one definition with display metadata, one without.
    const card = await screen.findByRole('button', { name: /Weekly report assistant/ }, { timeout: 10_000 })
    const page = card.closest('div')!.parentElement as HTMLElement

    // Business language only on the whole page.
    expect(page.textContent ?? '').not.toMatch(FORBIDDEN)

    const grid = catalogShape(page)
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(GRID_EXPECTED), { recursive: true })
      writeFileSync(GRID_EXPECTED, grid)
    }
    await expect(grid).toMatchFileSnapshot(GRID_EXPECTED)

    // A card opens its detail: business name, description, and the
    // name@version identity; the only action is leaving (no version operations).
    fireEvent.click(card)
    await screen.findByText('weekly-report@1.2.0', undefined, { timeout: 10_000 })
    await waitFor(() => {
      const buttons = screen.getAllByRole('button').filter(button => hasClass(button, 'back'))
      expect(buttons).toHaveLength(1)
    }, { timeout: 10_000 })

    const detailPage = screen.getByText('weekly-report@1.2.0').closest('div')!.parentElement!.parentElement!
    expect(detailPage.textContent ?? '').not.toMatch(FORBIDDEN)
    const detail = catalogShape(detailPage)
    if (REFRESHING_GOLDEN) {
      writeFileSync(DETAIL_EXPECTED, detail)
    }
    await expect(detail).toMatchFileSnapshot(DETAIL_EXPECTED)
  })
})
