// The brand token map: family shape and per-scheme completeness. The
// ThemeTokenOverrides type already forces { light, dark } string pairs; these
// specs pin the map's structure — the color families stay distinct from the
// density scale, every color token carries two different legs (palette work),
// and the density scale is scheme-invariant by construction.
import { describe, expect, it } from 'vitest'
import {
  BRAND_COLOR_TOKENS, BRAND_SPACE_TOKENS, BRAND_TOKEN_OVERRIDES,
} from '../src/client/brand-tokens.ts'

describe('brand token map', () => {
  it('the complete layer is exactly the color pairs plus the density scale, disjoint', () => {
    const colorNames = Object.keys(BRAND_COLOR_TOKENS)
    const spaceNames = Object.keys(BRAND_SPACE_TOKENS)
    expect(colorNames).toHaveLength(50)
    expect(spaceNames).toHaveLength(8)
    expect(Object.keys(BRAND_TOKEN_OVERRIDES)).toHaveLength(colorNames.length + spaceNames.length)
    expect(colorNames.filter(name => spaceNames.includes(name))).toEqual([])
  })

  it('every color token carries distinct light and dark legs', () => {
    for (const [name, modes] of Object.entries(BRAND_COLOR_TOKENS)) {
      expect(modes.light, name).not.toBe(modes.dark)
      expect(modes.light, name).toMatch(/^(rgb|rgba)\(/)
      expect(modes.dark, name).toMatch(/^(rgb|rgba)\(/)
    }
  })

  it('the density scale is scheme-invariant pixel steps', () => {
    for(const [name, modes] of Object.entries(BRAND_SPACE_TOKENS)) {
      expect(modes.light, name).toBe(modes.dark)
      expect(modes.light, name).toMatch(/^\d+px$/)
    }
    expect(Object.values(BRAND_SPACE_TOKENS).map(modes => modes.light)).toEqual([
      '2px', '4px', '6px', '8px', '12px', '16px', '20px', '24px',
    ])
  })

  it('color overrides stay in the alias/specific token namespaces; density in the fork prefix', () => {
    for (const name of Object.keys(BRAND_COLOR_TOKENS)) {
      expect(name.startsWith('--dsw-alias-') || name.startsWith('--dsw-specific-'), name).toBe(true)
    }
    for (const name of Object.keys(BRAND_SPACE_TOKENS)) {
      expect(name.startsWith('--dp-space-'), name).toBe(true)
    }
  })
})
