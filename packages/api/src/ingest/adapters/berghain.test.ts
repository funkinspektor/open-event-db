import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { FeedParseError, type FeedEvent } from './ical.js'
import { parseBerghainListing, readBerghain } from './berghain.js'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/berghain/${name}.html`, import.meta.url)), 'utf8')

const club = fixture('program')
const kantine = fixture('kantine')
const config = ingestSourceConfigSchema.parse({})
const CLUB = 'https://www.berghain.berlin/de/program/'
const KANTINE = 'https://www.berghain.berlin/de/program/kantine-am-berghain/'
const EVENT = 'https://www.berghain.berlin/de/event/'
// Thursday 2026-10-29, 11:00 Berlin: the day the fixtures were saved
const NOW = new Date('2026-10-29T10:00:00Z')

/** Event pages by id; the trimmed listings link only these (and cancelled cards, which are never fetched). */
function eventFetcher(overrides: Record<string, string> = {}) {
  const fetched: string[] = []
  const fetchText = async (url: string) => {
    fetched.push(url)
    const id = url.match(/^https:\/\/www\.berghain\.berlin\/de\/event\/(\d+)\/$/)?.[1]
    if (!id) throw new Error(`no fixture for ${url}`)
    return overrides[id] ?? fixture(`event-${id}`)
  }
  return { fetched, fetchText }
}

const read = (html: string, pageUrl = CLUB, fetchText = eventFetcher().fetchText, now = NOW) =>
  readBerghain(html, config, { pageUrl, now, fetchText })

const byId = (events: FeedEvent[], id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

describe('parseBerghainListing', () => {
  it('reads the club cards with their floors, doors and start', () => {
    const cards = parseBerghainListing(club, CLUB)
    expect(cards.map((c) => [c.externalId, c.title, c.rooms])).toEqual([
      ['80850', 'Sound Metaphors Festival Part 1', ['Berghain']],
      ['80749', 'Klubnacht', ['Berghain', 'Panorama Bar']],
      ['80851', 'Mirror Zone', ['Säule']],
      ['74350', 'FC SNAX UNiTED', ['Berghain', 'Lab.oratory']],
      ['80751', 'Klubnacht', ['Berghain', 'Panorama Bar']],
      ['81948', 'West-Eastern Divan Festival: Musik von Mark Simpson & Pierre Boulez', ['Berghain']],
    ])
    expect(cards.at(-1)).toMatchObject({
      url: `${EVENT}81948/`,
      day: { year: 2026, month: 11, day: 18 },
      doors: '19:30',
      start: '21:00',
    })
    expect(cards[0]).toMatchObject({ doors: null, start: '19:00' })
  })

  it('reads an empty listing as no events', () => {
    expect(parseBerghainListing(fixture('halle'), 'https://www.berghain.berlin/de/program/halle/')).toEqual([])
  })

  it('rejects the English pages and pages without a programme', () => {
    expect(() => parseBerghainListing(club.replace('lang="de"', 'lang="en"'), CLUB)).toThrow(/German/)
    expect(() => parseBerghainListing('<html lang="de"><h1>Shop</h1></html>', CLUB)).toThrow(FeedParseError)
  })
})

describe('readBerghain (fixtures)', () => {
  it('maps a concert with its running order, tickets and text', async () => {
    const ev = byId(await read(club), '80850')
    expect(ev).toMatchObject({
      uid: `${EVENT}80850/`,
      summary: 'Sound Metaphors Festival Part 1',
      start: { date: '2026-10-29', time: '19:00', iso: '2026-10-29T19:00:00+01:00' },
      end: { date: '2026-10-29', time: '23:30', iso: '2026-10-29T23:30:00+01:00' },
      url: `${EVENT}80850/`,
      imageUrl: 'https://cdn.berghain.berlin/media/images/2026_SM_FESTIVAL_Berghain_Banner.width-800.jpg',
      locationRoom: 'Berghain',
      locationText: 'Berghain',
      timesStated: true,
      links: { tickets: 'https://ticketingv2.berghain.de/event/event-24418-2026' },
    })
    expect(ev.description).toMatch(
      /^Berghain\n19:00 ASIA\n20:30 Jonathan Fitoussi \(Live\) – Transversales Disques\n21:30 Grand River \(Live\) – Editions Mego\n22:30 Alessandro Cortini \(Live\) – Mute\n\nTickets: 36,00€ via Berghain · 38,00€ Abendkasse\n\nOctober 28-30, 2026\n/,
    )
  })

  it('lists a Klubnacht floor by floor, starting at 23:59, ending with its last set', async () => {
    const ev = byId(await read(club), '80749')
    expect(ev).toMatchObject({
      start: { date: '2026-10-31', time: '23:59' },
      // Monday morning: longer than a day, so the draft keeps no end
      end: { date: '2026-11-02', time: '05:30' },
      locationRoom: 'Berghain',
      locationText: 'Berghain, Panorama Bar',
      links: {},
    })
    expect(ev.description).toContain('01:30 GiGi FM – Sea~rène\n\nPanorama Bar\n23:59 Alex Kassian – Love On The Rocks\n')
  })

  it('keeps b2b acts on one line and drops the stand-in artwork', async () => {
    const ev = byId(await read(club), '80851')
    expect(ev.description).toBe(
      'Säule\nDonia (Live)\nSampi (Live)\nSpekki Webu b2b Lilian Stark\nV:SONNTAG\n\nTickets: 14,00€ via Berghain · 16,00€ Abendkasse',
    )
    expect(ev.imageUrl).toBeNull()
    expect(ev.end).toBeNull()
  })

  it('states the doors and a sold-out show without a ticket link', async () => {
    const ev = byId(await read(club), '81948')
    expect(ev.description).toMatch(/^Einlass 19:30\n\nTickets: Ausverkauft · Alter 18\+\n\nEinlass ab 18 Jahren/)
    expect(ev.links).toEqual({})
    expect(ev.start.iso).toBe('2026-11-18T21:00:00+01:00')
  })

  it('keeps two events on one day apart by their id', async () => {
    const events = await read(club)
    expect(events.filter((e) => e.start.date === '2026-11-14').map((e) => e.externalId)).toEqual(['74350', '80751'])
  })

  it('leaves out cancelled, postponed and moved Kantine shows without fetching them', async () => {
    const { fetched, fetchText } = eventFetcher()
    const events = await read(kantine, KANTINE, fetchText)
    expect(events.map((e) => e.externalId)).toEqual(['81644', '82059', '82678'])
    expect(fetched).toEqual([`${EVENT}81644/`, `${EVENT}82059/`, `${EVENT}82678/`])
    expect(byId(events, '81644')).toMatchObject({
      locationRoom: 'Kantine am Berghain',
      links: { tickets: 'https://www.tixforgigs.com/Event/76500' },
    })
    expect(byId(events, '81644').description).toMatch(/^Einlass 19:00\n\nzeug \(Live\)\nvold \(Live\)\n\nTickets: 17,60€ via Tix for Gigs\n\n/)
    expect(byId(events, '81644').description).toMatch(/\n\nEine Veranstaltung von \[Beyond Booking\]\(https:\/\/www\.beyondbooking\.live\/\)$/)
  })

  it('skips past events without fetching them', async () => {
    const { fetched, fetchText } = eventFetcher()
    const events = await read(club, CLUB, fetchText, new Date('2026-10-30T10:00:00Z'))
    expect(events.map((e) => e.externalId)).not.toContain('80850')
    expect(fetched).not.toContain(`${EVENT}80850/`)
  })

  it('hashes the event, not the page scripts', async () => {
    const page = fixture('event-80850')
    const withScript = page.replace('</main>', '<script>var now = 1</script></main>')
    const changed = page.replace('38,00€ Abendkasse', '40,00€ Abendkasse')
    const hash = async (html: string) => byId(await read(club, CLUB, eventFetcher({ '80850': html }).fetchText), '80850').hash
    expect(await hash(withScript)).toBe(await hash(page))
    expect(await hash(changed)).not.toBe(await hash(page))
  })

  it('fails when an event page cannot be fetched', async () => {
    const fetchText = async (url: string) => {
      if (url.includes('80851')) throw new Error('Feed answered HTTP 503')
      return eventFetcher().fetchText(url)
    }
    await expect(read(club, CLUB, fetchText)).rejects.toThrow(`Detail page ${EVENT}80851/: Feed answered HTTP 503`)
  })
})
