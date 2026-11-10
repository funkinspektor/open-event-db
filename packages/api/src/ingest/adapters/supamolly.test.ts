import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { FeedParseError } from './ical.js'
import { parseSupamolly } from './supamolly.js'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/supamolly/programm.html', import.meta.url)), 'utf8')
const config = ingestSourceConfigSchema.parse({})
const PAGE = 'https://www.supamolly.de/index.php?p=programm&l=de'
// Tuesday 2026-11-10, 12:00 Berlin: the day the fixture was saved
const NOW = new Date('2026-11-10T11:00:00Z')

const parse = (html: string, now = NOW) => parseSupamolly(html, config, { pageUrl: PAGE, now })

const byId = (events: ReturnType<typeof parseSupamolly>, id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

const act = (name: string, genre = '', href = '') =>
  `<div class="even">${href ? `<a href="${href}" target=_blank>` : ''}<div class="tit"><b>${name}<div class="progln" alt="${href}"> </div></b></div>` +
  `<div class="beschr ">${genre}<div class="lin"><div>${href}</div></div></div>${href ? '</a>' : ''}</div>`

const row = (id: string, ...acts: string[]) =>
  `<tr class="event" id="${id}"><td class="date"><div class="uhr">21:30</div></td><td class="evcont">${acts.join('')}</td></tr>`

const page = (...rows: string[]) => `<html><body><table class="progtab"><tr><td class="mon">November 2026</td></tr>${rows.join('\n')}</table></body></html>`

describe('parseSupamolly (fixture)', () => {
  const events = parse(fixture)

  it('returns every listed event, its start as its id', () => {
    expect(events.map((e) => e.externalId)).toEqual([
      '202611132100',
      '202611142130',
      '202611202130',
      '202611212130',
      '202611272130',
      '202611282130',
    ])
  })

  it('maps an evening: the acts as title and lineup, their genres as notes, their links in the text', () => {
    const ev = byId(events, '202611132100')
    expect(ev.uid).toBe('202611132100')
    expect(ev.summary).toBe('La Sangre, Karatschai')
    expect(ev.start).toEqual({ date: '2026-11-13', time: '21:00', iso: '2026-11-13T21:00:00+01:00' })
    expect(ev.end).toBeNull()
    expect(ev.timesStated).toBe(true)
    expect(ev.lineup).toEqual([
      {
        name: null,
        acts: [
          { name: 'La Sangre', time: null, live: false, note: 'ChilenischerAkustik FolkPunk' },
          { name: 'Karatschai', time: null, live: false, note: 'StonerdoomPsychSludge, Berlin' },
        ],
      },
    ])
    expect(ev.description).toBe(
      'La Sangre: [la-sangre.bandcamp.com](https://la-sangre.bandcamp.com/album/as-empezamos)\n' +
        'Karatschai: [youtube.com](https://www.youtube.com/watch?v=6JUOQ6FPjrM&list=RD6JUOQ6FPjrM&start_radio=1)',
    )
    expect(ev.url).toBe(PAGE)
    expect(ev.imageUrl).toBe('https://www.supamolly.de/flyer/202611132100.jpg')
    expect(ev.locationRoom).toBe('Supamolly')
    expect(ev.locationText).toBe('Supamolly')
    expect(ev.raw).toContain('id="202611132100"')
    expect(ev.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reads entities, acts without genre or link, and a country after the name', () => {
    const soli = byId(events, '202611202130')
    expect(soli.summary).toBe('Soliparty Linienhof, Tut Das Not, Neofarius Orchestra #249, Option Weg, Dj Laika')
    expect(soli.lineup![0]!.acts.map((a) => [a.name, a.note])).toEqual([
      ['Soliparty Linienhof', null],
      ['Tut Das Not', 'Pölit-Emo-Punk'],
      ['Neofarius Orchestra #249', 'Klezmer-Balkan-Polka-Punk'],
      ['Option Weg', 'Platzpatronenpunk'],
      ['Dj Laika', 'Wave-Synthie Post Punk'],
    ])
    expect(soli.description.split('\n')).toHaveLength(3)

    const hadda = byId(events, '202611282130')
    expect(hadda.summary).toBe('Rites of Hadda (UK), Pornscars')
    expect(hadda.lineup![0]!.acts[0]).toMatchObject({ name: 'Rites of Hadda', note: 'UK · Anarcho pagan gothic psychedelic Witchpunk' })
  })

  it('leaves an event without a flyer without an image', () => {
    expect(byId(events, '202611212130').imageUrl).toBeNull()
  })

  it('drops events before today', () => {
    expect(parse(fixture, new Date('2026-11-21T11:00:00Z')).map((e) => e.externalId)).toEqual([
      '202611212130',
      '202611272130',
      '202611282130',
    ])
  })
})

describe('parseSupamolly (edge cases)', () => {
  it('reads an empty programme as no events', () => {
    expect(parse(page())).toEqual([])
  })

  it('fails on a page without the programme', () => {
    expect(() => parse('<html><body><p>Wartungsarbeiten</p></body></html>')).toThrow(FeedParseError)
  })

  it('skips rows without a start id or without acts', () => {
    const html = page(row('flyer', act('A')), row('202611309900', act('B')), row('202611302130'), row('202611302200', act('C')))
    expect(parse(html).map((e) => e.summary)).toEqual(['C'])
  })

  it('keeps only web links', () => {
    const [ev] = parse(page(row('202611302130', act('A', 'Punk', 'mailto:a@example.org'))))
    expect(ev!.description).toBe('')
    expect(ev!.lineup![0]!.acts[0]!.note).toBe('Punk')
  })

  it('refuses another timezone', () => {
    const other = ingestSourceConfigSchema.parse({ timezone: 'Europe/London' })
    expect(() => parseSupamolly(page(), other, { pageUrl: PAGE, now: NOW })).toThrow(FeedParseError)
  })
})
