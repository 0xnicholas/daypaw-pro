// daypaw ui-brand apply: the one effect this plugin owns — stacking the brand
// layer onto a real ThemeRuntime. The service's own specs (upstream
// ui-theme/theme.client.spec.ts) own stacking order and re-override
// replacement; these pin the fork contract: the layer lands composed over the
// active base, follows the preference switch by re-picking its scheme leg, and
// leaves no trace when the plugin fiber disposes.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ThemeSettings, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNodeHalf } from '../src/index.ts'
import { BRAND_TOKEN_SOURCE } from '../src/client/brand-tokens.ts'

const LIGHT_PRIMARY = 'rgb(190, 86, 20)'
const DARK_PRIMARY = 'rgb(240, 146, 74)'

async function bench(): Promise<{ ctx: Context; theme: ThemeRuntime; events: ThemeSnapshot[] }> {
  const ctx = new Context()
  const host = stubSettingsScope<ThemeSettings>()
  const theme = new ThemeRuntime(ctx, host.scope)
  ctx.provide('theme', theme)
  const events: ThemeSnapshot[] = []
  ctx.on('theme/change', (snapshot: ThemeSnapshot) => { events.push(snapshot) })
  return { ctx, theme, events }
}

describe('ui-brand apply', () => {
  it('declares only the theme service', () => {
    expect(inject).toEqual(['theme'])
  })

  it('the node half provides no host-side behavior', () => {
    applyNodeHalf()
  })

  it('stacks the brand layer composed over the active light palette', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const tokens = b.theme.getTheme().active.tokens
    expect(tokens['--dsw-alias-brand-primary']).toBe(LIGHT_PRIMARY)
    expect(tokens['--dsw-specific-sidebar-fill']).toBe('rgb(250, 245, 239)')
    expect(tokens['--dp-space-4']).toBe('12px')
  })

  it('re-picks the dark leg when the preference switches scheme', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.theme.setTheme('dark')
    const tokens = b.theme.getTheme().active.tokens
    expect(b.theme.getTheme().active.colorScheme).toBe('dark')
    expect(tokens['--dsw-alias-brand-primary']).toBe(DARK_PRIMARY)
    expect(tokens['--dp-space-4']).toBe('12px')
  })

  it('disposes with the fiber, leaving the base palettes untouched', async () => {
    const b = await bench()
    const fiber = await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.theme.getTheme().active.tokens['--dsw-alias-brand-primary']).toBe(LIGHT_PRIMARY)
    await fiber.dispose()
    expect(b.theme.getTheme().active.tokens['--dsw-alias-brand-primary']).toBeUndefined()
    expect(b.theme.getTheme().active.tokens).toEqual({})
    // The layer was removed by identity, not shadowed by a second registration.
    expect(() => b.theme.overrideTokens(BRAND_TOKEN_SOURCE, {})).not.toThrow()
  })
})
