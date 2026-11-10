import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { parseBeateUwe } from './beateuwe.js'
import { FeedParseError } from './ical.js'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/beateuwe/home.html', import.meta.url)), 'utf8')
const config = ingestSourceConfigSchema.parse({})
const PAGE = 'https://beate-uwe.de/'
// Tuesday 2026-11-10, 12:00 Berlin: the day the fixture was saved
const NOW = new Date('2026-11-10T11:00:00Z')

const parse = (html: string, now = NOW) => parseBeateUwe(html, config, { pageUrl: PAGE, now })

const byId = (events: ReturnType<typeof parseBeateUwe>, id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

/** One programme entry as Elementor writes it: an icon list with date and time, then a text editor. */
const entry = (date: string, time: string, body: string) =>
  `<div class="e-con"><div class="elementor-element elementor-widget elementor-widget-icon-list" data-widget_type="icon-list.default">` +
  `<ul><li><i class="far fa-calendar-alt"></i><span class="elementor-icon-list-text">${date}</span></li>` +
  `<li><i class="far fa-clock"></i><span class="elementor-icon-list-text">${time}</span></li></ul></div>` +
  `<div class="elementor-element elementor-widget elementor-widget-text-editor" data-widget_type="text-editor.default">${body}</div></div>`

const page = (...entries: string[]) => `<html><body>${entries.join('\n')}</body></html>`

describe('parseBeateUwe (fixture)', () => {
  const events = parse(fixture)

  it('returns the coming nights, the day as id; past nights are left out', () => {
    expect(events.map((e) => e.externalId)).toEqual([
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ])
  })

  it('maps a night: title, start, the "w/" line as lineup, the RA link', () => {
    const ev = byId(events, '2026-12-05')
    expect(ev.uid).toBe('2026-12-05')
    expect(ev.summary).toBe('Beate Invites /// F*CD (FLINTA* Club Deck)')
    expect(ev.start).toEqual({ date: '2026-12-05', time: '20:00', iso: '2026-12-05T20:00:00+01:00' })
    expect(ev.end).toBeNull()
    expect(ev.timesStated).toBe(true)
    expect(ev.lineup).toEqual([
      {
        name: null,
        acts: [
          { name: 'Rave d Amor', time: null, live: false, note: null },
          { name: 'Housekatze', time: null, live: false, note: null },
          { name: 'Pilar Jordan', time: null, live: false, note: null },
          { name: 'Dela Nesto', time: null, live: false, note: null },
          { name: 'Südstern', time: null, live: false, note: null },
          { name: 'Myzelia b2b Capitano', time: null, live: false, note: null },
        ],
      },
    ])
    expect(ev.description).toBe('')
    expect(ev.url).toBe(PAGE)
    expect(ev.links).toEqual({ resident_advisor: 'https://ra.co/events/2574873' })
    expect(ev.imageUrl).toBeNull()
    expect(ev.locationRoom).toBe('Beate Uwe')
    expect(ev.locationText).toBe('Beate Uwe')
    expect(ev.raw).toContain('05.12.26')
    expect(ev.raw).toContain('ra.co/events/2574873')
    expect(ev.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reads "(live)" as live and other brackets as the note', () => {
    expect(byId(events, '2026-11-13').lineup![0]!.acts.map((a) => [a.name, a.live, a.note])).toEqual([
      ['Samerodeɦ', false, null],
      ['Girl From The Future', true, null],
      ['AP Solis', false, null],
      ['MonoAbe', true, null],
      ['Ativ Aras', false, null],
    ])
    expect(byId(events, '2026-11-20').lineup![0]!.acts.slice(0, 2).map((a) => [a.name, a.note])).toEqual([
      ['The Ringo', 'Shockwave/Leipzig'],
      ['Siousie', 'Leipzig'],
    ])
    expect(byId(events, '2026-12-06').lineup![0]!.acts[2]).toEqual({ name: 'SoSo Klein', time: null, live: false, note: 'hybrid' })
  })

  it('takes a title without a link: the home page is the only link', () => {
    const ev = byId(events, '2026-11-27')
    expect(ev.summary).toBe('Automaticamore!')
    expect(ev.links).toEqual({})
    expect(ev.lineup![0]!.acts[0]).toEqual({ name: 'Franz Scala', time: null, live: false, note: 'Slow Motion/Wrong Era' })
  })
})

describe('parseBeateUwe (edge cases)', () => {
  it('keeps text that is no lineup as the description', () => {
    const [ev] = parse(
      page(entry('DI, 17.11.26 NOV', '18:00', '<p><a href="https://ra.co/events/1">Tanzen3000</a></p><p>This Dancefloor is for Dancing! – movement workshop &amp; DJ Set</p>')),
    )
    expect(ev!.summary).toBe('Tanzen3000')
    expect(ev!.description).toBe('This Dancefloor is for Dancing! – movement workshop & DJ Set')
    expect(ev!.lineup).toEqual([])
  })

  it('keeps commas inside brackets within one act', () => {
    const [ev] = parse(page(entry('FR, 13.11.26 NOV', '23:00', '<p>Night</p><p>w/ Crew (A, B), C (Live Set)</p>')))
    expect(ev!.lineup![0]!.acts).toEqual([
      { name: 'Crew', time: null, live: false, note: 'A, B' },
      { name: 'C', time: null, live: true, note: null },
    ])
  })

  it('tells two nights on one day apart, and drops entries without a title or a readable date', () => {
    const events = parse(
      page(
        entry('SA, 14.11.26 NOV', '16:00', '<p>Day</p>'),
        entry('SA, 14.11.26 NOV', '23:00', '<p>Night</p>'),
        entry('SO, 15.11.26 NOV', '15:00', '<p> </p>'),
        entry('SO, 32.11.26 NOV', '15:00', '<p>Wrong</p>'),
      ),
    )
    expect(events.map((e) => [e.externalId, e.summary])).toEqual([
      ['2026-11-14', 'Day'],
      ['2026-11-14-2', 'Night'],
    ])
  })

  it('keeps a night without a time, its times unverified', () => {
    const [ev] = parse(page(entry('SA, 14.11.26 NOV', 'tba', '<p>Night</p>')))
    expect(ev!.start).toEqual({ date: '2026-11-14', time: null, iso: '2026-11-14T00:00:00+01:00' })
    expect(ev!.timesStated).toBe(false)
  })

  it('counts today as coming', () => {
    expect(parse(page(entry('DI, 10.11.26 NOV', '18:00', '<p>Tonight</p>'))).map((e) => e.externalId)).toEqual(['2026-11-10'])
  })

  it('fails on a page without programme dates', () => {
    expect(() => parse('<html><body><p>Wartungsarbeiten</p></body></html>')).toThrow(FeedParseError)
  })

  it('refuses other timezones', () => {
    const other = ingestSourceConfigSchema.parse({ timezone: 'Europe/London' })
    expect(() => parseBeateUwe(fixture, other, { pageUrl: PAGE, now: NOW })).toThrow(FeedParseError)
  })
})
