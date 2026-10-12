import { describe, expect, it } from 'vitest'
import { buildRecurrence, describeRecurrence, parseRecurrence, weekdayOf } from './recurrence'

describe('parseRecurrence', () => {
  it('treats empty values as no recurrence', () => {
    expect(parseRecurrence(null)).toEqual({ kind: 'none' })
    expect(parseRecurrence('  ')).toEqual({ kind: 'none' })
  })

  it('recognises weekly rules and orders the days', () => {
    expect(parseRecurrence('FREQ=WEEKLY;BYDAY=SA,FR')).toEqual({ kind: 'weekly', days: ['FR', 'SA'] })
    expect(parseRecurrence('byday=fr;freq=weekly')).toEqual({ kind: 'weekly', days: ['FR'] })
  })

  it('recognises "nth weekday of the month" rules', () => {
    expect(parseRecurrence('FREQ=MONTHLY;BYDAY=1FR')).toEqual({ kind: 'monthly', ordinal: 1, day: 'FR' })
    expect(parseRecurrence('FREQ=MONTHLY;BYDAY=-1SU')).toEqual({ kind: 'monthly', ordinal: -1, day: 'SU' })
  })

  it('keeps anything the builder cannot express as custom', () => {
    for (const raw of ['FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231T000000Z', 'FREQ=MONTHLY;BYDAY=5FR', 'FREQ=DAILY']) {
      expect(parseRecurrence(raw)).toEqual({ kind: 'custom', rrule: raw })
    }
  })
})

describe('buildRecurrence', () => {
  it('round-trips the simple patterns', () => {
    for (const raw of ['FREQ=WEEKLY;BYDAY=MO,FR', 'FREQ=MONTHLY;BYDAY=2TH', 'FREQ=MONTHLY;BYDAY=-1SA']) {
      expect(buildRecurrence(parseRecurrence(raw))).toBe(raw)
    }
  })

  it('returns null when nothing would repeat', () => {
    expect(buildRecurrence({ kind: 'none' })).toBeNull()
    expect(buildRecurrence({ kind: 'weekly', days: [] })).toBeNull()
    expect(buildRecurrence({ kind: 'custom', rrule: ' ' })).toBeNull()
  })
})

describe('weekdayOf', () => {
  it('uses Berlin time, not UTC', () => {
    // Sat 2026-10-17 23:30 UTC is already Sunday the 18th in Berlin (third Sunday)
    expect(weekdayOf(new Date('2026-10-17T23:30:00Z'))).toEqual({ day: 'SU', ordinal: 3 })
  })

  it('maps days 29–31 to "last"', () => {
    expect(weekdayOf(new Date('2026-10-30T12:00:00Z'))).toEqual({ day: 'FR', ordinal: -1 })
  })
})

describe('describeRecurrence', () => {
  it('describes the builder patterns in words', () => {
    expect(describeRecurrence('FREQ=WEEKLY;BYDAY=FR,SA')).toBe('Repeats every Friday, Saturday')
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=1FR')).toBe('Repeats every first Friday of the month')
    expect(describeRecurrence('FREQ=MONTHLY;BYDAY=-1SU')).toBe('Repeats every last Sunday of the month')
  })

  it('falls back to the frequency or the raw rule', () => {
    expect(describeRecurrence('FREQ=DAILY;COUNT=3')).toBe('Repeats daily')
    expect(describeRecurrence('X=Y')).toBe('Recurring (X=Y)')
  })
})
