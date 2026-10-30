import { describe, expect, it } from 'vitest'
import type { IngestDraft } from '@open-event-db/shared'
import { linkBody, mergeRows } from './merge'

const VENUE = '00000000-0000-4000-8000-000000000001'

// A night entered by hand, then found in a venue's feed
const event = {
  title: 'Hand-entered night',
  description: 'Live acts and DJs.',
  lineup: [],
  starts_at: '2031-01-11T19:00:00.000Z',
  start_time_known: true,
  ends_at: null,
  location_text: null,
  categories: [],
  links: { tickets: 'https://tickets.example.org/night' },
  image_url: null,
  venue: { id: VENUE },
}

const draft: IngestDraft = {
  title: 'ARTIST ONE + ARTIST TWO',
  description: 'The promoter presents\n\nArtist One (live)\nArtist Two (DJ)',
  lineup: [],
  starts_at: '2031-01-11T20:00:00+01:00',
  ends_at: null,
  venue_id: VENUE,
  location_text: 'Feed Venue',
  city: 'Berlin',
  categories: ['concert'],
  links: {
    website: 'https://venue.example.org/program/artist-one.html',
    tickets: 'https://shop.example.org/artist-one',
    facebook: 'https://www.facebook.com/events/1234567890',
  },
  image_url: 'https://venue.example.org/flyers/artist-one.jpg',
  source_url: 'https://venue.example.org/program/artist-one.html',
  times_unverified: false,
}

describe('mergeRows (lineup)', () => {
  const lineup = [{ name: null, acts: [{ name: 'Artist One', time: null, live: true, note: null }] }]

  it('offers the feed lineup, picked already when the event has none', () => {
    const rows = mergeRows({ ...event, lineup: [] }, { ...draft, lineup })
    expect(rows.find((r) => r.key === 'lineup')).toEqual({ key: 'lineup', label: 'Lineup', synced: true, initial: 'feed' })
  })

  it('keeps the event lineup by default when both have one', () => {
    const own = [{ name: null, acts: [{ name: 'Someone else', time: null, live: false, note: null }] }]
    expect(mergeRows({ ...event, lineup: own }, { ...draft, lineup }).find((r) => r.key === 'lineup')?.initial).toBe('event')
  })

  it('has no row when the lineups match', () => {
    expect(mergeRows({ ...event, lineup }, { ...draft, lineup }).some((r) => r.key === 'lineup')).toBe(false)
  })
})

describe('mergeRows', () => {
  it('lists only what differs, and picks the feed where the event has nothing yet', () => {
    const rows = mergeRows(event, draft)
    expect(rows.map((r) => [r.key, r.initial])).toEqual([
      ['title', 'event'],
      ['categories', 'feed'],
      ['description', 'event'],
      ['image', 'feed'],
      ['link:website', 'feed'],
      ['link:tickets', 'event'],
      ['link:facebook', 'feed'],
    ])
    expect(rows.find((r) => r.key === 'link:tickets')?.label).toBe('Tickets')
    expect(rows.filter((r) => r.synced).map((r) => r.key)).toEqual(['title', 'categories', 'description', 'image', 'link:website'])
  })

  it('offers the feed times for a day without a time, unless the feed only guessed them', () => {
    const dayOnly = { ...event, start_time_known: false, starts_at: '2031-01-10T23:00:00.000Z' }
    expect(mergeRows(dayOnly, draft).find((r) => r.key === 'times')?.initial).toBe('feed')
    expect(mergeRows(dayOnly, { ...draft, times_unverified: true }).find((r) => r.key === 'times')?.initial).toBe('event')
  })

  it('compares the place by venue, or by location text without one', () => {
    expect(mergeRows({ ...event, venue: null }, draft).find((r) => r.key === 'place')?.initial).toBe('feed')
    const noVenue = { ...draft, venue_id: null, location_text: 'Hof' }
    expect(mergeRows({ ...event, venue: null, location_text: 'Hof' }, noVenue).some((r) => r.key === 'place')).toBe(false)
  })
})

describe('linkBody', () => {
  const rows = mergeRows(event, draft)

  it('sends the fields and link keys that come from the feed', () => {
    expect(linkBody('e1', rows, { description: 'feed', 'link:website': 'event' }, false)).toEqual({
      event_id: 'e1',
      fields: ['categories', 'description', 'image'],
      links: ['facebook'],
      sync: false,
    })
  })

  it('takes every synced field and the website from the feed while synced, whatever was picked', () => {
    const body = linkBody('e1', rows, { title: 'event', 'link:website': 'event' }, true)
    expect(body.fields).toEqual(['title', 'categories', 'description', 'image'])
    expect(body.links).toEqual(['website', 'facebook'])
  })
})
