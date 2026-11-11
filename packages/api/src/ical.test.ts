import { describe, expect, it } from 'vitest'
import { stripMarkdown, toICalendar, type CalendarEvent } from './ical.js'

const now = new Date('2026-11-11T10:00:00Z')
const webUrl = 'https://kellerkompass.de'

const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Concert',
  descriptionPlain: '',
  startsAt: new Date('2026-12-01T19:00:00Z'),
  startTimeKnown: true,
  endsAt: null,
  status: 'scheduled',
  location: null,
  createdAt: new Date('2026-11-01T10:00:00Z'),
  updatedAt: new Date('2026-11-01T10:00:00Z'),
  ...over,
})
const render = (...e: CalendarEvent[]) => toICalendar(e, { now, webUrl })

describe('toICalendar', () => {
  it('starts with BEGIN:VCALENDAR and uses CRLF only', () => {
    const out = render(ev())
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  it('gives a timed event without end a 4 h DTEND in UTC', () => {
    const out = render(ev())
    expect(out).toContain('DTSTART:20261201T190000Z\r\n')
    expect(out).toContain('DTEND:20261201T230000Z\r\n')
    expect(out).toContain('DTSTAMP:20261111T100000Z\r\n')
  })

  it('uses the explicit end when set', () => {
    expect(render(ev({ endsAt: new Date('2026-12-02T01:30:00Z') }))).toContain('DTEND:20261202T013000Z\r\n')
  })

  it('writes an unknown start time as the Berlin date, next day as end', () => {
    // 00:00 Berlin (CET) on 2 Dec is 23:00 UTC on 1 Dec
    const out = render(ev({ startTimeKnown: false, startsAt: new Date('2026-12-01T23:00:00Z') }))
    expect(out).toContain('DTSTART;VALUE=DATE:20261202\r\n')
    expect(out).toContain('DTEND;VALUE=DATE:20261203\r\n')
    // summer time and month end
    const s = render(ev({ startTimeKnown: false, startsAt: new Date('2026-07-31T22:00:00Z') }))
    expect(s).toContain('DTSTART;VALUE=DATE:20260801\r\n')
    expect(s).toContain('DTEND;VALUE=DATE:20260802\r\n')
  })

  it('marks cancelled and postponed events', () => {
    expect(render(ev({ status: 'cancelled' }))).toContain('STATUS:CANCELLED\r\n')
    const p = render(ev({ status: 'postponed', title: 'Gig' }))
    expect(p).toContain('SUMMARY:Postponed: Gig\r\n')
    expect(render(ev())).toContain('STATUS:CONFIRMED\r\n')
  })

  it('escapes commas, semicolons, backslashes and newlines', () => {
    const out = render(ev({ title: 'A, B; C \\ D', descriptionPlain: 'line1\nline2' }))
    expect(out).toContain('SUMMARY:A\\, B\\; C \\\\ D\r\n')
    expect(out).toContain('DESCRIPTION:line1\\nline2\\n' + `${webUrl}/events/`)
  })

  it('names the calendar "Kellerkompass – My events" (en dash)', () => {
    expect(render(ev())).toContain('X-WR-CALNAME:Kellerkompass – My events\r\n')
  })

  it('cuts the description at 500 code points, trims, then newline and URL', () => {
    const url = `${webUrl}/events/11111111-1111-4111-8111-111111111111`
    const unfolded = (e: CalendarEvent) =>
      render(e).replace(/\r\n /g, '').split('\r\n').find((l) => l.startsWith('DESCRIPTION:'))!.slice('DESCRIPTION:'.length)
    const plain = 'abcdefghij'.repeat(100)
    expect(unfolded(ev({ descriptionPlain: plain }))).toBe(`${plain.slice(0, 500)}\\n${url}`)
    // surrogate pairs are not split: 500 emoji stay whole, the rest is dropped
    const emoji = '😀'.repeat(1000)
    expect(unfolded(ev({ descriptionPlain: emoji }))).toBe(`${'😀'.repeat(500)}\\n${url}`)
    // trailing whitespace after the cut is trimmed
    const spaced = 'a'.repeat(499) + ' ' + 'b'.repeat(100)
    expect(unfolded(ev({ descriptionPlain: spaced }))).toBe(`${'a'.repeat(499)}\\n${url}`)
    expect(unfolded(ev())).toBe(url)
  })

  it('folds long lines at 75 octets without splitting multi-byte characters', () => {
    const title = 'Ü€😀'.repeat(40) + 'x'.repeat(200)
    const out = render(ev({ title }))
    const lines = out.split('\r\n')
    for (const l of lines) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75)
    expect(lines.some((l) => l.startsWith(' '))).toBe(true)
    // unfolding restores the original value
    const unfolded = out.replace(/\r\n /g, '')
    expect(unfolded).toContain(`SUMMARY:${title}\r\n`)
    // a plain 200-char title is folded too
    const plain = render(ev({ title: 'y'.repeat(200) }))
    expect(plain.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true)
  })

  it('sets UID, URL, LOCATION and SEQUENCE', () => {
    const out = render(
      ev({ location: 'Club, Street 1, Berlin', updatedAt: new Date('2026-11-01T10:05:30.900Z') }),
    )
    expect(out).toContain('UID:11111111-1111-4111-8111-111111111111@kellerkompass.de\r\n')
    expect(out).toContain('URL:https://kellerkompass.de/events/11111111-1111-4111-8111-111111111111\r\n')
    expect(out).toContain('LOCATION:Club\\, Street 1\\, Berlin\r\n')
    expect(out).toContain('SEQUENCE:330\r\n')
    expect(render(ev())).not.toContain('LOCATION')
  })
})

describe('stripMarkdown', () => {
  it('removes common markdown', () => {
    expect(stripMarkdown('**Doors** 22:00, [Tickets](https://x)')).toBe('Doors 22:00, Tickets')
    expect(stripMarkdown('# Title\n\n> quote\n\n\n\n*em* and `code` and _it_')).toBe('Title\n\nquote\n\nem and code and it')
    expect(stripMarkdown('snake_case_word stays')).toBe('snake_case_word stays')
  })
})
