import { describe, expect, it } from 'vitest'
import { draftStartFields, isDayOnly } from './draft-start'
import { toLocalInput } from './draft'

describe('isDayOnly', () => {
  it('is a suggestion sent without a start time', () => {
    expect(isDayOnly({ times_unverified: true }, 'suggestion')).toBe(true)
    expect(isDayOnly({ times_unverified: false }, 'suggestion')).toBe(false)
  })
  it('never a feed item: its unverified time is still a time', () => {
    expect(isDayOnly({ times_unverified: true }, 'ical')).toBe(false)
  })
})

describe('draftStartFields', () => {
  it('keeps the Berlin day and no time for a day-only suggestion', () => {
    // 00:00 Berlin on 2026-12-05 is 23:00 UTC the day before
    expect(draftStartFields({ starts_at: '2026-12-04T23:00:00.000Z', times_unverified: true }, 'suggestion')).toEqual({
      date: '2026-12-05',
      time: '',
    })
  })
  it('uses the local date and time for a timed draft', () => {
    const iso = '2026-12-05T19:30:00.000Z'
    const [date, time] = toLocalInput(iso).split('T')
    expect(draftStartFields({ starts_at: iso, times_unverified: false }, 'suggestion')).toEqual({ date, time })
  })
  it('keeps the time of a feed item marked "Times unverified"', () => {
    // An iCal event at 20:00 Berlin whose time the page does not confirm
    const iso = '2026-12-05T19:00:00.000Z'
    const [date, time] = toLocalInput(iso).split('T')
    expect(time).not.toBe('')
    expect(draftStartFields({ starts_at: iso, times_unverified: true }, 'ical')).toEqual({ date, time })
  })
})
