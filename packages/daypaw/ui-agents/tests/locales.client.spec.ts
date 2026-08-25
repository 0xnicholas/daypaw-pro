/** daypaw-agents dictionaries: en mirrors the zh key set, and neither language uses run/session/journal wording. */
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('daypaw-agents locales', () => {
  it('the English dictionary mirrors the Chinese key set exactly', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('keeps run/session/journal wording off the surface in both languages', () => {
    const forbidden = /\b(runs?|ran|running|sessions?|journals?)\b/i
    for (const [locale, dict] of [['zh', zh], ['en', en]] as const) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value, `${locale}:${key}`).not.toMatch(forbidden)
      }
    }
  })
})
