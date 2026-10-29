import { describe, expect, it } from 'vitest'
import type { Extraction, Weekday } from '@open-event-db/shared'
import { cleanAddress, cleanCity, isEmptyDraft, normalizeExtraction, parseTime, resolveDate } from './normalize.js'

// Monday 12 October 2026, 14:00 in Berlin (CEST, UTC+2)
const NOW = new Date('2026-10-12T12:00:00Z')
const TODAY = { year: 2026, month: 10, day: 12 }

const empty: Extraction = {
  title: null,
  date: null,
  start_time: null,
  end_date: null,
  end_time: null,
  venue_name: null,
  address: null,
  city: null,
  description: null,
  lineup: [],
  categories: [],
  tags: [],
  links: [],
}

const written = (day: number, month: number, year: number | null = null, weekday: Weekday | null = null) => ({
  day,
  month,
  year,
  weekday,
})

describe('resolveDate', () => {
  it('takes an explicit year as written', () => {
    expect(resolveDate(written(17, 10, 2026), TODAY)).toEqual({ year: 2026, month: 10, day: 17 })
    expect(resolveDate(written(17, 10, 26), TODAY)).toEqual({ year: 2026, month: 10, day: 17 })
  })

  it('picks the next occurrence when the year is missing, today included', () => {
    expect(resolveDate(written(17, 10), TODAY)).toEqual({ year: 2026, month: 10, day: 17 })
    expect(resolveDate(written(12, 10), TODAY)).toEqual({ year: 2026, month: 10, day: 12 })
    expect(resolveDate(written(3, 2), TODAY)).toEqual({ year: 2027, month: 2, day: 3 })
  })

  it('requires a written weekday to match, otherwise null', () => {
    // 17 Oct 2026 is a Saturday
    expect(resolveDate(written(17, 10, null, 'sat'), TODAY)).toEqual({ year: 2026, month: 10, day: 17 })
    expect(resolveDate(written(17, 10, null, 'fri'), TODAY)).toBeNull()
    expect(resolveDate(written(17, 10, 2026, 'fri'), TODAY)).toBeNull()
  })

  it('rejects dates that do not exist', () => {
    expect(resolveDate(written(31, 11), TODAY)).toBeNull()
    expect(resolveDate(written(29, 2), TODAY)).toBeNull() // Feb 2027 has 28 days
    expect(resolveDate(written(1, 13), TODAY)).toBeNull()
  })
})

describe('parseTime', () => {
  it.each([
    ['23:00', 1380],
    ['9:30', 570],
    ['23h', 1380],
    ['23.30', 1410],
    ['23h30', 1410],
    ['0:00', 0],
  ])('%s → %i', (input, minutes) => expect(parseTime(input)).toBe(minutes))

  it.each(['24:00', '11pm', 'late', '', null])('%s → null', (input) => expect(parseTime(input)).toBeNull())
})

describe('cleanCity / cleanAddress', () => {
  it.each([
    ['Berlin, Deutschland', 'Berlin'],
    ['Berlin, Germany', 'Berlin'],
    ['10439 Berlin', 'Berlin'],
    ['Berlin DE', 'Berlin'],
    ['Leipzig', 'Leipzig'],
    [' ', null],
  ])('city %s → %s', (input, out) => expect(cleanCity(input)).toBe(out))

  it.each([
    ['Dunckerstraße 64, 10439 Berlin, Deutschland', 'Dunckerstraße 64, 10439'],
    ['Ritterstraße 24, 10969 Berlin', 'Ritterstraße 24, 10969'],
    ['Am Flutgraben 2', 'Am Flutgraben 2'],
    ['Berliner Str. 5', 'Berliner Str. 5'],
    ['Uferpromenade', 'Uferpromenade'],
  ])('address %s → %s', (input, out) => expect(cleanAddress(input, 'Berlin')).toBe(out))
})

describe('normalizeExtraction', () => {
  it('builds Berlin timestamps and rolls a night past midnight into the next day', () => {
    const d = normalizeExtraction({ ...empty, date: written(17, 10), start_time: '23:00', end_time: '06:00' }, NOW)
    expect(d.start_date).toBe('2026-10-17')
    expect(d.starts_at).toBe('2026-10-17T23:00:00+02:00')
    expect(d.ends_at).toBe('2026-10-18T06:00:00+02:00')
  })

  it('uses the right offset across the DST switch', () => {
    // Clocks go back on 25 Oct 2026 at 03:00
    const d = normalizeExtraction({ ...empty, date: written(24, 10), start_time: '23:00', end_time: '08:00' }, NOW)
    expect(d.starts_at).toBe('2026-10-24T23:00:00+02:00')
    expect(d.ends_at).toBe('2026-10-25T08:00:00+01:00')
    expect(new Date(d.ends_at!).getTime() - new Date(d.starts_at!).getTime()).toBe(10 * 60 * 60 * 1000)
  })

  it('keeps the day but no timestamp when the time is missing', () => {
    const d = normalizeExtraction({ ...empty, date: written(17, 10), end_time: '06:00' }, NOW)
    expect(d.start_date).toBe('2026-10-17')
    expect(d.starts_at).toBeNull()
    expect(d.ends_at).toBeNull()
  })

  it('honours an explicit end date for multi-day events', () => {
    const d = normalizeExtraction(
      { ...empty, date: written(30, 12), start_time: '20:00', end_date: written(2, 1), end_time: '12:00' },
      NOW,
    )
    expect(d.starts_at).toBe('2026-12-30T20:00:00+01:00')
    expect(d.ends_at).toBe('2027-01-02T12:00:00+01:00')
  })

  it('drops an end that is not after the start despite an explicit end date', () => {
    const d = normalizeExtraction(
      { ...empty, date: written(17, 10), start_time: '23:00', end_date: written(17, 10), end_time: '06:00' },
      NOW,
    )
    expect(d.starts_at).not.toBeNull()
    expect(d.ends_at).toBeNull()
  })

  it('cleans text, defaults the city and normalizes tags and lineup', () => {
    const d = normalizeExtraction(
      {
        ...empty,
        title: '  Keller Nacht ',
        venue_name: ' ',
        lineup: ['DJ A', ' DJ A', 'B', '', 'Djs: Hanzel (Effetto Notte) IT/DE', 'Lavion FR'],
        tags: ['Techno', 'techno ', 'Open Air'],
      },
      NOW,
    )
    expect(d.title).toBe('Keller Nacht')
    expect(d.venue_name).toBeNull()
    expect(d.city).toBe('Berlin')
    expect(d.lineup).toEqual(['DJ A', 'B', 'Hanzel (Effetto Notte) IT/DE', 'Lavion FR'])
    expect(d.tags).toEqual(['techno', 'open air'])
  })

  it('turns links into keyed URLs, skipping invalid ones and duplicates', () => {
    const d = normalizeExtraction(
      {
        ...empty,
        links: [
          { kind: 'instagram', url: '@keller.kollektiv' },
          { kind: 'tickets', url: 'pretix.eu/keller/nacht' },
          { kind: 'resident_advisor', url: 'https://ra.co/events/123' },
          { kind: 'website', url: 'https://keller.berlin' },
          { kind: 'website', url: 'https://other.berlin' },
          { kind: 'website', url: 'https://keller.berlin' },
          { kind: 'website', url: 'not a url' },
        ],
      },
      NOW,
    )
    expect(d.links).toEqual({
      instagram: 'https://www.instagram.com/keller.kollektiv',
      tickets: 'https://pretix.eu/keller/nacht',
      ra: 'https://ra.co/events/123',
      website: 'https://keller.berlin/',
      'website-2': 'https://other.berlin/',
    })
  })

  it('flags a draft without content as empty', () => {
    expect(isEmptyDraft(normalizeExtraction(empty, NOW))).toBe(true)
    expect(isEmptyDraft(normalizeExtraction({ ...empty, tags: ['techno'] }, NOW))).toBe(true)
    expect(isEmptyDraft(normalizeExtraction({ ...empty, title: 'Nacht' }, NOW))).toBe(false)
  })
})
