import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { FeedParseError, type FeedEvent } from './ical.js'
import { readSchokoladen } from './schokoladen.js'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/schokoladen/${name}`, import.meta.url)), 'utf8')
const PAGE_1 = fixture('page-1.html')
const PAGE_8 = fixture('page-8.html')
/** A page past the last: the frame without events or pager. */
const EMPTY = fixture('page-9.html')
const CALENDAR = fixture('calendar.json')
const config = ingestSourceConfigSchema.parse({})
const PAGE = 'https://www.schokoladen-mitte.de/'
// Saturday 2026-10-31, 12:00 Berlin: the day the fixtures were saved
const NOW = new Date('2026-10-31T11:00:00Z')

const HALLOWEEN = '8008'
const KARAOKE = '10-2026-11-01'

/**
 * The site as saved: page 1 and page 8 of 8, the calendar. Pages 2–7 are served empty, which keeps the
 * fixtures small; their events are on the calendar all the same.
 */
function site(over: { page1?: string; page8?: string; calendar?: string; fail?: string } = {}) {
  const fetched: string[] = []
  const fetchText = async (url: string) => {
    fetched.push(url)
    if (over.fail && url.includes(over.fail)) throw new Error('Feed answered HTTP 502')
    const u = new URL(url)
    if (u.pathname === '/calendar') return over.calendar ?? CALENDAR
    if (u.search === '?page=8') return over.page8 ?? PAGE_8
    if (/^\?page=[2-7]$/.test(u.search)) return EMPTY
    throw new Error(`unexpected fetch ${url}`)
  }
  return { fetched, fetchText }
}

async function read(over: Parameters<typeof site>[0] = {}, now = NOW) {
  const { fetchText } = site(over)
  return readSchokoladen(over.page1 ?? PAGE_1, config, { pageUrl: PAGE, now, fetchText })
}

const byId = (events: FeedEvent[], id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

describe('readSchokoladen (schokoladen-mitte.de fixtures)', () => {
  it('reads every listing page, then the calendar for the ids', async () => {
    const { fetched, fetchText } = site()
    const events = await readSchokoladen(PAGE_1, config, { pageUrl: PAGE, now: NOW, fetchText })
    expect(fetched).toEqual([2, 3, 4, 5, 6, 7, 8].map((n) => `${PAGE}?page=${n}`).concat(`${PAGE}calendar`))
    expect(events.map((e) => [e.externalId, e.start.date])).toEqual([
      [HALLOWEEN, '2026-10-31'],
      [KARAOKE, '2026-11-01'],
      ['7897', '2026-11-02'],
      ['12-2026-11-03', '2026-11-03'],
      ['8031', '2026-11-04'],
      ['8037', '2026-11-05'],
      ['8015', '2026-11-06'],
      ['8027', '2026-11-07'],
      ['7998', '2026-11-09'],
      ['7971', '2026-11-10'],
      ['8035', '2027-04-02'],
      ['8025', '2027-05-16'],
    ])
  })

  it('maps a concert with its show time, flyer, ticket link and text', async () => {
    const ev = byId(await read(), HALLOWEEN)
    expect(ev).toMatchObject({
      uid: HALLOWEEN,
      summary: 'halloween special w/ Nothing Works (post-hc, bln) & Sunveil (shoegaze/emo)',
      start: { date: '2026-10-31', time: '20:00', iso: '2026-10-31T20:00:00+01:00' },
      end: null,
      url: PAGE,
      imageUrl: 'https://www.schokoladen-mitte.de/media/images/ALawBcrzHXGWgxooKFTtqkZICOlE31dYkcP1MZA7.jpg',
      locationRoom: 'Schokoladen',
      locationText: 'Schokoladen',
      timesStated: true,
      links: { tickets: 'https://vvk.link/4nrje4w' },
    })
    expect(ev.description).toMatch(
      /^Musik\nmy people booking & little league shows prsnt:\n& after 22h: No Tears For The Creatures Of The Night DJs \(spooky punk, post-punk, new-wave, disco\)\ndoors 19:00 - show 20:00 - DJs after 22:00\n\n\[NOTHING WORKS\]\(http:\/\/instagram\.com\/nothingworksbln\) \/ »Berlin post-hardcore/,
    )
  })

  it('gives a series date of its own, as the calendar has one id for all its dates', async () => {
    const ev = byId(await read(), KARAOKE)
    expect(ev.summary).toBe("Karaoke Night w/ KJ Der Käpt'n")
    expect(ev.links).toBeUndefined()
    expect(ev.imageUrl).toMatch(/^https:\/\/www\.schokoladen-mitte\.de\/media\/images\/.+\.jpg$/)
  })

  it('takes the show time in the ways the facts write it, else the listed doors', async () => {
    const times = async (text: string) => {
      const page1 = PAGE_1.replace('doors 19:00 - show 20:00 - DJs after 22:00', text)
      return byId(await read({ page1 }), HALLOWEEN).start.time
    }
    expect(await times('Doors 19h / Show 21h')).toBe('21:00')
    expect(await times('Einlass 19h Beginn 20:15 Uhr')).toBe('20:15')
    expect(await times('doors 20:00 - starts 20:30')).toBe('20:30')
    expect(await times('19:00 Einlass 20:30 Konzert 22:00 Dj-Set')).toBe('20:30')
    expect(await times('19-20 KüfA gegen Spende, 20 YOK auf der Bühne')).toBe('19:00')
    expect(byId(await read(), '8025').start.time).toBe('20:00') // "19:00 Einlass 20:00 Konzert" in the fixture
  })

  it('marks a sold-out show in the text and leaves out a cancelled one', async () => {
    const title = 'halloween special w/ Nothing Works (post-hc, bln)  &amp; Sunveil (shoegaze/emo)'
    const soldOut = byId(await read({ page1: PAGE_1.replace(title, `${title} (ausverkauft)`) }), HALLOWEEN)
    expect(soldOut.summary).toBe('halloween special w/ Nothing Works (post-hc, bln) & Sunveil (shoegaze/emo)')
    expect(soldOut.description).toContain('(spooky punk, post-punk, new-wave, disco)\nAusverkauft\ndoors 19:00')
    const cancelled = await read({ page1: PAGE_1.replace(title, `ABGESAGT: ${title}`) })
    expect(cancelled.map((e) => e.start.date)).not.toContain('2026-10-31')
  })

  it('keeps the id when the calendar writes the title differently, else falls back to the day', async () => {
    const calendar = JSON.parse(CALENDAR) as { id: number; date: string; title: string }[]
    const renamed = calendar.map((e) => (e.id === 8008 ? { ...e, title: 'Halloween Special' } : e))
    expect((await read({ calendar: JSON.stringify(renamed) }))[0]!.externalId).toBe(HALLOWEEN)
    const missing = calendar.filter((e) => e.id !== 8008)
    expect((await read({ calendar: JSON.stringify(missing) }))[0]!.externalId).toBe('2026-10-31')
  })

  it('leaves out events before today', async () => {
    const dates = (await read({}, new Date('2026-11-06T12:00:00Z'))).map((e) => e.start.date)
    expect(dates).toEqual(['2026-11-06', '2026-11-07', '2026-11-09', '2026-11-10', '2027-04-02', '2027-05-16'])
  })

  it('changes the hash when the text changes, not otherwise', async () => {
    const hash = byId(await read(), HALLOWEEN).hash
    expect(byId(await read(), HALLOWEEN).hash).toBe(hash)
    const edited = PAGE_1.replace('Driving riffs', 'Loud riffs')
    expect(byId(await read({ page1: edited }), HALLOWEEN).hash).not.toBe(hash)
  })
})

describe('readSchokoladen (errors)', () => {
  it('reads an empty programme as no events, without asking the calendar', async () => {
    const { fetched, fetchText } = site()
    expect(await readSchokoladen(EMPTY, config, { pageUrl: PAGE, now: NOW, fetchText })).toEqual([])
    expect(fetched).toEqual([])
  })

  it('rejects a page without the programme', async () => {
    await expect(read({ page1: '<!doctype html><html><body>Wartungsarbeiten</body></html>' })).rejects.toThrow(FeedParseError)
  })

  it('fails the run when a listing page or the calendar cannot be fetched', async () => {
    await expect(read({ fail: '?page=8' })).rejects.toThrow(`Listing page ${PAGE}?page=8: Feed answered HTTP 502`)
    await expect(read({ fail: '/calendar' })).rejects.toThrow(`Calendar ${PAGE}calendar: Feed answered HTTP 502`)
    await expect(read({ calendar: '<html></html>' })).rejects.toThrow(FeedParseError)
  })

  it('rejects another timezone', async () => {
    const vienna = ingestSourceConfigSchema.parse({ timezone: 'Europe/Vienna' })
    await expect(readSchokoladen(PAGE_1, vienna, { pageUrl: PAGE, now: NOW, fetchText: site().fetchText })).rejects.toThrow(FeedParseError)
  })
})
