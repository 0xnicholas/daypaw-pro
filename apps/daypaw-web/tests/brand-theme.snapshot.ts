// @vitest-environment jsdom
// Assembled brand-theme snapshot: boots the fork roster's real built workspace
// client bundles through AppWebEntry's ModuleLoader path against the keyless
// FixtureApiClient transport (no API key, no model round), then pins the daypaw
// brand layer the presenter projects onto the document — the warm-orange
// accent and warm-neutral ink as body inline tokens, the light palette as the
// out-of-box scheme (spec 05 §7: 亮主题默认), the dark leg's re-pick through the
// 主题 preference row, and the scheme-invariant density scale. The per-package
// suites bench over src; this is the assembled-output check that a dropped
// roster row, a mis-ordered inject, or a broken presenter wiring fails.
//
// Keyless and deterministic: the fixture is the fake server (its settings
// transport rejects the durable write; the service's local publish still
// drives the presenter, and the rejected write's recovery read finds no
// ui-theme namespace to revert to), and jsdom carries no matchMedia, so
// `system` resolves to light.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp, REFRESHING_GOLDEN } from './assembled-boot.ts'

const EXPECTED = join(process.cwd(), 'apps/daypaw-web/tests/snapshots/brand-theme/tokens.expected.txt')

installAssembledBootEnv()

/** Representative tokens across the brand layer's families. */
const READOUT_TOKENS = [
  '--dsw-alias-brand-primary',
  '--dsw-alias-bg-base',
  '--dsw-specific-sidebar-fill',
  '--dsw-alias-label-primary',
  '--dsw-alias-border-l2',
  '--dp-space-4',
] as const

/** One scheme's state as stable text lines. */
function themeReadout(): string {
  const lines = [
    `scheme=${document.documentElement.style.colorScheme || 'none'}`,
    `dark=${String(document.body.hasAttribute('data-ds-dark-theme'))}`,
    `wordmark=${screen.queryByText('daypaw') === null ? 'missing' : 'present'}`,
  ]
  for (const name of READOUT_TOKENS) {
    lines.push(`${name}=${document.body.style.getPropertyValue(name) || 'unset'}`)
  }
  return lines.join('\n')
}

describe('assembled brand theme', () => {
  it('projects the warm brand layer and follows the 主题 preference switch from the built bundles', async () => {
    mountAssembledApp()

    // The shell boots on the light palette with the brand tokens in place.
    await screen.findByRole('button', { name: 'New Task' }, { timeout: 10_000 })
    await waitFor(() => {
      expect(document.body.style.getPropertyValue('--dsw-alias-brand-primary')).not.toBe('')
    }, { timeout: 10_000 })
    const light = themeReadout()
    expect(light).toContain('scheme=light')
    expect(light).toContain('dark=false')

    // The preference switch rides the settings page's 主题 row.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const themeSelect = await screen.findByRole('combobox', { name: 'Theme' }, { timeout: 10_000 })
    expect((themeSelect as HTMLSelectElement).value).toBe('light')

    fireEvent.change(themeSelect, { target: { value: 'dark' } })
    await waitFor(() => {
      expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    }, { timeout: 10_000 })
    const dark = themeReadout()
    expect(dark).toContain('scheme=dark')
    expect(dark).toContain('dark=true')
    expect(dark).toContain('--dsw-alias-brand-primary=rgb(240, 146, 74)')
    // Density is scheme-invariant: the spacing leg does not move.
    expect(dark).toContain('--dp-space-4=12px')

    // `system` resolves through the (absent) media query back to light.
    fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), { target: { value: 'system' } })
    await waitFor(() => {
      expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    }, { timeout: 10_000 })
    const system = themeReadout()
    expect(system).toContain('scheme=light')

    const golden = ['light:', light, '', 'dark:', dark, '', 'system:', system].join('\n')
    if (REFRESHING_GOLDEN) {
      mkdirSync(dirname(EXPECTED), { recursive: true })
      writeFileSync(EXPECTED, golden)
    }
    await expect(golden).toMatchFileSnapshot(EXPECTED)
  })
})
