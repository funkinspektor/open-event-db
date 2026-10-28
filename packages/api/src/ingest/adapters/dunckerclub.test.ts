import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { parseDunckerclub } from './dunckerclub.js'
import { FeedParseError } from './ical.js'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/dunckerclub.html', import.meta.url)), 'utf8')
const config = ingestSourceConfigSchema.parse({})
const PAGE = 'https://www.dunckerclub.de/start.html'
// Wednesday 2026-10-28, 11:00 Berlin: the day the fixture was saved
const NOW = new Date('2026-10-28T10:00:00Z')

const parse = (html: string, now = NOW) => parseDunckerclub(html, config, { pageUrl: PAGE, now })

const byDate = (events: ReturnType<typeof parseDunckerclub>, date: string) => {
  const found = events.find((e) => e.externalId === date)
  if (!found) throw new Error(`no event on ${date}`)
  return found
}

const page = (...rows: string[]) => `<html><body><table><tbody>${rows.join('\n')}</tbody></table></body></html>`

const row = (date: string, name: string, time = '21h-05h', rest = 'Indie, Rock<br><img src="./bilder/x.jpg"><br>DJ Test') =>
  `<tr class="tablereihe"><td class="tableweekday">Fr</td><td class="tabledate">${date}</td>` +
  `<td class="tableevent"><span class="eventname">${name}</span><br>${rest}</td><td class="tabletime">${time}</td></tr>`

describe('parseDunckerclub (fixture)', () => {
  const events = parse(fixture)

  it('returns the upcoming nights and skips past and commented-out ones', () => {
    expect(events.map((e) => e.externalId)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-02',
      '2026-11-06',
      '2026-11-07',
      '2026-11-09',
      '2026-11-13',
      '2026-11-14',
      '2026-11-16',
      '2026-11-20',
      '2026-11-21',
    ])
  })

  it('maps a night with its Facebook event', () => {
    const samhain = byDate(events, '2026-10-31')
    expect(samhain.uid).toBe('2026-10-31')
    expect(samhain.summary).toBe('Dark Mønday – SAMHAIN Celebration 2026')
    expect(samhain.start).toEqual({ date: '2026-10-31', time: '21:00', iso: '2026-10-31T21:00:00+01:00' })
    expect(samhain.end).toEqual({ date: '2026-11-01', time: '04:00', iso: '2026-11-01T04:00:00+01:00' })
    expect(samhain.description).toBe(
      'Pagan, Ethereal, Neofolk, Goth, Postpunk, NewColdDarkSynthWave, DeathRock\n\nDJ Ørlög\n\n' +
        '[Facebook-Event](https://www.facebook.com/events/1399803252337452)',
    )
    expect(samhain.url).toBe(PAGE)
    expect(samhain.imageUrl).toBe('https://www.dunckerclub.de/bilder/samhain_2026.jpg')
    expect(samhain.locationRoom).toBe('Dunckerclub')
    expect(samhain.locationText).toBe('Dunckerclub')
    expect(samhain.timesStated).toBe(true)
    expect(samhain.raw).toMatch(/^<tr class="tablereihe">[\s\S]*31\.10\.[\s\S]*<\/tr>$/)
    expect(samhain.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores a commented-out Facebook link and takes the lineup outside the link', () => {
    const boris = byDate(events, '2026-11-02')
    expect(boris.description).toBe('goth, deathrock, postpunk, newdarkcoldsynthwave, indie, ebm, industrial\n\nDJ Boris')
    expect(boris.end?.iso).toBe('2026-11-03T04:00:00+01:00')

    const inferno = byDate(events, '2026-10-30')
    expect(inferno.description).toBe(
      'Pop, Dark, Indie aus dem Neon- Jahrzehnt\n\nDJ Funky Henning\n\n' +
        '[Facebook-Event](https://www.facebook.com/events/1125535683756006)',
    )
  })

  it('strips dash decoration from title parts', () => {
    expect(byDate(events, '2026-11-06').summary).toBe('Strangelove – Die Depeche Mode Party')
  })

  it('gives different rows different hashes', () => {
    expect(new Set(events.map((e) => e.hash)).size).toBe(events.length)
  })
})

describe('parseDunckerclub', () => {
  it('keeps the hash when only other rows change', () => {
    const a = parse(page(row('30.10.', 'A'), row('31.10.', 'B')))
    const b = parse(page(row('30.10.', 'A'), row('31.10.', 'B changed')))
    expect(b[0]!.hash).toBe(a[0]!.hash)
    expect(b[1]!.hash).not.toBe(a[1]!.hash)
  })

  it('puts January dates into the next year in December', () => {
    const [ev] = parse(page(row('05.01.', 'New Year')), new Date('2026-12-20T12:00:00Z'))
    expect(ev!.externalId).toBe('2027-01-05')
  })

  it('treats December dates seen in January as past', () => {
    expect(parse(page(row('30.12.', 'Old'), row('09.01.', 'New')), new Date('2027-01-03T12:00:00Z')).map((e) => e.externalId)).toEqual([
      '2027-01-09',
    ])
  })

  it('keeps tonight', () => {
    expect(parse(page(row('28.10.', 'Tonight'))).map((e) => e.externalId)).toEqual(['2026-10-28'])
  })

  it('reads minutes and an end on the same day', () => {
    const [ev] = parse(page(row('30.10.', 'Early', '19:30h-23h')))
    expect(ev!.start.iso).toBe('2026-10-30T19:30:00+01:00')
    expect(ev!.end?.iso).toBe('2026-10-30T23:00:00+01:00')
  })

  it('keeps a night without a readable time, with unstated times', () => {
    const [ev] = parse(page(row('30.10.', 'Later', 'tba')))
    expect(ev!.start).toEqual({ date: '2026-10-30', time: null, iso: '2026-10-30T00:00:00+01:00' })
    expect(ev!.end).toBeNull()
    expect(ev!.timesStated).toBe(false)
  })

  it('skips spacer rows and rows without a title', () => {
    const spacer = '<tr class="tablereihe"><td class="tableweekday"></td><td class="tabledate"></td><td class="tableevent"></td><td class="tabletime"></td></tr>'
    expect(parse(page(spacer, row('30.10.', ''), row('31.10.', 'Real'))).map((e) => e.externalId)).toEqual(['2026-10-31'])
  })

  it('reads the cells after a row that was closed right away', () => {
    const broken = row('30.10.', 'Broken').replace('<tr class="tablereihe">', '<tr class="tablereihe"></tr>')
    expect(parse(page(broken, row('31.10.', 'Fine'))).map((e) => e.summary)).toEqual(['Broken', 'Fine'])
  })

  it('skips dates that do not exist', () => {
    expect(parse(page(row('31.11.', 'Nope')))).toEqual([])
  })

  it('fails on two nights with the same date', () => {
    expect(() => parse(page(row('30.10.', 'A'), row('30.10.', 'B')))).toThrow(FeedParseError)
  })

  it('fails when the programme table is missing', () => {
    expect(() => parse('<html><body>Wartungsarbeiten</body></html>')).toThrow(FeedParseError)
  })

  it('fails for another timezone', () => {
    const vienna = ingestSourceConfigSchema.parse({ timezone: 'Europe/Vienna' })
    expect(() => parseDunckerclub(page(row('30.10.', 'A')), vienna, { pageUrl: PAGE, now: NOW })).toThrow(FeedParseError)
  })
})
