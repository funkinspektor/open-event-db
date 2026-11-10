import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { parseFrannz } from './frannz.js'
import { FeedParseError } from './ical.js'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/frannz/index.html', import.meta.url)), 'utf8')
const config = ingestSourceConfigSchema.parse({})
const PAGE = 'https://frannz.eu/'
// Tuesday 2026-11-10, 12:00 Berlin: the day the fixture was saved
const NOW = new Date('2026-11-10T11:00:00Z')

const parse = (html: string, now = NOW) => parseFrannz(html, config, { pageUrl: PAGE, now })

const byId = (events: ReturnType<typeof parseFrannz>, id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

interface Card {
  id?: string
  dayname?: string
  day?: string
  month?: string
  title?: string
  otitle?: string
  utitle?: string
  typ?: string
  ort?: string
  entrance?: string
  start?: string
  box?: string
  text?: string
}

/** An article as the theme writes it, with only the parts the adapter reads. */
const card = (c: Card = {}) => {
  const {
    id = '1',
    dayname = 'Freitag',
    day = '13',
    month = 'November',
    title = 'Band',
    typ = 'Konzert',
    ort = 'Club',
    start = '20:00',
    text = 'Text.',
  } = c
  const kv = (key: string, val: string, unit = ' Uhr') =>
    `<span class="sidebar-key">${key}:</span><span class="sidebar-val"><strong>${val}</strong>${unit}</span><span class="clear"></span>`
  return `<article id="post-${id}" class=" visible post-${id} events type-events">
    <div class="entry-header"><div class="content">
      <div class="cell first date"><div class="event-dayname">${dayname}</div><div class="event-day">${day}</div><div class="event-month">${month}</div></div>
      <div class="cell second titles">${c.otitle ? `<h4 class="event-otitle">${c.otitle}</h4>` : ''}<h2 class="event-title">${title}</h2>${c.utitle ? `<h4 class="event-utitle">${c.utitle}</h4>` : ''}</div>
      <ul class="event-info padding-top"><li class="event-typ"><div class="value">${typ}</div></li></ul>
    </div></div>
    <div class="entry-content" style="display: none;"><div class="entry-content-wrap"><div class="content">
      <div class="sidebar">
        <div class="sidebar-element-wrap"><span class="sidebar-title">Info</span>${kv('Ort', ort, '')}${c.entrance ? kv('Einlass', c.entrance) : ''}${start ? kv('Beginn', start) : ''}</div>
        ${c.box ? `<div class="sidebar-element-wrap"><span class="sidebar-title">Eintritt</span>${kv('Abendkasse', c.box, ' €')}</div>` : ''}
      </div>
      ${text}
    </div></div></div>
  </article>`
}

const page = (...cards: string[]) => `<html><body><main id="main" class="site-main">${cards.join('\n')}</main></body></html>`

describe('parseFrannz (fixture)', () => {
  const events = parse(fixture)

  it('returns every listed event once, the post id as its id; the slider copy is skipped', () => {
    expect(events.map((e) => e.externalId)).toEqual([
      '9453',
      '10096',
      '9600',
      '10070',
      '9963',
      '9975',
      '9928',
      '10106',
      '10077',
      '10091',
      '9650',
      '9913',
      '10044',
    ])
  })

  it('maps a concert: title, start at "Beginn", doors, presenter, tour, note and ticket link in the text', () => {
    const ev = byId(events, '9453')
    expect(ev.uid).toBe('9453')
    expect(ev.summary).toBe('Pohlmann')
    expect(ev.start).toEqual({ date: '2026-11-11', time: '19:25', iso: '2026-11-11T19:25:00+01:00' })
    expect(ev.end).toBeNull()
    expect(ev.timesStated).toBe(true)
    expect(ev.url).toBe('https://frannz.eu/?p=9453')
    expect(ev.imageUrl).toBe(
      'https://images.copilot.events/resize?url=https%3A%2F%2Fcopilot.events%2Ffrannz%2Fapi%2Ffiles%2Fc6b04681-3663-4ba5-98cb-9ffe317f3466%2Fpreview%2Fpreview.jpeg&width=1920&quality=50&instanceId=frannz',
    )
    expect(ev.locationRoom).toBe('Frannz Club')
    expect(ev.locationText).toBe('Frannz Club')
    const tickets = 'https://www.eventim.de/noapp/event/pohlmann-beweggruende-tour-202526-frannz-club-20527262/?affiliate=SZ3'
    expect(ev.links).toEqual({ tickets })
    expect(ev.description.split('\n\n').slice(0, 7)).toEqual([
      'Konzert',
      'Kulturnews und Trinity präsentieren:',
      'Beweggründe Tour 2025/26',
      'Nachholtermin vom 10.01.',
      'Einlass 19:00',
      `Tickets im VVK gibt es bei [www.eventim.de](${tickets})`,
      'POHLMANN KÜNDIGT NEUES ALBUM „BEWEGGRÜNDE“ UND GLEICHNAMIGE TOURNEE AN',
    ])
    expect(ev.raw).toContain('id="post-9453"')
    expect(ev.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('takes notes out of the title: sold out, a rescheduled date, floors', () => {
    const notes = (id: string) => {
      const ev = byId(events, id)
      return [ev.summary, ev.description.split('\n\n').find((p) => /^(Ausverkauft|Nachholtermin|Auf 3)/.test(p))]
    }
    expect(notes('9600')).toEqual(['Messa', 'Ausverkauft'])
    expect(notes('10070')).toEqual(['SingAlong – Das große Mitsing-Konzert in Berlin', 'Ausverkauft'])
    expect(notes('9650')).toEqual(['Iggi Kelly', 'Nachholtermin vom 28.04.26'])
    expect(notes('9928')).toEqual(['Rebel Yell Love the 80s!', 'Auf 3 Floors'])
  })

  it('places a concert moved elsewhere there', () => {
    const ev = byId(events, '9975')
    expect(ev.summary).toBe('Georgia Cavallo')
    expect(ev.locationRoom).toBe('Lido')
    expect(ev.locationText).toBe('Lido')
    expect(ev.description).toContain('\n\nIns Lido verlegt\n\n')
    expect(ev.links).toEqual({ tickets: 'https://tickets.loft.de/event/georgia-cavallo-hs9nw9' })
  })

  it('names the rooms when it is not just the club, and the box office price', () => {
    const ev = byId(events, '9963')
    expect(ev.start.time).toBe('21:00')
    expect(ev.description.split('\n\n').slice(0, 6)).toEqual([
      'Party',
      'Party auf 2 Floors!',
      '🎧 An den Decks: DJs Björn & Wilco (Post-Punk Special // Lounge) & DJ Reaf (Indie, Pop & Rock // Main)',
      'Räume: Club, Lounge',
      'Abendkasse 10,00 €',
      'Tickets im VVK gibt hier [shop.copilot.events](https://shop.copilot.events/frannz/events/f1f0e04f-aadf-4a0a-9e83-d393e87ae7d4)',
    ])
    expect(ev.links).toEqual({ tickets: 'https://shop.copilot.events/frannz/events/f1f0e04f-aadf-4a0a-9e83-d393e87ae7d4' })
  })

  it('reads an event without doors or image', () => {
    const ev = byId(events, '10106')
    expect(ev.summary).toBe('Learn to Swing Dance mit Swing Patrol')
    expect(ev.start).toEqual({ date: '2026-12-03', time: '18:15', iso: '2026-12-03T18:15:00+01:00' })
    expect(ev.imageUrl).toBeNull()
    expect(ev.links).toBeUndefined()
    expect(ev.description).toBe(
      'Ballroom Party\n\nDonnerstags ab 18.15 Uhr. Alle Informationen unter [www.swingpatrolberlin.com](https://www.swingpatrolberlin.com/sp-kulte.html)',
    )
  })

  it('gives each date its year by the weekday, into the next year', () => {
    expect(byId(events, '10077').start.date).toBe('2026-12-31')
    expect(byId(events, '10091').start).toEqual({ date: '2027-01-08', time: '19:00', iso: '2027-01-08T19:00:00+01:00' })
    expect(byId(events, '10044').start).toEqual({ date: '2027-10-15', time: '20:00', iso: '2027-10-15T20:00:00+02:00' })
  })

  it('drops events before today', () => {
    expect(parse(fixture, new Date('2026-12-31T11:00:00Z')).map((e) => e.externalId)).toEqual(['10077', '10091', '9650', '9913', '10044'])
  })
})

describe('parseFrannz (edge cases)', () => {
  it('reads an empty programme as no events', () => {
    expect(parse(page())).toEqual([])
  })

  it('fails on a page without the programme', () => {
    expect(() => parse('<html><body><p>Wartungsarbeiten</p></body></html>')).toThrow(FeedParseError)
  })

  it('leaves out cancelled events', () => {
    const html = page(card({ id: '1', title: 'A -abgesagt-' }), card({ id: '2', title: 'B (Abgesagt)' }), card({ id: '3', title: 'C' }))
    expect(parse(html).map((e) => e.summary)).toEqual(['C'])
  })

  it('keeps brackets and hyphens that are part of the name', () => {
    const html = page(
      card({ id: '1', title: 'David J  (Bauhaus / Love &amp; Rockets)' }),
      card({ id: '2', title: 'Die Bolschewistische Kurkapelle Schwarz-Rot' }),
      card({ id: '3', title: 'Foo - Bar -ausverkauft-' }),
    )
    expect(parse(html).map((e) => e.summary)).toEqual(['David J (Bauhaus / Love & Rockets)', 'Die Bolschewistische Kurkapelle Schwarz-Rot', 'Foo - Bar'])
  })

  it('falls back to the running order when the weekday matches no year', () => {
    const html = page(
      card({ id: '1', dayname: 'Montag', day: '28', month: 'Dezember' }), // 2026-12-28 is a Monday
      card({ id: '2', dayname: 'Montag', day: '02', month: 'Januar' }), // a Saturday in 2027: typo
    )
    expect(parse(html).map((e) => e.start.date)).toEqual(['2026-12-28', '2027-01-02'])
  })

  it('skips cards without a date or title, and reads a card without time as untimed', () => {
    const html = page(card({ id: '1', month: 'Brumaire' }), card({ id: '2', title: '' }), card({ id: '3', start: '' }))
    const events = parse(html)
    expect(events.map((e) => e.externalId)).toEqual(['3'])
    expect(events[0]!.start).toEqual({ date: '2026-11-13', time: null, iso: '2026-11-13T00:00:00+01:00' })
    expect(events[0]!.timesStated).toBe(false)
  })

  it('collapses the "[link](link)" doubles of pasted Markdown into one link', () => {
    const a = '<a href="https://www.example.org/x" target="_blank">www.example.org</a>'
    const [ev] = parse(page(card({ text: `Infos: [${a}](${a})<br />` })))
    expect(ev!.description).toBe('Konzert\n\nInfos: [www.example.org](https://www.example.org/x)')
    expect(ev!.links).toBeUndefined()
  })

  it('takes the ticket link from the line below a ticket line, when that line is little more than the link', () => {
    const dice = '<a href="https://link.dice.fm/a8">link.dice.fm</a>'
    const artist = '<a href="https://band.example.org">Website</a>'
    const [below, prose] = parse(
      page(
        card({ id: '1', text: `Tickets unter:<br />\n<br />\nDice link -${dice}<br />` }),
        card({ id: '2', text: `Tickets im VVK gibt es in Kürze<br />\n<br />\nDie Band spielt seit 2001 und hat zuletzt ein Album gemacht: ${artist}<br />` }),
      ),
    )
    expect(below!.links).toEqual({ tickets: 'https://link.dice.fm/a8' })
    expect(prose!.links).toBeUndefined()
  })

  it('tidies the box office price', () => {
    const [ev] = parse(page(card({ box: '12,00€' })))
    expect(ev!.description).toContain('\n\nAbendkasse 12,00 €\n\n')
  })

  it('refuses another timezone', () => {
    const other = ingestSourceConfigSchema.parse({ timezone: 'Europe/London' })
    expect(() => parseFrannz(page(), other, { pageUrl: PAGE, now: NOW })).toThrow(FeedParseError)
  })
})
