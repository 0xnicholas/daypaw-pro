/**
 * The daypaw brand palette and density scale (spec 05 §7, ruling #48): one
 * theme-service override layer that turns the reused ui-theme base into the
 * product shell's 「帮手的桌面」 look — warm-orange accent, warm-neutral base,
 * light palette primary, dark palette complete. Every value pair names both
 * schemes (the theme service rejects bare strings so an override can never go
 * illegible on the other scheme); scheme-invariant values repeat.
 *
 * This map is the single home for brand color and spacing values: components
 * reference `--dsw-alias-*`/`--dsw-specific-*`/`--dp-space-*` tokens only, and
 * the layer's `light`/`dark` legs carry the raw values. The upstream static
 * scale stays untouched — the fork redefines aliases, not the palette scale
 * other themes compose over.
 */
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/**
 * Warm-neutral surface and ink pairs. Light rides an ivory ramp with warm
 * brown ink; dark rides a roasted-brown ramp with warm off-white ink. Accent
 * legs keep ≥4.5:1 on their fills (primary orange on cream/charcoal pairs).
 */
export const BRAND_COLOR_TOKENS: ThemeTokenOverrides = {
  // Page and raised surfaces.
  '--dsw-alias-bg-base': { light: 'rgb(253, 250, 246)', dark: 'rgb(24, 20, 17)' },
  '--dsw-alias-bg-layer-1': { light: 'rgb(255, 252, 248)', dark: 'rgb(31, 26, 22)' },
  '--dsw-alias-bg-layer-2': { light: 'rgb(250, 244, 238)', dark: 'rgb(38, 32, 27)' },
  '--dsw-alias-bg-layer-3': { light: 'rgb(246, 239, 231)', dark: 'rgb(45, 38, 32)' },
  '--dsw-alias-bg-module-platform': { light: 'rgb(250, 245, 240)', dark: 'rgb(38, 32, 27)' },
  '--dsw-alias-bg-multi-select': { light: 'rgb(247, 241, 234)', dark: 'rgb(41, 34, 29)' },
  '--dsw-alias-bg-overlay': { light: 'rgb(243, 235, 227)', dark: 'rgb(52, 44, 37)' },
  '--dsw-alias-bg-skeleton': { light: 'rgba(97, 66, 35, 0.06)', dark: 'rgba(255, 236, 214, 0.07)' },

  // Sidebar column family (the shell's most branded surface).
  '--dsw-specific-sidebar-fill': { light: 'rgb(250, 245, 239)', dark: 'rgb(28, 23, 19)' },
  '--dsw-specific-sidebar-nav-item-hover': { light: 'rgb(244, 236, 228)', dark: 'rgb(38, 32, 27)' },
  '--dsw-specific-sidebar-nav-item-active': { light: 'rgb(240, 231, 220)', dark: 'rgb(45, 38, 32)' },
  '--dsw-specific-sidebar-nav-item-active-accent': { light: 'rgb(250, 229, 210)', dark: 'rgb(72, 51, 35)' },

  // Conversation bubbles and input chrome.
  '--dsw-specific-bubble': { light: 'rgb(249, 243, 237)', dark: 'rgb(41, 35, 30)' },
  '--dsw-specific-bubble-highlight': { light: 'rgb(251, 233, 218)', dark: 'rgb(66, 48, 33)' },
  '--dsw-specific-input-major': { light: 'rgb(255, 253, 250)', dark: 'rgb(38, 32, 27)' },
  '--dsw-specific-selector': { light: 'rgb(246, 240, 234)', dark: 'rgb(38, 32, 27)' },
  '--dsw-specific-tip': { light: 'rgb(246, 240, 234)', dark: 'rgb(38, 32, 27)' },

  // Warm borders (upstream tints black/white rgba; these tint roasted brown).
  '--dsw-alias-border-l1': { light: 'rgba(97, 66, 35, 0.05)', dark: 'rgba(255, 236, 214, 0.06)' },
  '--dsw-alias-border-l2': { light: 'rgba(97, 66, 35, 0.1)', dark: 'rgba(255, 236, 214, 0.12)' },
  '--dsw-alias-border-l3': { light: 'rgba(97, 66, 35, 0.14)', dark: 'rgba(255, 236, 214, 0.16)' },
  '--dsw-alias-border-l4': { light: 'rgba(97, 66, 35, 0.18)', dark: 'rgba(255, 236, 214, 0.2)' },

  // Warm ink.
  '--dsw-alias-label-primary': { light: 'rgb(43, 34, 27)', dark: 'rgb(247, 242, 236)' },
  '--dsw-alias-label-primary-inverted': { light: 'rgb(250, 246, 241)', dark: 'rgb(41, 34, 29)' },
  '--dsw-alias-label-primary-foreground': { light: 'rgb(255, 252, 248)', dark: 'rgb(26, 20, 16)' },
  '--dsw-alias-label-secondary': { light: 'rgb(97, 81, 67)', dark: 'rgb(203, 192, 180)' },
  '--dsw-alias-label-tertiary': { light: 'rgb(130, 113, 98)', dark: 'rgb(168, 155, 141)' },
  '--dsw-alias-label-caption': { light: 'rgb(163, 146, 131)', dark: 'rgb(140, 127, 114)' },

  // Interactive washes (upstream tints a blue-gray; these tint roasted brown).
  '--dsw-alias-interactive-bg-hover': { light: 'rgba(97, 66, 35, 0.06)', dark: 'rgba(255, 236, 214, 0.08)' },
  '--dsw-alias-interactive-bg-active': { light: 'rgba(97, 66, 35, 0.1)', dark: 'rgba(255, 236, 214, 0.14)' },
  '--dsw-alias-interactive-bg-hover-solid': { light: 'rgb(245, 238, 230)', dark: 'rgb(45, 38, 32)' },

  // The accent: paw orange. Fill legs pair with the foreground ink above;
  // text legs sit directly on warm-neutral surfaces.
  '--dsw-alias-brand-primary': { light: 'rgb(190, 86, 20)', dark: 'rgb(240, 146, 74)' },
  '--dsw-alias-brand-text': { light: 'rgb(170, 78, 16)', dark: 'rgb(244, 158, 92)' },
  '--dsw-alias-button-primary-hover': { light: 'rgb(168, 74, 14)', dark: 'rgb(248, 165, 100)' },
  '--dsw-alias-button-info-fill': { light: 'rgb(190, 86, 20)', dark: 'rgb(240, 146, 74)' },
  '--dsw-alias-button-info-hover': { light: 'rgb(168, 74, 14)', dark: 'rgb(248, 165, 100)' },
  '--dsw-alias-state-business-primary': { light: 'rgb(170, 78, 16)', dark: 'rgb(240, 146, 74)' },
  '--dsw-alias-state-business-tertiary': { light: 'rgb(250, 232, 217)', dark: 'rgb(82, 55, 34)' },
  '--dsw-alias-interactive-bg-hover-accent': { light: 'rgba(190, 86, 20, 0.12)', dark: 'rgba(240, 146, 74, 0.18)' },

  // Warm scrollbars over every scrollable list.
  '--dsw-alias-scrollbar-bg-l1': { light: 'rgb(228, 216, 204)', dark: 'rgb(64, 55, 47)' },
  '--dsw-alias-scrollbar-bg-l2': { light: 'rgb(228, 216, 204)', dark: 'rgb(64, 55, 47)' },
  '--dsw-alias-scrollbar-hover-l1': { light: 'rgb(209, 194, 178)', dark: 'rgb(82, 70, 59)' },
  '--dsw-alias-scrollbar-hover-l2': { light: 'rgb(209, 194, 178)', dark: 'rgb(82, 70, 59)' },

  // Markdown surfaces the conversation renders.
  '--dsw-alias-markdown-code-block': { light: 'rgb(250, 245, 240)', dark: 'rgb(35, 29, 25)' },
  '--dsw-alias-markdown-code-block-banner': { light: 'rgb(250, 245, 240)', dark: 'rgb(35, 29, 25)' },
  '--dsw-alias-markdown-inline-code': { light: 'rgb(246, 239, 231)', dark: 'rgb(41, 35, 30)' },
  '--dsw-alias-markdown-citation': { light: 'rgb(246, 239, 231)', dark: 'rgb(45, 38, 32)' },
  '--dsw-alias-markdown-tag': { light: 'rgb(245, 238, 230)', dark: 'rgb(38, 32, 27)' },
  '--dsw-alias-markdown-placeholder': { light: 'rgb(246, 240, 234)', dark: 'rgb(38, 32, 27)' },

  // Floating chrome.
  '--dsw-alias-toast-bg': { light: 'rgb(56, 46, 38)', dark: 'rgb(58, 49, 42)' },
  '--dsw-alias-tooltip-bg': { light: 'rgb(52, 43, 36)', dark: 'rgb(58, 49, 42)' },
}

/**
 * The medium-low density scale (spec 05 §7): the fork components' spacing
 * rhythm, one step per recurring value. Scheme-invariant by construction —
 * density does not follow the palette. `--dp-*` is the fork's token prefix;
 * the `--dsw-*` namespace stays upstream-owned.
 */
export const BRAND_SPACE_TOKENS: ThemeTokenOverrides = {
  '--dp-space-0': { light: '2px', dark: '2px' },
  '--dp-space-1': { light: '4px', dark: '4px' },
  '--dp-space-2': { light: '6px', dark: '6px' },
  '--dp-space-3': { light: '8px', dark: '8px' },
  '--dp-space-4': { light: '12px', dark: '12px' },
  '--dp-space-5': { light: '16px', dark: '16px' },
  '--dp-space-6': { light: '20px', dark: '20px' },
  '--dp-space-7': { light: '24px', dark: '24px' },
}

/** The complete brand layer: color pairs plus the density scale. */
export const BRAND_TOKEN_OVERRIDES: ThemeTokenOverrides = {
  ...BRAND_COLOR_TOKENS,
  ...BRAND_SPACE_TOKENS,
}

/** Layer identity in the theme service's override registry (one layer per source). */
export const BRAND_TOKEN_SOURCE = 'daypaw/ui-brand'
