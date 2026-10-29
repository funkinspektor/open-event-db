import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { FeedParseError, type FeedEvent } from './ical.js'
import { parseSlaughterhouse } from './slaughterhouse.js'

const page = readFileSync(fileURLToPath(new URL('../fixtures/slaughterhouse/konzerte.html', import.meta.url)), 'utf8')
const config = ingestSourceConfigSchema.parse({})
const PAGE = 'https://slaughterhouse-berlin.de/konzerte/'
// Thursday 2026-10-29, 11:00 Berlin: the day the fixture was saved
const NOW = new Date('2026-10-29T10:00:00Z')

const read = (html = page, now = NOW) => parseSlaughterhouse(html, config, { pageUrl: PAGE, now })

const byId = (events: FeedEvent[], id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

describe('parseSlaughterhouse (fixture)', () => {
  it('reads every listed night, the date as its id', () => {
    expect(read().map((e) => [e.externalId, e.summary])).toEqual([
      ['2026-10-30', 'Capper: Rockin And Clubbin – Halloween Edition'],
      ['2026-10-31', 'Factory'],
      ['2026-11-06', 'Same Old Madness: Pentagon Edition'],
      ['2026-11-07', 'Kiss My Blood'],
      ['2026-11-13', 'Stoner’s Fall – Sheev + Ghostones + Caosonora'],
      ['2026-11-14', 'Aufnahme+Wiedergabe: Sutcliffe No More / Control / Kommando'],
      ['2026-11-28', 'Factory'],
      ['2026-12-05', 'Kulturfabrik Winterfest'],
      ['2026-12-12', '35YLOKI Part One / Der Tag der Befreiung ist nah!! (24)'],
      ['2026-12-19', '🔥 SATISFACTORY – THE PARTY 🔥'],
      ['2026-12-26', 'Factory'],
      ['2026-12-31', 'Ball Pink Noir'],
    ])
  })

  it('maps a concert with its start, ticket link, flyer and text', () => {
    const ev = byId(read(), '2026-11-13')
    expect(ev).toMatchObject({
      uid: '2026-11-13',
      start: { date: '2026-11-13', time: '21:00', iso: '2026-11-13T21:00:00+01:00' },
      end: null,
      url: PAGE,
      imageUrl: 'https://slaughterhouse-berlin.de/wp-content/uploads/2026/10/image-2-819x1024.png',
      locationRoom: 'Slaughterhouse',
      locationText: 'Slaughterhouse',
      timesStated: true,
      links: { tickets: 'https://www.tixforgigs.com/Event/77283' },
    })
    expect(ev.description).toMatch(/^Konzert\n\nBeginn: 21:00\nTickets: https:\/\/www\.tixforgigs\.com\/Event\/77283\n\nEin Abend/)
    expect(ev.description).toContain('\n[sheev.bandcamp.com](http://sheev.bandcamp.com/)\n')
  })

  it('takes the doors as the start when no "Beginn" is given, in any of the ways the page writes it', () => {
    const events = read()
    expect(byId(events, '2026-10-31').start.time).toBe('22:00') // "Doors: 22:00 (…)"
    expect(byId(events, '2026-11-06').start.time).toBe('21:00') // "doors open 21:00 Uhr"
    expect(byId(events, '2026-11-07').start.time).toBe('23:00') // "Beginn: 23 Uhr"
    expect(byId(events, '2026-12-19').start.time).toBe('22:00') // "Beginn 22 Uhr"
  })

  it('keeps the kind of night in the description and drops the drawn rules', () => {
    const factory = byId(read(), '2026-10-31')
    expect(factory.description).toBe(
      'Party\n\nDoors: 22:00 (Back to the roots: Ab jetzt wieder um 22 Uhr Beginn!)\n\nTickets: 5 vor 12! Bis 12 Uhr 5 Euro, danach 7 Euro\n\n' +
        'Factory // Oktober 2026 //\nWave, Gothic, Coldwave, Post-Punk, Indie, Synthpop, 80’s,\nFactory DJs\nEvery last Saturday of each month',
    )
    expect(factory.links).toBeUndefined()
    // The page links its own older uploads over http
    expect(factory.imageUrl).toBe('https://slaughterhouse-berlin.de/wp-content/uploads/2024/02/image-1-1024x711.png')
    expect(byId(read(), '2026-10-30').description).toMatch(/^Konzert \+ Party\n\nBeginn: 19:00\n/)
  })

  it('unwraps a Facebook redirect around the ticket link', () => {
    expect(byId(read(), '2026-11-14').links).toEqual({
      tickets: 'https://shotgun.live/events/sutcliffe-no-more-control-kommando-slaughterhouse',
    })
  })

  it('leaves a night without a time unverified and without a flyer', () => {
    expect(byId(read(), '2026-12-05')).toMatchObject({
      start: { date: '2026-12-05', time: null },
      timesStated: false,
      imageUrl: null,
      description: 'Konzert + Party\n\nProgramm im ganzen Haus\nIm Slaughterhouse:\n– Kinderdisco\n– Konzert: Without Shrimps, WR51, Wildberries\n– Party: DJ Mark Reeder',
    })
  })
})

describe('parseSlaughterhouse', () => {
  it('leaves out nights before today', () => {
    const events = read(page, new Date('2026-11-14T10:00:00Z'))
    expect(events[0]?.externalId).toBe('2026-11-14')
    expect(events).toHaveLength(7)
  })

  it('keeps a second event on the same day apart', () => {
    const twice = page.replace('07.11.2026<br>', '06.11.2026<br>')
    expect(twice).not.toBe(page)
    const events = read(twice)
    expect(byId(events, '2026-11-06').summary).toBe('Same Old Madness: Pentagon Edition')
    expect(byId(events, '2026-11-06-2').summary).toBe('Kiss My Blood')
  })

  it('reads an empty programme as no events, but no other page', () => {
    const empty = '<html><main><article><h1 class="entry-title">Veranstaltungen</h1><div class="entry-content"><p>Bald mehr!</p></div></article></main></html>'
    expect(read(empty)).toEqual([])
    expect(() => read('<html><h1>Impressum</h1><div class="entry-content"><p>Text</p></div></html>')).toThrow(FeedParseError)
  })

  it('rejects other timezones', () => {
    expect(() =>
      parseSlaughterhouse(page, ingestSourceConfigSchema.parse({ timezone: 'Europe/London' }), { pageUrl: PAGE, now: NOW }),
    ).toThrow(/Timezone/)
  })
})
