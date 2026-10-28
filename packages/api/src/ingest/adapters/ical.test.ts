import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { FeedParseError, parseIcal } from './ical.js'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/acud.ics', import.meta.url)), 'utf8')
const acud = ingestSourceConfigSchema.parse({ external_id_pattern: '-(\\d+)@' })

const bySummary = (events: ReturnType<typeof parseIcal>, summary: string) => {
  const found = events.find((e) => e.summary === summary)
  if (!found) throw new Error(`no event "${summary}"`)
  return found
}

const only = (events: ReturnType<typeof parseIcal>) => {
  expect(events).toHaveLength(1)
  return events[0]!
}

const calendar = (...vevents: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...vevents, 'END:VCALENDAR'].join('\r\n')

const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')

describe('parseIcal (ACUD fixture)', () => {
  const events = parseIcal(fixture, acud)
  const persian = bySummary(events, 'Persian Love: SHAB SHOD')

  it('returns every VEVENT', () => {
    expect(events).toHaveLength(5)
  })

  it('maps the Persian Love event', () => {
    expect(persian.externalId).toBe('2391')
    expect(persian.uid).toBe('20261030T220000-20261030T230300-2391@acudmachtneu.de')
    expect(persian.start).toEqual({ date: '2026-10-30', time: '22:00', iso: '2026-10-30T22:00:00+01:00' })
    expect(persian.end).toEqual({ date: '2026-10-30', time: '23:03', iso: '2026-10-30T23:03:00+01:00' })
    expect(persian.locationRoom).toBe('Club')
    expect(persian.locationText).toBe('Club, 21 Veteranenstrasse, Berlin')
    expect(persian.url).toBe('https://acudmachtneu.de/events/persian-love-shab-shod/')
    expect(persian.imageUrl).toBe('https://acudmachtneu.de/resources/uploads/2026/10/blurred-frame-4.jpg')
  })

  it('reads floating times in Berlin across the DST change', () => {
    const orbital = bySummary(events, 'Orbital Decay')
    expect(orbital.start.iso).toBe('2026-10-01T18:00:00+02:00')
    expect(orbital.end?.iso).toBe('2026-12-06T23:30:00+01:00')
  })

  it('keeps description line breaks and unescapes commas', () => {
    expect(persian.description).toContain('Persian Love: SHAB SHOD \nFR 30.10, ACUD CLUB\n10PM- 4AM \n\nPersian Love presents')
    expect(persian.description).not.toContain('\\,')
    expect(persian.description).not.toContain('\\n')
  })

  it('treats an end that is not after the start as no end', () => {
    expect(bySummary(events, 'Psychopomp').end).toBeNull()
  })

  it('keeps the raw VEVENT text', () => {
    expect(persian.raw).toMatch(/^BEGIN:VEVENT/)
    expect(persian.raw).toMatch(/END:VEVENT$/)
  })

  it('hash ignores DTSTAMP but reacts to content changes', () => {
    const restamped = parseIcal(fixture.replaceAll('DTSTAMP:20261028T173847Z', 'DTSTAMP:20261101T000000Z'), acud)
    expect(bySummary(restamped, 'Persian Love: SHAB SHOD').hash).toBe(persian.hash)

    const renamed = parseIcal(fixture.replace('SUMMARY:Persian Love: SHAB SHOD', 'SUMMARY:Persian Love: SHAB SHOD 2'), acud)
    expect(bySummary(renamed, 'Persian Love: SHAB SHOD 2').hash).not.toBe(persian.hash)
    // other events keep their hash
    expect(bySummary(renamed, 'Psychopomp').hash).toBe(bySummary(events, 'Psychopomp').hash)
  })

  it('uses the UID as external id without a pattern', () => {
    const plain = parseIcal(fixture, ingestSourceConfigSchema.parse({}))
    const e = bySummary(plain, 'Persian Love: SHAB SHOD')
    expect(e.externalId).toBe(e.uid)
  })
})

describe('parseIcal (edge cases)', () => {
  const cfg = ingestSourceConfigSchema.parse({})

  it('honours explicit UTC times', () => {
    const e = only(parseIcal(
      calendar(vevent('UID:a@x', 'SUMMARY:Utc', 'DTSTART:20261101T190000Z', 'DTEND:20261101T210000Z')),
      cfg,
    ))
    expect(e.start).toEqual({ date: '2026-11-01', time: '20:00', iso: '2026-11-01T20:00:00+01:00' })
    expect(e.end?.iso).toBe('2026-11-01T22:00:00+01:00')
  })

  it('treats DATE values as all-day with no time', () => {
    const e = only(parseIcal(calendar(vevent('UID:a@x', 'SUMMARY:Day', 'DTSTART;VALUE=DATE:20261101')), cfg))
    expect(e.start.date).toBe('2026-11-01')
    expect(e.start.time).toBeNull()
    expect(e.end).toBeNull()
  })

  it('falls back to null url, image and location', () => {
    const e = only(parseIcal(calendar(vevent('UID:a@x', 'SUMMARY:Bare', 'DTSTART:20261101T190000Z')), cfg))
    expect(e.url).toBeNull()
    expect(e.imageUrl).toBeNull()
    expect(e.locationRoom).toBeNull()
    expect(e.locationText).toBeNull()
    expect(e.description).toBe('')
  })

  it('throws when the pattern does not match a UID instead of falling back to it', () => {
    const text = calendar(
      vevent('UID:1-100@x', 'SUMMARY:A', 'DTSTART:20261101T190000Z'),
      vevent('UID:no-number@x', 'SUMMARY:B', 'DTSTART:20261101T190000Z'),
    )
    const cfg = ingestSourceConfigSchema.parse({ external_id_pattern: '-(\\d+)@' })
    expect(() => parseIcal(text, cfg)).toThrow(FeedParseError)
    expect(() => parseIcal(text, cfg)).toThrow(/-\(\\d\+\)@.*no-number@x/)
  })

  it('throws when the pattern yields an empty id', () => {
    const text = calendar(vevent('UID:abc@x', 'SUMMARY:A', 'DTSTART:20261101T190000Z'))
    expect(() => parseIcal(text, ingestSourceConfigSchema.parse({ external_id_pattern: '(\\d*)' }))).toThrow(FeedParseError)
  })

  it('throws when two different UIDs map to the same external id', () => {
    const text = calendar(
      vevent('UID:20261101T190000-20261101T230000-100@x', 'SUMMARY:A', 'DTSTART:20261101T190000Z'),
      vevent('UID:20261108T190000-20261108T230000-200@x', 'SUMMARY:B', 'DTSTART:20261108T190000Z'),
    )
    // Too broad: captures the year, which both UIDs share
    const cfg = ingestSourceConfigSchema.parse({ external_id_pattern: '^(\\d{4})' })
    expect(() => parseIcal(text, cfg)).toThrow(FeedParseError)
    expect(() => parseIcal(text, cfg)).toThrow(/2026/)
  })

  it('skips a VEVENT without a title', () => {
    const events = parseIcal(
      calendar(
        vevent('UID:a@x', 'SUMMARY:   ', 'DTSTART:20261101T190000Z'),
        vevent('UID:b@x', 'DTSTART:20261101T190000Z'),
        vevent('UID:c@x', 'SUMMARY:Named', 'DTSTART:20261101T190000Z'),
      ),
      cfg,
    )
    expect(events.map((e) => e.uid)).toEqual(['c@x'])
  })

  it('returns a VEVENT that appears twice once, last wins', () => {
    const first = vevent('UID:1-100@x', 'SUMMARY:First', 'DTSTART:20261101T190000Z')
    const second = vevent('UID:1-100@x', 'SUMMARY:Second', 'DTSTART:20261101T190000Z')
    const events = parseIcal(calendar(first, second), ingestSourceConfigSchema.parse({ external_id_pattern: '-(\\d+)@' }))
    expect(events).toHaveLength(1)
    expect(events[0]?.summary).toBe('Second')
  })

  it('rejects text that is not a calendar', () => {
    expect(() => parseIcal('<html><body>Not found</body></html>', cfg)).toThrow(FeedParseError)
    expect(() => parseIcal('', cfg)).toThrow(FeedParseError)
  })

  it('rejects an explicit TZID it cannot resolve instead of guessing', () => {
    const text = calendar(vevent('UID:a@x', 'SUMMARY:London', 'DTSTART;TZID=Europe/London:20261101T190000'))
    expect(() => parseIcal(text, cfg)).toThrow(/Europe\/London/)
  })

  it('accepts TZID=Europe/Berlin without a VTIMEZONE', () => {
    const e = only(parseIcal(calendar(vevent('UID:a@x', 'SUMMARY:Berlin', 'DTSTART;TZID=Europe/Berlin:20261101T190000')), cfg))
    expect(e.start.iso).toBe('2026-11-01T19:00:00+01:00')
  })

  it('rejects a timezone other than Europe/Berlin with a clear message', () => {
    expect(() => parseIcal(fixture, ingestSourceConfigSchema.parse({ timezone: 'America/New_York' }))).toThrow(
      /Europe\/Berlin/,
    )
  })
})
