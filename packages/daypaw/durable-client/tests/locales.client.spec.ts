/** durable dictionaries: en mirrors the zh key set. */
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('durable locales', () => {
  it('the English dictionary mirrors the Chinese key set exactly', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
