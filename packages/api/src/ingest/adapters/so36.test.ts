import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { FeedParseError, type FeedEvent } from './ical.js'
import { parseSo36Listing, readableTitle, readSo36 } from './so36.js'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/so36/${name}`, import.meta.url)), 'utf8')
const listing = fixture('listing.json')
const config = ingestSourceConfigSchema.parse({})
const PAGE =
  'https://www.so36.com/orte/so36?page=1&pagesize=500&arguments=articles%3Aimage%2Carticles%3Atitle%2Clocation%3Atitle%2Carticles%3Avalid_start_on&table_id=product_table_shop-locations_controller_show_1'
// Tuesday 2026-11-10, 12:00 Berlin: the day the fixtures were saved
const NOW = new Date('2026-11-10T11:00:00Z')
const WALLS = '99538'
const WALLS_URL = 'https://www.so36.com/produkte/99538-tickets-walls-of-jericho-so36-berlin-am-10-11-2026'

/** The event pages from the fixtures, by the product id in their URL; `fetched` records which were asked for. */
function site(edit: (html: string, id: string) => string = (html) => html) {
  const fetched: string[] = []
  const fetchText = async (url: string) => {
    const id = url.split('/produkte/')[1]!.split('-')[0]!
    fetched.push(id)
    return edit(fixture(`${id}.html`), id)
  }
  return { fetched, fetchText }
}

const read = (json = listing, now = NOW, fetchText = site().fetchText) => readSo36(json, config, { pageUrl: PAGE, now, fetchText })

const byId = (events: FeedEvent[], id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

/** The listing with its rows edited, as the shop would serve it. */
function editListing(edit: (rows: Record<string, unknown>[]) => Record<string, unknown>[]): string {
  const json = JSON.parse(listing) as { data: Record<string, unknown>[]; meta: Record<string, unknown> }
  json.data = edit(json.data)
  json.meta.total = json.data.length
  return JSON.stringify(json)
}

describe('parseSo36Listing', () => {
  it('reads each row: id, link, title and subtitle, day, start, room and sold-out mark', () => {
    const rows = parseSo36Listing(listing, PAGE)
    expect(rows.map((r) => r.externalId)).toEqual(['99538', '102902', '101980', '92090', '91521', '100260'])
    expect(rows[0]).toEqual({
      externalId: WALLS,
      url: WALLS_URL,
      title: 'WALLS OF JERICHO',
      subtitle: 'Special Guest: SHÆTTERED & WAVES LIKE WALLS',
      day: { year: 2026, month: 11, day: 10 },
      start: '20:00',
      room: 'SO36',
      soldOut: false,
    })
    expect(rows.find((r) => r.externalId === '91521')?.soldOut).toBe(true)
    // "sold_out_status_other2" is some other mark, not sold out
    expect(rows.find((r) => r.externalId === '92090')?.soldOut).toBe(false)
  })

  it('fails on a listing cut short by its page size, on non-JSON and on JSON without rows', () => {
    const json = JSON.parse(listing) as { meta: Record<string, unknown> }
    json.meta.total = 89
    expect(() => parseSo36Listing(JSON.stringify(json), PAGE)).toThrow(/6 of 89 events: raise pagesize=/)
    expect(() => parseSo36Listing('<html>Wartung</html>', PAGE)).toThrow(FeedParseError)
    expect(() => parseSo36Listing('{"error":"nope"}', PAGE)).toThrow(FeedParseError)
  })
})

describe('readSo36', () => {
  it('reads every upcoming event from its row and its page', async () => {
    const { fetched, fetchText } = site()
    const events = await read(listing, NOW, fetchText)
    expect(events.map((e) => e.externalId)).toEqual(['99538', '102902', '101980', '92090', '91521', '100260'])
    expect(fetched).toEqual(events.map((e) => e.externalId))
  })

  it('maps a concert: the title as its text spells it, kind, subtitle, doors, price, text, image', async () => {
    const ev = byId(await read(), WALLS)
    expect(ev).toMatchObject({
      uid: WALLS_URL,
      summary: 'Walls Of Jericho',
      start: { date: '2026-11-10', time: '20:00', iso: '2026-11-10T20:00:00+01:00' },
      end: null,
      url: WALLS_URL,
      imageUrl: 'https://www.so36.com/uploads/so36/ticket/image/99538/101126_WallsofJericho_Insta_1787650723.png',
      locationRoom: 'SO36',
      locationText: 'SO36',
      timesStated: true,
    })
    expect(ev.description).toMatch(
      /^Konzert\n\nSpecial Guest: SHÆTTERED & WAVES LIKE WALLS\n\nEinlass 19:30\n\nTickets: 33,10 €\n\nMetalcore as we know it today would not exist without the Detroit legends Walls Of Jericho\./,
    )
    expect(ev.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps the links of the text and says a sold-out concert is sold out', async () => {
    const ev = byId(await read(), '91521')
    expect(ev.description).toMatch(/^Konzert\n\n\+ Special Guests: MUTTIS LIEBLINGE \+ THE IONIS\n\nAusverkauft\n\nEinlass 19:00\n\nTickets: 31,40 €\n\n/)
    expect(ev.description).toContain('(http://www.muttis-lieblinge.de/)')
  })

  it('keeps the placeholder time of a club night unverified and leaves out doors equal to the start', async () => {
    const events = await read()
    expect(byId(events, '102902')).toMatchObject({ summary: 'La Casa del Perreo', start: { time: '23:59' }, timesStated: false })
    expect(byId(events, '102902').description).toMatch(/^Party\n\nReggaeton \* Urban Latin\n\nTickets: 14,15 €\n\n/)
    const girlstown = byId(events, '101980')
    expect(girlstown).toMatchObject({ summary: 'GIRLSTOWN', start: { time: '22:00' }, timesStated: true })
    expect(girlstown.description).not.toContain('Einlass')
  })

  it('drops the empty "Event" category and a price of zero', async () => {
    const ev = byId(await read(), '92090')
    expect(ev.description).toMatch(/^Finale in Berlin\n\nEinlass 19:00\n\nDAV Jura-Slammer:innen/)
  })

  it('leaves out events before today, called off in the title, or cancelled or postponed on their page', async () => {
    const json = editListing((rows) =>
      rows.map((row) => {
        if (row.id === 99538) return { ...row, 'articles:valid_start_on': '<strong>Mo 09.11.2026</strong> <small class="subtitle">20:00</small>' }
        if (row.id === 101980) return { ...row, 'articles:title': '<strong>GIRLSTOWN</strong> <small class="subtitle">ABGESAGT</small>' }
        return row
      }),
    )
    const { fetched, fetchText } = site((html, id) =>
      id === '100260' ? html.replace('https://schema.org/EventScheduled', 'https://schema.org/EventCancelled') : html,
    )
    const events = await read(json, NOW, fetchText)
    expect(events.map((e) => e.externalId)).toEqual(['102902', '92090', '91521'])
    expect(fetched).toEqual(['102902', '92090', '91521', '100260'])
  })

  it('keeps the hash when only the page around the event changes', async () => {
    const before = byId(await read(), WALLS).hash
    const after = byId(
      await read(listing, NOW, site((html) => html.replace(/content="[^"]+" name="csrf-token"|name="csrf-token" content="[^"]+"/, 'name="csrf-token" content="new"')).fetchText),
      WALLS,
    ).hash
    expect(after).toBe(before)
  })

  it('fails the run when an event page cannot be fetched', async () => {
    const fetchText = async (url: string) => {
      if (url.includes('/produkte/101980-')) throw new Error('HTTP 502')
      return site().fetchText(url)
    }
    await expect(read(listing, NOW, fetchText)).rejects.toThrow(/Event page https:\/\/www\.so36\.com\/produkte\/101980-.*HTTP 502/)
  })

  it('reads an empty listing as no events', async () => {
    expect(await read(editListing(() => []))).toEqual([])
  })

  it('only supports the Berlin timezone', async () => {
    const other = ingestSourceConfigSchema.parse({ timezone: 'Europe/Lisbon' })
    await expect(readSo36(listing, other, { pageUrl: PAGE, now: NOW, fetchText: site().fetchText })).rejects.toThrow(FeedParseError)
  })
})

describe('readableTitle', () => {
  it('takes the spelling of the text for an all-caps title, as a whole word with a capital only', () => {
    expect(readableTitle("MOTHER'S CAKE", "Live: Mother's Cake from Austria")).toBe("Mother's Cake")
    expect(readableTitle('OOES', 'Shoes and more OOES')).toBe('OOES')
    expect(readableTitle('NASTY', 'nastyboys and Nasty')).toBe('Nasty')
    expect(readableTitle('DIE WALLERTS', 'Heute spielen die wallerts, Die Wallerts!')).toBe('Die Wallerts')
    expect(readableTitle('TX2', 'tx2 live')).toBe('TX2')
    expect(readableTitle('Hi! Spencer', 'HI! SPENCER')).toBe('Hi! Spencer')
  })
})
