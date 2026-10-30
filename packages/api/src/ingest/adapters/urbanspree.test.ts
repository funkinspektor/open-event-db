import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { FeedParseError, type FeedEvent } from './ical.js'
import { cleanTitle, parseUrbanSpreeDetail, parseUrbanSpreeListing, readUrbanSpree, type UrbanSpreeCard } from './urbanspree.js'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/urbanspree/${name}.html`, import.meta.url)), 'utf8')

const listing = fixture('program')
const config = ingestSourceConfigSchema.parse({})
const PAGE = 'https://www.urbanspree.com/program/?limit=100'
const SITE = 'https://www.urbanspree.com/program/'
// Thursday 2026-10-29, 11:00 Berlin: the day the fixtures were saved
const NOW = new Date('2026-10-29T10:00:00Z')

/** Detail fixtures by a word of their URL; the trimmed listing links only these (and past or cancelled cards). */
const URBANSPREE_DETAILS: Record<string, string> = {
  'flame-parade': 'flame-parade',
  'escape-with-romeo': 'escape-with-romeo',
  tigercub: 'tigercub',
  'wholetrain-20': 'wholetrain-20',
  'mayflower-madame': 'mayflower-madame',
  thaylo: 'thaylo',
  'pure-obsessions': 'pure-obsessions',
  'exhibitions/reconnections': 'reconnection',
}

function detailFetcher(overrides: Record<string, string> = {}) {
  const fetched: string[] = []
  const fetchText = async (url: string) => {
    fetched.push(url)
    const key = Object.keys(URBANSPREE_DETAILS).find((k) => url.includes(k))
    if (!key) throw new Error(`no fixture for ${url}`)
    return overrides[key] ?? fixture(URBANSPREE_DETAILS[key]!)
  }
  return { fetched, fetchText }
}

const read = (html: string, fetchText = detailFetcher().fetchText, now = NOW) =>
  readUrbanSpree(html, config, { pageUrl: PAGE, now, fetchText })

const byId = (events: FeedEvent[], id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

describe('readUrbanSpree (fixtures)', () => {
  it('fetches the detail pages of upcoming cards only and keeps the listing order', async () => {
    const { fetched, fetchText } = detailFetcher()
    const events = await read(listing, fetchText)
    expect(events.map((e) => e.externalId)).toEqual([
      'concerts/pure-obsessions-and-red-nights-nico-amara-urban-spree-berlin',
      'concerts/thaylo-darin-epsilon-gareden',
      'concerts/mayflower-madame-blke-berlin-show-urban-spree',
      'concerts/tigercub-nets-to-catch-the-wind-berlin',
      'exhibitions/wholetrain-20',
      'concerts/escape-with-romeo-urban-spree-berlin',
      'concerts/flame-parade,-alice-gift-anna-grob-29.10.2026-urban-spree-berlin',
    ])
    // The cancelled Howlers show is not fetched; Reconnection is still on show, so its page is read
    expect(fetched.some((url) => url.includes('howlers'))).toBe(false)
    expect(fetched.at(-1)).toBe(`${SITE}exhibitions/reconnections.html`)
    expect(fetched).toHaveLength(8)
  })

  it('maps a concert with its detail page', async () => {
    const flame = byId(await read(listing), 'concerts/flame-parade,-alice-gift-anna-grob-29.10.2026-urban-spree-berlin')
    const url = `${SITE}concerts/flame-parade,-alice-gift-anna-grob-29.10.2026-urban-spree-berlin.html`
    expect(flame).toMatchObject({
      uid: url,
      summary: 'FLAME PARADE, ALICE GIFT + ANNA GROB',
      start: { date: '2026-10-29', time: '20:00', iso: '2026-10-29T20:00:00+01:00' },
      end: null,
      url,
      imageUrl:
        'https://www.urbanspree.com/assets/project/urbanspree/mediasource/802597257_1714072960720062_4887670497438814768_n.jpg',
      locationRoom: 'Urban Spree',
      locationText: 'Urban Spree',
      timesStated: true,
      links: {
        tickets: 'https://rausgegangen.de/events/flame-parade-alice-gift-29102026-urban-spree-berlin-0/',
        facebook: 'https://www.facebook.com/events/1382782440102291',
      },
    })
    expect(flame.description).toMatch(
      /^Donnerstag 29\.10\.2026\n\nUrban Spree \/ Berlin\nLive:\n\nFLAME PARADE \(Indie\/Dreampop\/Alternative, IT\)\nVideo:\n\[Flame Parade - Ballad of the Ghost \(Official Video\) ft\. Dellera\]\(https:\/\/www\.youtube\.com\/watch\?v=cERVhHGea1A\)\n/,
    )
    expect(flame.description).toContain('\n\nEinlass: 20.00 Uhr\nBeginn: 20:30 Uhr\n\n')
    expect(flame.description).toMatch(/\n\nEintritt: 14\.00€$/)
    expect(flame.description).not.toContain(' ')
  })

  it('drops "SOLD OUT" from the title and says it in the description, unwrapping Facebook redirects', async () => {
    const tigercub = byId(await read(listing), 'concerts/tigercub-nets-to-catch-the-wind-berlin')
    expect(tigercub.summary).toBe('Tigercub - NETS TO CATCH THE WIND')
    expect(tigercub.description).toMatch(/^Ausverkauft\n\nTIGERCUB\nNETS TO CATCH THE WIND TOUR 2026\n\nTickets: \[kj\.de\/zq\]\(http:\/\/kj\.de\/zq\)\n/)
    expect(tigercub.description).not.toContain('l.facebook.com')
  })

  it('does not trust the placeholder time of a club night', async () => {
    const thaylo = byId(await read(listing), 'concerts/thaylo-darin-epsilon-gareden')
    expect(thaylo.summary).toBe('Thaylo x URBAN SPREE')
    expect(thaylo.start).toEqual({ date: '2026-12-05', time: '23:59', iso: '2026-12-05T23:59:00+01:00' })
    expect(thaylo.timesStated).toBe(false)
    expect(thaylo.links).toEqual({ tickets: 'https://ra.co/events/2565755#tickets' })
  })

  it('ignores empty link placeholders', async () => {
    const pure = byId(await read(listing), 'concerts/pure-obsessions-and-red-nights-nico-amara-urban-spree-berlin')
    // The page's "Visit website" points at a bare "https://"
    expect(Object.values(pure.links ?? {})).not.toContain('https://')
    expect(pure.description).toMatch(/^Pure Obsessions & Red Nights\nSupport: Nico Amara\nDoors: 20H\n/)
  })

  it('turns an exhibition into its opening night', async () => {
    const wholetrain = byId(await read(listing), 'exhibitions/wholetrain-20')
    expect(wholetrain).toMatchObject({
      summary: 'Vernissage: Wholetrain 20',
      start: { date: '2026-11-06', time: '18:00', iso: '2026-11-06T18:00:00+01:00' },
      end: null,
      timesStated: true,
      links: {},
    })
    expect(wholetrain.description).toMatch(
      /^Mit WON ABC, NEON\nAusstellung 06\.11\.2026–28\.11\.2026\nÖffnungszeiten: Monday-Saturday: 11:00-19:00\n\nUrban Spree Galerie presents "WHOLETRAIN 20“/,
    )
    expect(wholetrain.description).toMatch(/\n\nEintritt frei$/)
  })

  it('skips an exhibition whose opening is listed as an event of its own', async () => {
    // Move Reconnection's opening card and the exhibition's vernissage into the future
    const shifted = listing
      .replace('data-dateStart="2026-09-11 18:00:00"', 'data-dateStart="2026-11-11 18:00:00"')
      .replace('data-datestart="2026-09-11"', 'data-datestart="2026-11-11"')
    const page = fixture('reconnection').replace('Sep 11, 2026 18:00', 'Nov 11, 2026 18:00')
    const opening = `<!doctype html><html><body><main><div id="pseudo-card"><h1 class="title">Reconnection: Berlin Art Week Opening</h1></div></main></body></html>`
    const { fetchText } = detailFetcher({ 'exhibitions/reconnections': page })
    const events = await read(shifted, async (url) => (url.includes('reconnection-berlin-art-week') ? opening : fetchText(url)))
    expect(events.map((e) => e.externalId)).toContain('events/reconnection-berlin-art-week-opening')
    expect(events.map((e) => e.externalId)).not.toContain('exhibitions/reconnections')
  })

  it('keeps the hash when only the serving day changes, and changes it with the content', async () => {
    const before = byId(await read(listing), 'exhibitions/wholetrain-20')
    const nextDay = byId(await read(listing.replaceAll('data-getdate="2026-10-29"', 'data-getdate="2026-10-30"')), 'exhibitions/wholetrain-20')
    expect(nextDay.hash).toBe(before.hash)

    const { fetchText } = detailFetcher({ 'wholetrain-20': fixture('wholetrain-20').replace('Nov 06, 2026 18:00', 'Nov 06, 2026 19:00') })
    const later = byId(await read(listing, fetchText), 'exhibitions/wholetrain-20')
    expect(later.start.time).toBe('19:00')
    expect(later.hash).not.toBe(before.hash)
  })

  it('fails when the listing does not reach back to today', async () => {
    const future = listing.replace(/data-date([sS])tart="2026-(?:0\d-\d\d|10-2[0-8])/g, 'data-date$1tart="2027-01-01')
    await expect(read(future)).rejects.toThrow(/raise \?limit=/)
  })

  it('fails the run when a detail page cannot be fetched', async () => {
    const failing = async (url: string) => {
      if (url.includes('tigercub')) throw new Error('Feed answered HTTP 503')
      return detailFetcher().fetchText(url)
    }
    await expect(read(listing, failing)).rejects.toThrow(
      `Detail page ${SITE}concerts/tigercub-nets-to-catch-the-wind-berlin.html: Feed answered HTTP 503`,
    )
  })

  it('fails on a page that is not a programme listing or an event', async () => {
    await expect(read('<html><body><p>Wartungsarbeiten</p></body></html>')).rejects.toThrow(FeedParseError)
    const { fetchText } = detailFetcher({ thaylo: '<html><body><h1>Error</h1></body></html>' })
    await expect(read(listing, fetchText)).rejects.toThrow(/No event title \(h1\.title\)/)
  })

  it('rejects other timezones', async () => {
    const other = ingestSourceConfigSchema.parse({ timezone: 'Europe/Paris' })
    await expect(readUrbanSpree(listing, other, { pageUrl: PAGE, now: NOW, fetchText: detailFetcher().fetchText })).rejects.toThrow(
      /Timezone Europe\/Paris is not supported/,
    )
  })
})

describe('parseUrbanSpreeDetail', () => {
  // A text copied from the Facebook event: ends with the venue's address block and tracked links
  const card: UrbanSpreeCard = {
    kind: 'concert',
    externalId: 'concerts/linear-movement-der-künftige-musikant-twilight-ritual',
    url: `${SITE}concerts/linear-movement-der-k%C3%BCnftige-musikant-twilight-ritual.html`,
    title: 'LINEAR MOVEMENT + DER KÜNFTIGE MUSIKANT +…',
    day: { year: 2027, month: 1, day: 9 },
    time: '20:00',
    endDay: null,
    imageUrl: null,
    raw: '',
  }
  const linearMovement = () => parseUrbanSpreeDetail(fixture('linear-movement'), card, { today: { year: 2026, month: 10, day: 29 }, cards: [card] })!

  it("drops the venue's own address and links at the end of the text", () => {
    const { description } = linearMovement()
    expect(description).toMatch(/\n\nhttps:\/\/de\.ra\.co\/events\/2568934\n\nEintritt: 34\.56€$/)
    expect(description).not.toMatch(/RAW-Area|Revaler|10245|facebook\.com\/UrbanSpree/i)
  })

  it("strips Facebook's tracking parameters from links in the text", () => {
    const { description } = linearMovement()
    expect(description).toContain('(http://www.linear-movement.bandcamp.com/)')
    expect(description).not.toMatch(/fbclid|__cft__|__tn__/)
  })

  it('keeps a trailing paragraph that says more than where the venue is', () => {
    const page = fixture('linear-movement').replace('Urban Spree (RAW-Area)<br class="html-br" />', 'Urban Spree (RAW-Area)<br class="html-br" />Einlass 19 Uhr<br class="html-br" />')
    expect(parseUrbanSpreeDetail(page, card, { today: { year: 2026, month: 10, day: 29 }, cards: [card] })!.description).toContain(
      'Urban Spree (RAW-Area)\nEinlass 19 Uhr\nRevaler Str. 99/Warschauer Str.',
    )
  })
})

describe('parseUrbanSpreeListing', () => {
  it('resolves card links against <base href>, not the listing path', () => {
    const cards = parseUrbanSpreeListing(listing, PAGE)
    expect(cards).toHaveLength(13)
    expect(cards[0]).toMatchObject({
      kind: 'concert',
      url: `${SITE}concerts/pure-obsessions-and-red-nights-nico-amara-urban-spree-berlin.html`,
      title: 'Pure Obsessions & Red Nights + Nico Amara…',
      day: { year: 2027, month: 4, day: 23 },
      time: '20:00',
      endDay: null,
    })
    expect(cards.find((c) => c.externalId === 'exhibitions/wholetrain-20')).toMatchObject({
      kind: 'exhibit',
      day: { year: 2026, month: 11, day: 6 },
      time: null,
      endDay: { year: 2026, month: 11, day: 28 },
    })
    expect(cards.find((c) => c.externalId === 'events/reconnection-berlin-art-week-opening')?.kind).toBe('event')
  })
})

describe('cleanTitle', () => {
  it.each([
    ['FLAME PARADE, ALICE GIFT + ANNA GROB | 29.10.2026 | Urban Spree Berlin', 'FLAME PARADE, ALICE GIFT + ANNA GROB'],
    ['Escape with Romeo - Urban Spree - Berlin', 'Escape with Romeo'],
    ['June McDoom - BERLIN • URBAN SPREE', 'June McDoom'],
    ['DAIANA LOU - Live in Berlin, Urban Spree', 'DAIANA LOU'],
    ['MAYFLOWER MADAME + BLKE - Berlin Show @Urban Spree', 'MAYFLOWER MADAME + BLKE'],
    ['FÏX8:SËD8 + NEROGRIS + SCHNEIDER -  Urban Spree, Berlin', 'FÏX8:SËD8 + NEROGRIS + SCHNEIDER'],
    ['unpeople - berlin - urban spree', 'unpeople'],
    ['JUD | Urban Spree Berlin', 'JUD'],
    // Kept: not only place or date after the last separator, or no separator at all
    ['WISBORG Phantomschmerz Tour - BERLIN | Special Guest: The Fright', 'WISBORG Phantomschmerz Tour - BERLIN | Special Guest: The Fright'],
    ['Novulent - Live in Europe 2026', 'Novulent - Live in Europe 2026'],
    ['Process Party x Effetto Notte: Hall of Bats with Lovataraxx, Hysteric Helen, Olgha', 'Process Party x Effetto Notte: Hall of Bats with Lovataraxx, Hysteric Helen, Olgha'],
    ['Thaylo x URBAN SPREE', 'Thaylo x URBAN SPREE'],
    ['URBAN SPREE KLUBNACHT 23.10.2026', 'URBAN SPREE KLUBNACHT 23.10.2026'],
    ['Urban Spree - Berlin', 'Urban Spree'],
  ])('%s', (heading, title) => {
    expect(cleanTitle(heading)).toEqual({ title, soldOut: false })
  })

  it('takes "SOLD OUT" off the front', () => {
    expect(cleanTitle('SOLD OUT - Tigercub - NETS TO CATCH THE WIND - Berlin')).toEqual({
      title: 'Tigercub - NETS TO CATCH THE WIND',
      soldOut: true,
    })
    expect(cleanTitle('Ausverkauft: Coilguns')).toEqual({ title: 'Coilguns', soldOut: true })
  })
})
