import { describe, expect, it } from 'vitest'
import { draftStartFields } from './draft-start'
import { toLocalInput } from './draft'

describe('draftStartFields', () => {
  it('keeps the Berlin day and no time for a day-only draft', () => {
    // 00:00 Berlin on 2026-12-05 is 23:00 UTC the day before
    expect(draftStartFields({ starts_at: '2026-12-04T23:00:00.000Z', times_unverified: true })).toEqual({
      date: '2026-12-05',
      time: '',
    })
  })
  it('uses the local date and time for a timed draft', () => {
    const iso = '2026-12-05T19:30:00.000Z'
    const [date, time] = toLocalInput(iso).split('T')
    expect(draftStartFields({ starts_at: iso, times_unverified: false })).toEqual({ date, time })
  })
})
