import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { FeedParseError, type FeedEvent } from './ical.js'
import { parseSquarespace } from './squarespace.js'

const json = readFileSync(fileURLToPath(new URL('../fixtures/squarespace/8mmbar-program.json', import.meta.url)), 'utf8')
const config = ingestSourceConfigSchema.parse({})
const PAGE = 'https://www.8mmbar.de/program?format=json&view=list'
// Friday 2026-10-30, 16:00 Berlin: the day the fixture was saved
const NOW = new Date('2026-10-30T15:00:00Z')

const read = (text = json, now = NOW) => parseSquarespace(text, config, { pageUrl: PAGE, now })

const CUTOUTS = '6ada114e1691ec78fbfe566e'
const NIGHTSHIFT = '6ae4ab45ab444a301bbbbc0c'

const byId = (events: FeedEvent[], id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

/** The fixture with one upcoming event changed. */
function withEvent(id: string, change: (ev: Record<string, unknown>) => void): string {
  const data = JSON.parse(json) as { upcoming: Record<string, unknown>[] }
  const ev = data.upcoming.find((e) => e.id === id)
  if (!ev) throw new Error(`no event ${id}`)
  change(ev)
  return JSON.stringify(data)
}

describe('parseSquarespace (8MM Bar fixture)', () => {
  it('reads every upcoming event, its Squarespace id as the id', () => {
    expect(read().map((e) => [e.externalId, e.start.date, e.summary])).toEqual([
      [NIGHTSHIFT, '2026-10-30', 'NIGHTSHIFT DJ SET'],
      ['6ada0e57f19dcc40e848d555', '2026-10-31', '8MM X UNKNOWN CALLERS HALLOWEEN'],
      [CUTOUTS, '2026-11-02', '8MM Live: CUTOUTS (NYC)'],
      ['6ada14bc69c1917d3a18ca46', '2026-11-03', '8MM Live: SUNSET IMAGES'],
      ['6ada1439df116b27c204fb6a', '2026-11-06', 'Romantic Fiction and Reformation Club present: Equinoxious live at 8MM.'],
      ['6ada11931c29aa7a2fcff453', '2026-11-07', '8MM Live: Fluppe'],
      ['6ada0ff9d4df7f2d46675363', '2026-11-13', '8MM FEST DAY 1'],
      ['6ada10f608a5b40562530f74', '2026-11-14', '8MM FEST DAY 2'],
      ['6ada1363fafd2d01b925a303', '2026-11-19', '8MM Live: Black Maracas'],
    ])
  })

  it('maps a concert with its show time, page, flyer, place, ticket link and text', () => {
    const ev = byId(read(), CUTOUTS)
    expect(ev).toMatchObject({
      uid: CUTOUTS,
      start: { date: '2026-11-02', time: '20:45', iso: '2026-11-02T20:45:00+01:00' },
      end: null,
      url: 'https://www.8mmbar.de/program/2026/11/2/8mm-live-cutouts-nyc',
      imageUrl:
        'https://images.squarespace-cdn.com/content/v1/5b07cb6cb10598e1d9e5d435/1792676211199-UINIQVG6CZFX0516UINW/Screenshot+2026-10-22+at+15.35.50.png',
      locationRoom: '8MM Bar',
      locationText: '8MM Bar, Alte Schönhauser Straße 177B, Berlin, BE, 10119',
      timesStated: true,
      links: { tickets: 'https://www.eventim-light.com/de/a/5f002783c9f8d46492128f51/e/6ad8d1bcb8d9e60371d0dc9f' },
    })
    expect(ev.description).toMatch(/^8MM Live: CUTOUTS\n\nDoors: 19:00\n\nShowtime: 20:45\n\nThe brainchild of Brooklyn-based/)
  })

  it('takes the show time in the ways the text writes it, else the event time', () => {
    const events = read()
    expect(byId(events, '6ada11931c29aa7a2fcff453').start.time).toBe('20:00') // "Shows start 20:00"
    expect(byId(events, '6ada14bc69c1917d3a18ca46').start.time).toBe('20:45') // "Aftershow dj tbc : 22:00" after it
    expect(byId(events, NIGHTSHIFT).start).toEqual({ date: '2026-10-30', time: '22:00', iso: '2026-10-30T22:00:00+01:00' })
    expect(byId(events, '6ada0ff9d4df7f2d46675363').start.time).toBe('18:00')
    const typo = withEvent(CUTOUTS, (ev) => {
      ev.body = String(ev.body).replace('Showtime: 20:45', 'Showtime:: 20;30')
    })
    expect(byId(read(typo), CUTOUTS).start.time).toBe('20:30')
  })

  it('takes the link after a "Tickets" line, bare or linked, without tracking', () => {
    expect(byId(read(), '6ada1439df116b27c204fb6a').links).toEqual({ tickets: 'https://tinyurl.com/EquinoxiousLive' })
    const linked = withEvent(CUTOUTS, (ev) => {
      ev.body =
        '<p>Tickets:<br><a href="https://www.eventim-light.com/de/a/5f00/e/6ab6?fbclid=IwZX" target="_blank"><strong>https://www.eventim-light.com/.../e/6ab6</strong></a></p>'
    })
    expect(byId(read(linked), CUTOUTS).links).toEqual({ tickets: 'https://www.eventim-light.com/de/a/5f00/e/6ab6' })
  })

  it('leaves profile links and "tickets link in bio" without a ticket link', () => {
    expect(byId(read(), NIGHTSHIFT).links).toBeUndefined()
    const inBio = withEvent(CUTOUTS, (ev) => {
      ev.body = '<p>TICKETS LINK IN BIO</p><p><a href="https://www.instagram.com/8mmbar/">@8mmbar</a></p>'
    })
    expect(byId(read(inBio), CUTOUTS).links).toBeUndefined()
  })

  it('drops the one-hour end Squarespace gives every event, keeps any other', () => {
    expect(read().every((e) => e.end === null)).toBe(true)
    const late = withEvent(NIGHTSHIFT, (ev) => {
      ev.endDate = Number(ev.startDate) + 6 * 3600_000
    })
    expect(byId(read(late), NIGHTSHIFT).end).toEqual({ date: '2026-10-31', time: '04:00', iso: '2026-10-31T04:00:00+01:00' })
  })

  it('leaves out events before today', () => {
    expect(read(json, new Date('2026-11-04T12:00:00Z')).map((e) => e.start.date)).toEqual([
      '2026-11-06',
      '2026-11-07',
      '2026-11-13',
      '2026-11-14',
      '2026-11-19',
    ])
  })

  it('keeps the hash when only counters and timestamps change, not when the text does', () => {
    const hash = byId(read(), CUTOUTS).hash
    const touched = withEvent(CUTOUTS, (ev) => {
      ev.updatedOn = Number(ev.updatedOn) + 1000
      ev.likeCount = 3
    })
    expect(byId(read(touched), CUTOUTS).hash).toBe(hash)
    const edited = withEvent(CUTOUTS, (ev) => {
      ev.body = String(ev.body).replace('Doors: 19:00', 'Doors: 19:30')
    })
    expect(byId(read(edited), CUTOUTS).hash).not.toBe(hash)
  })
})

describe('parseSquarespace (errors)', () => {
  it('reads an empty list as no events', () => {
    expect(read(JSON.stringify({ upcoming: [], past: [] }))).toEqual([])
  })

  it('rejects a page that is not JSON', () => {
    expect(() => read('<!doctype html><html></html>')).toThrow(FeedParseError)
  })

  it('rejects the calendar view, which lists one month', () => {
    expect(() => read(JSON.stringify({ items: [] }))).toThrow(/view=list/)
  })

  it('rejects another timezone', () => {
    const vienna = ingestSourceConfigSchema.parse({ timezone: 'Europe/Vienna' })
    expect(() => parseSquarespace(json, vienna, { pageUrl: PAGE, now: NOW })).toThrow(FeedParseError)
  })
})
