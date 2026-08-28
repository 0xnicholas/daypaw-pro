/**
 * daypaw brand theme plugin, browser half: stacks the brand palette and
 * density scale onto the reused ui-theme base as one token-override layer
 * (spec 05 §7 — 换肤 = 换 token 值). The theme service owns stacking, per-scheme
 * composition, and teardown; this plugin contributes the values and nothing
 * else. The user's light/dark/system preference keeps driving the base
 * palettes, so switching themes re-picks the layer's leg per scheme.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ui-theme's Context merge (ctx.theme) in; the runtime reach
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { BRAND_TOKEN_OVERRIDES, BRAND_TOKEN_SOURCE } from './brand-tokens.ts'

/** Required services (cordis fiber inject): the theme registry being layered. */
export const inject = ['theme']

/**
 * Stack the brand token layer for this plugin fiber's lifetime.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.theme.overrideTokens(BRAND_TOKEN_SOURCE, BRAND_TOKEN_OVERRIDES),
    'daypaw-ui-brand: brand token layer',
  )
}
