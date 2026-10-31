import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { FeedParseError, type FeedEvent } from './ical.js'
import { parseLidoListing, readLido } from './lido.js'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/lido/${name}.html`, import.meta.url)), 'utf8')
const listing = fixture('program')
const config = ingestSourceConfigSchema.parse({})
const PAGE = 'https://www.lido-berlin.de/'
// Saturday 2026-10-31, 12:00 Berlin: the day the fixtures were saved
const NOW = new Date('2026-10-31T11:00:00Z')

/** The event pages from the fixtures, by the slug in their URL; `fetched` records which were asked for. */
function site(edit: (html: string) => string = (html) => html) {
  const fetched: string[] = []
  const fetchText = async (url: string) => {
    const slug = url.split('/events/')[1]!
    fetched.push(slug)
    return edit(fixture(slug))
  }
  return { fetched, fetchText }
}

const read = (html = listing, now = NOW, fetchText = site().fetchText) => readLido(html, config, { pageUrl: PAGE, now, fetchText })

const byId = (events: FeedEvent[], id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

describe('parseLidoListing', () => {
  it('reads the cards of the programme with their day, times, kind and status', () => {
    const { cards, hasList } = parseLidoListing(listing, PAGE)
    expect(hasList).toBe(true)
    expect(cards.map((c) => [c.externalId, c.day, c.doors, c.start, c.kind, c.statuses])).toEqual([
      ['2026-10-31-twilight---party', { year: 2026, month: 10, day: 31 }, '23:59', '23:59', 'Party', []],
      ['2026-11-01-hi--spencer', { year: 2026, month: 11, day: 1 }, '19:00', '20:00', 'Konzert', []],
      ['2026-11-05-unnv', { year: 2026, month: 11, day: 5 }, '19:00', '20:00', 'Konzert', ['sold_out']],
      ['2026-11-10-sons-of-legion', { year: 2026, month: 11, day: 10 }, '19:00', '20:00', 'Konzert', ['new_venue']],
      ['2026-12-09-oathbreaker', { year: 2026, month: 12, day: 9 }, '19:00', '20:00', 'Konzert', ['new_venue']],
      ['2027-01-27-shred-fest-', { year: 2027, month: 1, day: 24 }, '16:00', '17:00', 'Konzert', []],
    ])
    expect(cards[1]).toMatchObject({
      url: 'https://www.lido-berlin.de/events/2026-11-01-hi--spencer',
      title: 'HI! SPENCER',
      subtitle: '+ Support: KORD',
      presenter: 'All Rooms Concerts',
    })
  })
})

describe('readLido (fixtures)', () => {
  it('reads every upcoming event from its card and its page', async () => {
    const { fetched, fetchText } = site()
    const events = await read(listing, NOW, fetchText)
    expect(events.map((e) => [e.externalId, e.summary, e.start.iso, e.locationRoom])).toEqual([
      ['2026-10-31-twilight---party', 'TWILIGHT - Party', '2026-10-31T23:59:00+01:00', 'Lido'],
      ['2026-11-01-hi--spencer', 'Hi! Spencer', '2026-11-01T20:00:00+01:00', 'Lido'],
      ['2026-11-05-unnv', 'UNNV', '2026-11-05T20:00:00+01:00', 'Lido'],
      ['2026-11-10-sons-of-legion', 'SONS OF LEGION', '2026-11-10T20:00:00+01:00', 'Columbia Theater'],
      ['2026-12-09-oathbreaker', 'OATHBREAKER', '2026-12-09T20:00:00+01:00', 'Kesselhaus'],
      ['2027-01-27-shred-fest-', 'SHRED FEST', '2027-01-24T17:00:00+01:00', 'Lido'],
    ])
    expect(fetched).toHaveLength(6)
  })

  it('maps a concert with its doors, prices, presenter, ticket link, flyer and text', async () => {
    const ev = byId(await read(), '2026-11-01-hi--spencer')
    expect(ev).toMatchObject({
      uid: 'https://www.lido-berlin.de/events/2026-11-01-hi--spencer',
      url: 'https://www.lido-berlin.de/events/2026-11-01-hi--spencer',
      end: null,
      imageUrl:
        'https://kulturhaeuser-production.s3.eu-central-1.amazonaws.com/uploads/event/image/12997/large_hispencer_instagram_ankuendigung_22.jpg',
      locationText: 'Lido',
      timesStated: true,
      links: { tickets: 'https://www.eventim.de/artist/hi-spencer/' },
    })
    expect(ev.description).toMatch(
      /^Konzert\n\n\+ Support: KORD\n\nEinlass 19:00\n\nTickets: 39,20 € VVK INKL\. GEBÜHR\n\nPräsentiert von All Rooms Concerts\n\nHi! Spencer machen mit/,
    )
  })

  it('takes the first of several ticket links and lists every price', async () => {
    const ev = byId(await read(), '2027-01-27-shred-fest-')
    expect(ev.links?.tickets).toMatch(/^https:\/\/www\.36-tickets\.de\//)
    expect(ev.description).toContain('Tickets: 44,00 € Abendkasse · 36,00 € Vorverkauf+ Geb')
  })

  it('keeps the placeholder time of a club night unverified', async () => {
    const ev = byId(await read(), '2026-10-31-twilight---party')
    expect(ev.timesStated).toBe(false)
    expect(ev.description).toMatch(/^Party\n\nThe best of the Twilight soundtrack/)
    expect(ev.description).not.toContain('Einlass')
  })

  it('places a concert moved to a bigger venue there and keeps the note', async () => {
    const ev = byId(await read(), '2026-11-10-sons-of-legion')
    expect(ev.locationText).toBe('Columbia Theater')
    expect(ev.description).toContain('HOCHVERLEGT IN DAS COLUMBIA THEATER.')
    // Without a venue in the note the place is left open
    const vague = listing.replace('HOCHVERLEGT IN DAS COLUMBIA THEATER.', 'HOCHVERLEGT.')
    expect(vague).not.toBe(listing)
    expect(byId(await read(vague), '2026-11-10-sons-of-legion').locationRoom).toBeNull()
  })

  it('says a sold-out concert is sold out once', async () => {
    const ev = byId(await read(), '2026-11-05-unnv')
    expect(ev.description).toContain('DAS KONZERT IST RESTLOS AUSVERKAUFT')
    expect(ev.description).not.toContain('\n\nAusverkauft\n\n')
  })

  it('leaves out cancelled events without fetching their page, and events before today', async () => {
    const cancelled = listing.replace('status__label">Ausverkauft', 'status__label">Abgesagt')
    expect(cancelled).not.toBe(listing)
    const { fetched, fetchText } = site()
    const events = await read(cancelled, NOW, fetchText)
    expect(events.map((e) => e.externalId)).not.toContain('2026-11-05-unnv')
    expect(fetched).not.toContain('2026-11-05-unnv')

    const later = await read(listing, new Date('2026-11-02T11:00:00Z'))
    expect(later.map((e) => e.externalId)).not.toContain('2026-11-01-hi--spencer')
  })

  it('keeps the hash when the site answers in English instead of German', async () => {
    const english = (html: string) =>
      html
        .replaceAll('time__label">Einlass', 'time__label">Doors')
        .replaceAll('status__label">Ausverkauft', 'status__label">sold out')
        .replaceAll('status__label">Verlegt', 'status__label">new venue')
        .replaceAll('type__label">Konzert', 'type__label">Concert')
        .replace(/price__value">(\d+),(\d{2})/g, 'price__value">$1.$2')
    expect(english(listing)).not.toBe(listing)
    expect(english(fixture('2026-11-01-hi--spencer'))).toContain('price__value">39.20')
    const german = await read()
    const translated = await read(english(listing), NOW, site(english).fetchText)
    expect(translated.map((e) => e.hash)).toEqual(german.map((e) => e.hash))
    expect(translated.map((e) => e.description)).toEqual(german.map((e) => e.description))
  })

  it('fails the run when an event page cannot be fetched', async () => {
    const failing = async () => {
      throw new Error('HTTP 502')
    }
    await expect(read(listing, NOW, failing)).rejects.toThrow(/Event page https:\/\/www\.lido-berlin\.de\/events\/.*: HTTP 502/)
  })

  it('fails on a page without the programme, and reads an empty programme as no events', async () => {
    await expect(read('<html><body>Wartungsarbeiten</body></html>')).rejects.toThrow(FeedParseError)
    const empty = listing.replace(/<article class="event-ticket[\s\S]*<\/article>/, '')
    expect(await read(empty)).toEqual([])
  })
})
