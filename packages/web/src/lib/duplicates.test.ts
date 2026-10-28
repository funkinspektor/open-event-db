import { describe, expect, it } from 'vitest'
import { duplicateQuery } from './duplicates'

const base = { venueId: null, locationText: null, startsAt: null, endsAt: null, title: '' }

describe('duplicateQuery', () => {
  it('is null without a start', () => {
    expect(duplicateQuery({ ...base, venueId: 'v1', title: 'Metro Alien' })).toBeNull()
  })

  it('is null without a venue or location text', () => {
    expect(duplicateQuery({ ...base, startsAt: '2026-10-23T22:00:00+02:00' })).toBeNull()
    expect(duplicateQuery({ ...base, startsAt: '2026-10-23T22:00:00+02:00', locationText: '   ' })).toBeNull()
  })

  it('carries venue, start and title', () => {
    const q = duplicateQuery({ ...base, venueId: 'v1', startsAt: '2026-10-23T22:00:00+02:00', title: ' Metro Alien ' })
    expect(Object.fromEntries(q!)).toEqual({
      venue_id: 'v1',
      starts_at: '2026-10-23T22:00:00+02:00',
      title: 'Metro Alien',
    })
  })

  it('falls back to location text and passes the end along', () => {
    const q = duplicateQuery({
      ...base,
      locationText: 'Tempelhofer Feld',
      startsAt: '2026-10-23T22:00:00+02:00',
      endsAt: '2026-10-24T04:00:00+02:00',
    })
    expect(Object.fromEntries(q!)).toEqual({
      location_text: 'Tempelhofer Feld',
      starts_at: '2026-10-23T22:00:00+02:00',
      ends_at: '2026-10-24T04:00:00+02:00',
    })
  })

  it('prefers the venue over location text', () => {
    const q = duplicateQuery({ ...base, venueId: 'v1', locationText: 'x', startsAt: '2026-10-23T22:00:00+02:00' })
    expect(q!.has('venue_id')).toBe(true)
    expect(q!.has('location_text')).toBe(false)
  })
})
