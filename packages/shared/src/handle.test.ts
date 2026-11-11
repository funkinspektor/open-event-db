import { describe, expect, it } from 'vitest'
import { handleFromName } from './handle.js'

describe('handleFromName', () => {
  it('transliterates umlauts', () => expect(handleFromName('Mia Köhler')).toBe('mia-koehler'))
  it('collapses runs and trims', () => expect(handleFromName('  DJ  Straße!! ')).toBe('dj-strasse'))
  it('strips other diacritics', () => expect(handleFromName('Ñoño')).toBe('nono'))
  it('falls back to user', () => expect(handleFromName('!!!')).toBe('user'))
  it('caps at 40 chars without a trailing dash', () => {
    const out = handleFromName(`${'a'.repeat(39)} bbbbbb`)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('-')).toBe(false)
    expect(out).toBe('a'.repeat(39))
    expect(handleFromName('x'.repeat(60))).toHaveLength(40)
  })
})
