import { describe, expect, it } from 'vitest'
import { assumedEnd, effectiveEnd, endOfBerlinDay } from './event-end.js'

const iso = (d: Date) => d.toISOString()

describe('endOfBerlinDay', () => {
  it('is the next Berlin midnight, in winter and summer time', () => {
    expect(iso(endOfBerlinDay(new Date('2026-11-05T19:00:00Z')))).toBe('2026-11-05T23:00:00.000Z')
    expect(iso(endOfBerlinDay(new Date('2026-07-01T10:00:00Z')))).toBe('2026-07-01T22:00:00.000Z')
  })

  it('counts a time after UTC midnight but before Berlin midnight to the Berlin day', () => {
    // 23:30 UTC on 5 Nov is 00:30 Berlin on 6 Nov
    expect(iso(endOfBerlinDay(new Date('2026-11-05T23:30:00Z')))).toBe('2026-11-06T23:00:00.000Z')
  })

  it('handles the days the clocks change', () => {
    expect(iso(endOfBerlinDay(new Date('2026-03-29T10:00:00Z')))).toBe('2026-03-29T22:00:00.000Z')
    expect(iso(endOfBerlinDay(new Date('2026-10-25T10:00:00Z')))).toBe('2026-10-25T23:00:00.000Z')
  })
})

describe('assumedEnd', () => {
  it('takes whichever is later: end of the day or six hours', () => {
    expect(iso(assumedEnd(new Date('2026-11-05T15:00:00Z')))).toBe('2026-11-05T23:00:00.000Z') // 16:00 → 00:00
    expect(iso(assumedEnd(new Date('2026-11-05T19:00:00Z')))).toBe('2026-11-06T01:00:00.000Z') // 20:00 → 02:00
  })

  it('keeps a party starting at 23:00 for six hours', () => {
    expect(iso(assumedEnd(new Date('2026-11-05T22:00:00Z')))).toBe('2026-11-06T04:00:00.000Z')
  })

  it('keeps an event without a start time (00:00 Berlin) for its whole day', () => {
    expect(iso(assumedEnd(new Date('2026-11-04T23:00:00Z')))).toBe('2026-11-05T23:00:00.000Z')
  })
})

describe('effectiveEnd', () => {
  it('prefers the real end', () => {
    const e = { starts_at: '2026-11-05T19:00:00Z', ends_at: '2026-11-30T17:00:00Z' }
    expect(iso(effectiveEnd(e))).toBe('2026-11-30T17:00:00.000Z')
  })

  it('assumes one without', () => {
    expect(iso(effectiveEnd({ starts_at: '2026-11-05T22:00:00Z', ends_at: null }))).toBe('2026-11-06T04:00:00.000Z')
  })
})
