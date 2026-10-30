import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestDraftSchema, ingestSourceConfigSchema, type Extraction } from '@open-event-db/shared'
import { parseDunckerclub } from './adapters/dunckerclub.js'
import { parseIcal } from './adapters/ical.js'
import { normalizeFeedEvent } from './normalize.js'

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/acud.ics', import.meta.url)), 'utf8')
const CLUB = '0190a0b0-0000-7000-8000-000000000001'
const acud = ingestSourceConfigSchema.parse({ external_id_pattern: '-(\\d+)@', venues: { Club: CLUB } })
const unmapped = ingestSourceConfigSchema.parse({ external_id_pattern: '-(\\d+)@' })
const events = parseIcal(fixture, acud)

const feed = (summary: string) => {
  const found = events.find((e) => e.summary === summary)
  if (!found) throw new Error(`no event "${summary}"`)
  return found
}

const extraction = (fields: Partial<Extraction>): Extraction => ({
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
  ...fields,
})

/** normalizeFeedEvent, with the result checked against the stored draft schema. */
const normalize = (...args: Parameters<typeof normalizeFeedEvent>) => {
  const draft = normalizeFeedEvent(...args)
  expect(ingestDraftSchema.parse(draft)).toEqual(draft)
  return draft
}

describe('normalizeFeedEvent', () => {
  it('passes the feed lineup through, and gives none when the feed has none', () => {
    const persian = feed('Persian Love: SHAB SHOD')
    expect(normalize(persian, acud, null).lineup).toEqual([])
    const lineup = [{ name: 'Säule', acts: [{ name: 'Timnah', time: '23:59', live: false, note: null }] }]
    expect(normalize({ ...persian, lineup }, acud, null).lineup).toEqual(lineup)
  })

  it('caps a huge feed lineup so the draft stays valid', () => {
    const acts = Array.from({ length: 125 }, (_, i) => ({ name: `Act ${i}`, time: null, live: false, note: null }))
    const draft = normalize({ ...feed('Persian Love: SHAB SHOD'), lineup: [{ name: 'A', acts }, { name: 'B', acts }] }, acud, null)
    expect(draft.lineup.flatMap((g) => g.acts)).toHaveLength(200)
  })

  it('takes the times from the description text over the feed (Persian Love)', () => {
    const persian = feed('Persian Love: SHAB SHOD')
    const draft = normalize(persian, acud, extraction({ start_time: '22:00', end_time: '04:00' }))
    expect(draft).toMatchObject({
      title: 'Persian Love: SHAB SHOD',
      starts_at: '2026-10-30T22:00:00+01:00',
      ends_at: '2026-10-31T04:00:00+01:00',
      venue_id: CLUB,
      location_text: null,
      city: 'Berlin',
      links: { website: 'https://acudmachtneu.de/events/persian-love-shab-shod/' },
      image_url: 'https://acudmachtneu.de/resources/uploads/2026/10/blurred-frame-4.jpg',
      source_url: 'https://acudmachtneu.de/events/persian-love-shab-shod/',
      times_unverified: false,
    })
  })

  it('keeps the description verbatim, single newlines as Markdown hard breaks', () => {
    const persian = feed('Persian Love: SHAB SHOD')
    const { description } = normalize(persian, acud, null)
    expect(description).toContain('Persian Love: SHAB SHOD   \nFR 30.10, ACUD CLUB  \n10PM- 4AM \n\nPersian Love presents')
    expect(description).toMatch(/all night long\)\n\nDress up OPTIONAL$/)
    // Nothing else changed
    expect(description.replaceAll('  \n', '\n')).toBe(persian.description)
  })

  it('drops a feed time that is not the real start (Psychopomp, feed 15:09)', () => {
    const draft = normalize(feed('Psychopomp'), acud, extraction({ start_time: '20:00', end_time: null }))
    expect(draft.starts_at).toBe('2026-10-31T20:00:00+01:00')
    expect(draft.ends_at).toBeNull()
    expect(draft.times_unverified).toBe(false)
  })

  it('ends a multi-day event on the extracted end date (Orbital Decay)', () => {
    const orbital = feed('Orbital Decay')
    const end_date = { day: 6, month: 12, year: 2026, weekday: null }
    const draft = normalize(orbital, acud, extraction({ start_time: '18:00', end_date }))
    expect(draft.starts_at).toBe('2026-10-01T18:00:00+02:00')
    // No extracted end time: the feed's end time on the extracted day
    expect(draft.ends_at).toBe('2026-12-06T23:30:00+01:00')

    const withTime = normalize(orbital, acud, extraction({ start_time: '18:00', end_date, end_time: '19:00' }))
    expect(withTime.ends_at).toBe('2026-12-06T19:00:00+01:00')
  })

  it('resolves an end date without a year relative to the feed start', () => {
    const end_date = { day: 6, month: 12, year: null, weekday: null }
    const draft = normalize(feed('Orbital Decay'), acud, extraction({ start_time: '18:00', end_date, end_time: '19:00' }))
    expect(draft.ends_at).toBe('2026-12-06T19:00:00+01:00')
  })

  it('treats an end date on the start day like no end date', () => {
    const end_date = { day: 16, month: 10, year: null, weekday: null }
    const draft = normalize(feed('Burre w/ Heavenphetamine'), acud, extraction({ start_time: '20:00', end_date, end_time: '23:00' }))
    expect(draft.ends_at).toBe('2026-10-16T23:00:00+02:00')
  })

  it('keeps the feed date when the extraction reads a different one (Burre)', () => {
    const date = { day: 17, month: 10, year: null, weekday: null }
    const draft = normalize(feed('Burre w/ Heavenphetamine'), acud, extraction({ date, start_time: '20:00' }))
    expect(draft.starts_at).toBe('2026-10-16T20:00:00+02:00')
    // The feed end (31.10. 23:51) is more than 24 h away: not a real end
    expect(draft.ends_at).toBeNull()
  })

  it('uses the feed times without an extraction and marks them unverified', () => {
    const persian = normalize(feed('Persian Love: SHAB SHOD'), acud, null)
    expect(persian).toMatchObject({
      starts_at: '2026-10-30T22:00:00+01:00',
      ends_at: '2026-10-30T23:03:00+01:00',
      times_unverified: true,
    })

    const burre = normalize(feed('Burre w/ Heavenphetamine'), acud, null)
    expect(burre).toMatchObject({ starts_at: '2026-10-16T20:00:00+02:00', ends_at: null, times_unverified: true })

    const psychopomp = normalize(feed('Psychopomp'), acud, null)
    expect(psychopomp).toMatchObject({ starts_at: '2026-10-31T15:09:00+01:00', ends_at: null, times_unverified: true })
  })

  it('marks the times unverified when the extraction has no usable start time', () => {
    const persian = feed('Persian Love: SHAB SHOD')
    const none = normalize(persian, acud, extraction({ end_time: '04:00' }))
    expect(none.starts_at).toBe('2026-10-30T22:00:00+01:00')
    expect(none.times_unverified).toBe(true)

    const unreadable = normalize(persian, acud, extraction({ start_time: 'late' }))
    expect(unreadable.starts_at).toBe('2026-10-30T22:00:00+01:00')
    expect(unreadable.times_unverified).toBe(true)
  })

  it('drops a feed end that is not after the extracted start', () => {
    const draft = normalize(feed('Persian Love: SHAB SHOD'), acud, extraction({ start_time: '23:30' }))
    expect(draft.starts_at).toBe('2026-10-30T23:30:00+01:00')
    expect(draft.ends_at).toBeNull()
  })

  it('falls back to the feed location when the room is not mapped', () => {
    const draft = normalize(feed('Orbital Decay'), unmapped, null)
    expect(draft.venue_id).toBeNull()
    expect(draft.location_text).toBe('Galerie, 21 Veteranenstrasse, Berlin')

    const club = normalize(feed('Psychopomp'), unmapped, null)
    expect(club.venue_id).toBeNull()
    expect(club.location_text).toBe('Club, 21 Veteranenstrasse, Berlin')
  })

  it('does not look up venue rooms on the object prototype', () => {
    const room = { ...feed('Psychopomp'), locationRoom: 'constructor', locationText: 'constructor, Somewhere' }
    const draft = normalize(room, acud, null)
    expect(draft.venue_id).toBeNull()
    expect(draft.location_text).toBe('constructor, Somewhere')
  })

  it('cuts title, description and location text to the event limits', () => {
    const long = {
      ...feed('Psychopomp'),
      summary: `  ${'T'.repeat(250)}  `,
      description: 'D'.repeat(12_000),
      locationRoom: 'Elsewhere',
      locationText: 'L'.repeat(400),
    }
    const draft = normalize(long, unmapped, null)
    expect(draft.title).toHaveLength(200)
    expect(draft.title.startsWith('T')).toBe(true)
    expect(draft.title.endsWith('…')).toBe(true)
    expect(draft.description).toHaveLength(10_000)
    expect(draft.location_text).toHaveLength(300)

    // Short values stay as they are (apart from the title's outer spaces)
    const short = normalize({ ...feed('Psychopomp'), summary: ' Psychopomp ' }, unmapped, null)
    expect(short.title).toBe('Psychopomp')
    expect(short.location_text).toBe('Club, 21 Veteranenstrasse, Berlin')
  })

  it('does not split a surrogate pair when cutting', () => {
    const draft = normalize({ ...feed('Psychopomp'), summary: `${'T'.repeat(198)}🎉🎉` }, unmapped, null)
    expect(draft.title).toBe(`${'T'.repeat(198)}…`)
  })

  it('uses the city from the source config', () => {
    const leipzig = ingestSourceConfigSchema.parse({ city: 'Leipzig' })
    expect(normalize(feed('Psychopomp'), leipzig, null).city).toBe('Leipzig')
  })

  it('takes the categories from the text over the source default', () => {
    const club = ingestSourceConfigSchema.parse({ default_categories: ['party'] })
    const read = extraction({ start_time: '20:00', categories: ['party', 'concert', 'party'] })
    expect(normalize(feed('Psychopomp'), club, read).categories).toEqual(['concert', 'party'])
  })

  it('falls back to the source default when the text names no category or is not read', () => {
    const club = ingestSourceConfigSchema.parse({ default_categories: ['party'] })
    expect(normalize(feed('Psychopomp'), club, extraction({ start_time: '20:00' })).categories).toEqual(['party'])
    expect(normalize(feed('Psychopomp'), club, null).categories).toEqual(['party'])
    expect(normalize(feed('Psychopomp'), acud, null).categories).toEqual([])
  })

  it('adds extracted links next to the feed URL, without duplicates', () => {
    const burre = feed('Burre w/ Heavenphetamine')
    const draft = normalize(
      burre,
      acud,
      extraction({
        start_time: '20:00',
        links: [
          { kind: 'tickets', url: 'https://ra.co/events/2554847' },
          { kind: 'instagram', url: '@gumpmother' },
          { kind: 'website', url: 'https://acudmachtneu.de/events/burre-w-heavenphetamine/' },
          { kind: 'website', url: 'acudmachtneu.de' },
        ],
      }),
    )
    expect(draft.links).toEqual({
      website: 'https://acudmachtneu.de/events/burre-w-heavenphetamine/',
      tickets: 'https://ra.co/events/2554847',
      instagram: 'https://www.instagram.com/gumpmother',
      'website-2': 'https://acudmachtneu.de/',
    })
  })
})

describe('normalizeFeedEvent (Dunckerclub)', () => {
  const html = readFileSync(fileURLToPath(new URL('./fixtures/dunckerclub.html', import.meta.url)), 'utf8')
  const DUNCKER = '0190a0b0-0000-7000-8000-000000000002'
  const config = ingestSourceConfigSchema.parse({ venues: { Dunckerclub: DUNCKER } })
  const pageUrl = 'https://www.dunckerclub.de/start.html'
  const nights = parseDunckerclub(html, config, { pageUrl, now: new Date('2026-10-28T10:00:00Z') })

  it('trusts the times the page states and maps the club', () => {
    const samhain = nights.find((e) => e.externalId === '2026-10-31')!
    expect(normalize(samhain, config, null)).toMatchObject({
      title: 'Dark Mønday – SAMHAIN Celebration 2026',
      starts_at: '2026-10-31T21:00:00+01:00',
      ends_at: '2026-11-01T04:00:00+01:00',
      venue_id: DUNCKER,
      location_text: null,
      links: { website: pageUrl },
      image_url: 'https://www.dunckerclub.de/bilder/samhain_2026.jpg',
      source_url: pageUrl,
      times_unverified: false,
    })
  })

  it('keeps the stated times when the text reads others, and takes categories and links from it', () => {
    const samhain = nights.find((e) => e.externalId === '2026-10-31')!
    const read = extraction({
      start_time: '23:00',
      end_time: '06:00',
      categories: ['party'],
      links: [{ kind: 'tickets', url: 'https://tickets.test/samhain' }],
    })
    expect(normalize(samhain, config, read)).toMatchObject({
      starts_at: '2026-10-31T21:00:00+01:00',
      ends_at: '2026-11-01T04:00:00+01:00',
      categories: ['party'],
      links: { website: pageUrl, tickets: 'https://tickets.test/samhain' },
      times_unverified: false,
    })
  })
})
