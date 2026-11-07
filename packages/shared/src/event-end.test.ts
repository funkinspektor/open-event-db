import { describe, expect, it } from 'vitest'
import { assumedEnd, effectiveEnd, endOfBerlinDay, partyMorning } from './event-end.js'

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

describe('partyMorning', () => {
  it('is 06:00 the next morning after an evening start', () => {
    expect(iso(partyMorning(new Date('2026-11-05T19:00:00Z')))).toBe('2026-11-06T05:00:00.000Z') // 20:00 → 06:00
    expect(iso(partyMorning(new Date('2026-07-01T21:00:00Z')))).toBe('2026-07-02T04:00:00.000Z') // 23:00 → 06:00 (summer)
  })

  it('is 06:00 the same morning after a start past midnight', () => {
    expect(iso(partyMorning(new Date('2026-11-06T00:00:00Z')))).toBe('2026-11-06T05:00:00.000Z') // 01:00 → 06:00
  })

  it('treats an unknown start time (00:00) as the evening of its day', () => {
    expect(iso(partyMorning(new Date('2026-11-04T23:00:00Z'), false))).toBe('2026-11-06T05:00:00.000Z')
  })

  it('handles the nights the clocks change', () => {
    // 23:00 on 24 Oct (summer time) → 06:00 on 25 Oct (winter time)
    expect(iso(partyMorning(new Date('2026-10-24T21:00:00Z')))).toBe('2026-10-25T05:00:00.000Z')
    // 23:00 on 28 Mar (winter time) → 06:00 on 29 Mar (summer time)
    expect(iso(partyMorning(new Date('2026-03-28T22:00:00Z')))).toBe('2026-03-29T04:00:00.000Z')
  })
})

describe('assumedEnd for parties', () => {
  const party = { categories: ['party'] as const }

  it('keeps a party until at least 06:00', () => {
    expect(iso(assumedEnd(new Date('2026-11-05T19:00:00Z'), party))).toBe('2026-11-06T05:00:00.000Z') // 20:00 → 06:00
    expect(iso(assumedEnd(new Date('2026-11-05T22:00:00Z'), party))).toBe('2026-11-06T05:00:00.000Z') // 23:00 → 06:00
  })

  it('never ends before the end of its day', () => {
    expect(iso(assumedEnd(new Date('2026-11-06T01:00:00Z'), party))).toBe('2026-11-06T23:00:00.000Z') // 02:00 → 00:00
  })

  it('keeps a party without a start time through the following night', () => {
    expect(iso(assumedEnd(new Date('2026-11-04T23:00:00Z'), { ...party, startTimeKnown: false }))).toBe(
      '2026-11-06T05:00:00.000Z',
    )
  })

  it('applies to an event that is both concert and party', () => {
    const both = { categories: ['concert', 'party'] as const }
    expect(iso(assumedEnd(new Date('2026-11-05T19:00:00Z'), both))).toBe('2026-11-06T05:00:00.000Z')
  })
})

describe('effectiveEnd', () => {
  const e = { starts_at: '2026-11-05T19:00:00Z', start_time_known: true, categories: ['party' as const] }

  it('prefers the real end', () => {
    expect(iso(effectiveEnd({ ...e, ends_at: '2026-11-06T01:00:00Z' }))).toBe('2026-11-06T01:00:00.000Z')
  })

  it('assumes one without', () => {
    expect(iso(effectiveEnd({ ...e, ends_at: null }))).toBe('2026-11-06T05:00:00.000Z')
    expect(iso(effectiveEnd({ ...e, categories: [], ends_at: null }))).toBe('2026-11-06T01:00:00.000Z')
  })
})
