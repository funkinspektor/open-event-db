import { describe, expect, it } from 'vitest'
import type { IngestDraft } from '@open-event-db/shared'
import { linkBody, mergeRows } from './merge'

const VENUE = '85d9f518-1ba5-4f85-841a-fb2409c32442'

// The VEITSTANZ night at Urban Spree: entered by hand, then found in the Urban Spree feed
const event = {
  title: 'VEITSTANZ',
  description: 'A minimal electronic music event featuring live acts and DJs.',
  starts_at: '2027-01-09T19:00:00.000Z',
  start_time_known: true,
  ends_at: null,
  location_text: null,
  categories: [],
  links: { tickets: 'https://aufnahmeundwiedergabe.de/tickets' },
  image_url: null,
  venue: { id: VENUE },
}

const draft: IngestDraft = {
  title: 'LINEAR MOVEMENT + DER KÜNFTIGE MUSIKANT + TWILIGHT RITUAL',
  description: 'Wehe! Musik & aufnahme + wiedergabe present\n\nVEITSTANZ w/',
  starts_at: '2027-01-09T20:00:00+01:00',
  ends_at: null,
  venue_id: VENUE,
  location_text: 'Urban Spree',
  city: 'Berlin',
  categories: ['concert'],
  links: {
    website: 'https://www.urbanspree.com/program/concerts/linear-movement.html',
    tickets: 'https://shotgun.live/en/events/linear-movement-der-kunftige-musikant-twilight-ritual',
    facebook: 'https://www.facebook.com/events/2698407777240408',
  },
  image_url: 'https://www.urbanspree.com/assets/project/urbanspree/mediasource/IMG_3093.JPG',
  source_url: 'https://www.urbanspree.com/program/concerts/linear-movement.html',
  times_unverified: false,
}

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
    const dayOnly = { ...event, start_time_known: false, starts_at: '2027-01-08T23:00:00.000Z' }
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
