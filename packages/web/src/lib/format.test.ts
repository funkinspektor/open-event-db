import { describe, expect, it } from 'vitest'
import { formatEndDayMark, formatShortDate, formatTimeRange, isHappeningNow, isUpcoming, knownStart } from './format'

describe('event page date and time', () => {
  it('writes the day as "Fri, 30 October"', () => {
    expect(formatShortDate('2026-10-30T18:00:00Z')).toBe('Fri, 30 October')
  })

  it('marks an end on a later Berlin day with its weekday', () => {
    expect(formatEndDayMark('2026-10-30T18:00:00Z', '2026-10-31T10:30:00Z')).toBe('Sat')
    // 00:10 to 02:00 Berlin is the same day, though the UTC dates differ
    expect(formatEndDayMark('2026-10-30T23:10:00Z', '2026-10-31T01:00:00Z')).toBeNull()
    expect(formatEndDayMark('2026-10-30T18:00:00Z', null)).toBeNull()
  })
})

// 2031-07-04 20:00 Berlin; a day-only event on that day is stored as 00:00 Berlin
const now = new Date('2031-07-04T18:00:00Z')
const dayOnly = { starts_at: '2031-07-03T22:00:00.000Z', start_time_known: false, ends_at: null }
const timed = { starts_at: '2031-07-04T17:00:00.000Z', start_time_known: true, ends_at: null }

describe('events without a start time', () => {
  it('show no time instead of 00:00', () => {
    expect(formatTimeRange(knownStart(dayOnly), null)).toBe('Time TBA')
    expect(formatTimeRange(knownStart({ ...dayOnly, ends_at: '2031-07-04T22:00:00.000Z' }), '2031-07-04T22:00:00.000Z')).toBe(
      'until 00:00',
    )
    expect(formatTimeRange(knownStart(timed), null)).toBe('19:00')
  })

  it('stay upcoming for their whole day and are never happening now', () => {
    expect(isUpcoming(dayOnly, now)).toBe(true)
    expect(isUpcoming(dayOnly, new Date('2031-07-04T22:30:00Z'))).toBe(false)
    expect(isHappeningNow(dayOnly, now)).toBe(false)
    expect(isUpcoming(timed, now)).toBe(false)
    expect(isHappeningNow(timed, now)).toBe(true)
  })
})
