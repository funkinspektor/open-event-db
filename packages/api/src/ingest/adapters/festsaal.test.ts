import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { parseFestsaal } from './festsaal.js'
import { FeedParseError, type FeedEvent } from './ical.js'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/festsaal/events.json', import.meta.url)), 'utf8')
const config = ingestSourceConfigSchema.parse({})
const API = 'https://admin.festsaal-kreuzberg.de/api/v2/pages/?type=home.EventPage&locale=de&limit=500'
// Saturday 2026-10-31, 12:00 Berlin: the day the fixture was saved
const NOW = new Date('2026-10-31T11:00:00Z')

const read = (text = fixture, now = NOW) => parseFestsaal(text, config, { pageUrl: API, now })

type Page = Record<string, unknown> & { id: number }
/** The fixture with its pages changed by `edit`. */
function edited(edit: (pages: Page[]) => Page[]): string {
  const listing = JSON.parse(fixture) as { meta: { total_count: number }; items: Page[] }
  const items = edit(listing.items)
  return JSON.stringify({ meta: { total_count: items.length }, items })
}
const withPage = (id: number, fields: Record<string, unknown>) =>
  edited((pages) => pages.map((p) => (p.id === id ? { ...p, ...fields } : p)))

const byId = (events: FeedEvent[], id: string) => {
  const found = events.find((e) => e.externalId === id)
  if (!found) throw new Error(`no event ${id}`)
  return found
}

describe('parseFestsaal (fixture)', () => {
  it('reads every upcoming page once, its page id as the id, where and when it takes place', () => {
    expect(read().map((e) => [e.externalId, e.start.date, e.summary, e.locationRoom])).toEqual([
      ['789', '2026-10-31', 'Unterwelt Festival', 'Festsaal'],
      ['911', '2026-11-01', 'RODA', 'Festsaal'],
      ['734', '2026-11-03', 'Gloryhammer', 'Festsaal'],
      ['906', '2026-11-06', 'Flugmodus', 'Kaminzimmer'],
      ['707', '2026-11-07', 'Mariybu', 'Festsaal'],
      ['693', '2026-11-14', '$ONO$ CLIQ', 'Bi Nuu'],
      ['715', '2027-10-04', 'Any Given Day', 'Festsaal'],
      ['850', '2027-01-08', 'Mach One', 'Festsaal'],
      ['865', '2027-01-23', 'MONCHI', 'Urania'],
      ['877', '2027-01-24', 'COMEBACK KID', 'Festsaal'],
      ['904', '2027-01-29', 'DARK NIGHTS', 'Festsaal'],
      ['834', '2027-02-22', 'Julia Jacklin', 'Festsaal'],
      ['733', '2027-03-05', 'Karate Andi', 'Festsaal'],
      ['740', '2027-03-06', 'Hinterlandgang', 'SO36'],
      ['827', '2027-04-01', 'Wa22ermann', 'Festsaal'],
    ])
  })

  it('maps a concert with its start, doors, age, ticket link, image and text', () => {
    const ev = byId(read(), '734')
    expect(ev).toMatchObject({
      uid: 'https://festsaal-kreuzberg.de/de/programm/Gloryhammer/',
      start: { date: '2026-11-03', time: '19:00', iso: '2026-11-03T19:00:00+01:00' },
      end: null,
      url: 'https://festsaal-kreuzberg.de/de/programm/Gloryhammer/',
      imageUrl: 'https://v2.files.funkhaus.io/fsk-1170-media/images/gloryhammer.min-1450x1450.jpegquality-75.jpg',
      locationText: 'Festsaal',
      timesStated: true,
      links: { tickets: 'https://landstreicher-konzerte.de/konzerte/gloryhammer-b-26' },
    })
    expect(ev.description).toMatch(
      /^5th Album Release Tour 2026 \| Support: Majestica & Arion\n\nEinlass 18:00\n\nAb 16 Jahren\n\nAnd lo, Planet Earth/,
    )
  })

  it('names the support and leaves out a door time equal to the start', () => {
    expect(byId(read(), '877').description).toMatch(/^Support: \+Haywire \+Whispers \+Speedway\n\nEinlass 18:00\n\n/)
    expect(byId(read(), '906').description).toMatch(/^Arnim legt auf \+ RAEDY\n\nAb 18 Jahren\n\nDie Party des Jahres/)
  })

  it('reads a moved show once, at its new date and times', () => {
    const events = read()
    expect(events.filter((e) => e.externalId === '715')).toHaveLength(1)
    expect(byId(events, '715').start.iso).toBe('2027-10-04T20:00:00+02:00')
    expect(byId(events, '715').description).toContain('Verschoben vom 23.11.2026')
    // Without new times the old ones stay
    expect(byId(events, '850').start.iso).toBe('2027-01-08T20:30:00+01:00')
    // The original date may already be past
    expect(byId(events, '827').description).toContain('Das Konzert wurde vom 25.10.26 auf den 01.04.27 verschoben!')
  })

  it('places a transferred show and one whose custom note names another venue there', () => {
    const events = read()
    expect(byId(events, '693').description).toContain('Das Konzert wurde vom Festsaal Kreuzberg ins Bi Nuu verlegt')
    expect(byId(events, '865').description).toContain('Diese Veranstaltung findet im Urania statt und ist ausverkauft.')
    expect(byId(events, '740').locationText).toBe('SO36')
  })

  it('ignores notes on pages without a status, as the site does', () => {
    const events = read()
    // A stale "im SO36" note: SO36 had another show that night
    expect(byId(events, '834').description).not.toContain('SO36')
    // A stale cancellation copied from an older page
    expect(byId(events, '911').description).not.toContain('abgesagt')
  })

  it('says when a show is sold out', () => {
    expect(byId(read(), '707').description).toMatch(/^FRECH Tour\n\nAusverkauft\n\nEinlass 19:00/)
  })

  it('leaves out cancelled shows, unknown statuses and moves without a new date', () => {
    expect(read(withPage(734, { status: 'cancelled' })).map((e) => e.externalId)).not.toContain('734')
    expect(read(withPage(734, { status: 'postponed' })).map((e) => e.externalId)).not.toContain('734')
    expect(read(withPage(734, { status: 'moved_date', changed_date: null })).map((e) => e.externalId)).not.toContain('734')
  })

  it('starts at the doors when no start is given, and leaves shows past their day out', () => {
    expect(byId(read(withPage(734, { start: null })), '734').start.time).toBe('18:00')
    const later = read(fixture, new Date('2026-11-02T11:00:00Z')).map((e) => e.externalId)
    expect(later).not.toContain('911')
    expect(later).toContain('734')
  })

  it('falls back to the original image without a smaller rendition', () => {
    const original = 'https://v2.files.funkhaus.io/fsk-1170-media/original_images/gloryhammer.jpg'
    expect(byId(read(withPage(734, { preview_image: { id: 1, download_url: original } })), '734').imageUrl).toBe(original)
    expect(byId(read(withPage(734, { preview_image: null })), '734').imageUrl).toBeNull()
  })

  it('changes the hash only when the page changes', () => {
    const before = byId(read(), '734').hash
    expect(byId(read(), '734').hash).toBe(before)
    expect(byId(read(withPage(734, { start: '19:30:00' })), '734').hash).not.toBe(before)
  })
})

describe('parseFestsaal (errors)', () => {
  it('fails on an answer that is no page listing', () => {
    expect(() => read('<html>Bad Gateway</html>')).toThrow(FeedParseError)
    expect(() => read('{"detail":"Not found"}')).toThrow(FeedParseError)
  })

  it('fails when the listing is cut off by its limit', () => {
    const cut = JSON.stringify({ ...JSON.parse(fixture), meta: { total_count: 100 } })
    expect(() => read(cut)).toThrow(/raise limit=/)
  })

  it('fails when the source URL does not ask for the fields', () => {
    const bare = edited((pages) => pages.map(({ id, title, url }) => ({ id, title, url }) as Page))
    expect(() => read(bare)).toThrow(/fields DEPLOY\.md lists/)
  })

  it('reads an empty programme as no events', () => {
    expect(read('{"meta":{"total_count":0},"items":[]}')).toEqual([])
  })
})
