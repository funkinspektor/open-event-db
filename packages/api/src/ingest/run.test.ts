import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import {
  editHistory,
  events,
  ingestItems,
  ingestSources,
  publishers,
  type IngestItem,
  type IngestSource,
  type Publisher,
  venues,
} from '@open-event-db/db'
import type { Extraction } from '@open-event-db/shared'
import { db } from '../db.js'
import { textExtraction } from '../extract/text.js'
import { ExtractionError } from '../extract/vision.js'
import { feedUrl, runIngest } from './run.js'

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/acud.ics', import.meta.url)), 'utf8')
const EMPTY_FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nEND:VCALENDAR\r\n'
const ACUD = { external_id_pattern: '-(\\d+)@', extract_from_text: true }
const PERSIAN = '2391' // Persian Love: SHAB SHOD, 2026-10-30 22:00, inside the run window

const NOW = new Date('2026-10-28T05:00:00Z')
const LATER = new Date('2026-10-29T05:00:00Z')
const LATEST = new Date('2026-10-30T05:00:00Z')

const stamp = Date.now()
let scout: Publisher
let seq = 0
const sourceIds: string[] = []
const venueIds: string[] = []

const extraction = (fields: Partial<Extraction>): Extraction => ({
  title: null,
  date: null,
  start_time: null,
  end_date: null,
  end_time: null,
  venue_name: null,
  address: null,
  city: null,
  description: null,
  lineup: [],
  tags: [],
  links: [],
  ...fields,
})

/** Extractor stub that reads fixed times and counts its calls. */
function stubExtractor() {
  const stub = { calls: 0 }
  textExtraction.setExtractor({
    async extract() {
      stub.calls++
      return extraction({ start_time: '22:00', end_time: '04:00' })
    },
  })
  return stub
}

async function newSource(config: Record<string, unknown> = ACUD, suffix = ''): Promise<IngestSource> {
  const slug = `run-${stamp}${suffix}-${++seq}`
  const [s] = await db
    .insert(ingestSources)
    .values({
      slug,
      name: `Run source ${seq}`,
      kind: 'ical',
      url: `https://${slug}.test/?scope={from}--{to}`,
      publisherId: scout.id,
      config,
    })
    .returning()
  sourceIds.push(s!.id)
  return s!
}

const run = (source: IngestSource, text: string, now: Date) =>
  runIngest({ only: source.slug, now, fetchText: async () => text })

const itemsOf = (sourceId: string) => db.select().from(ingestItems).where(eq(ingestItems.sourceId, sourceId))

async function itemOf(sourceId: string, externalId: string): Promise<IngestItem> {
  const [item] = await db
    .select()
    .from(ingestItems)
    .where(and(eq(ingestItems.sourceId, sourceId), eq(ingestItems.externalId, externalId)))
  return item!
}

const sourceRow = async (id: string) => (await db.select().from(ingestSources).where(eq(ingestSources.id, id)))[0]!

/** Accepts an item by hand: an event row from its draft, created by the source's scout. */
async function accept(item: IngestItem, extra: { detachedAt?: Date } = {}) {
  const draft = item.draft as { title: string; starts_at: string; ends_at: string | null }
  const [event] = await db
    .insert(events)
    .values({
      title: draft.title,
      startsAt: new Date(draft.starts_at),
      endsAt: draft.ends_at ? new Date(draft.ends_at) : null,
      locationText: 'ACUD Club',
      city: 'Berlin',
      links: { instagram: 'https://instagram.com/acud' },
      createdBy: scout.id,
    })
    .returning()
  await db
    .update(ingestItems)
    .set({ status: 'accepted', eventId: event!.id, ...extra })
    .where(eq(ingestItems.id, item.id))
  return event!
}

const eventRow = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0]!

const movePersian = (text: string) => text.replace('DTSTART;TZID=:20261030T220000', 'DTSTART;TZID=:20261106T220000')
const withoutPersian = (text: string) =>
  text.replace(/BEGIN:VEVENT\r\n(?:(?!BEGIN:VEVENT)[\s\S])*?-2391@[\s\S]*?END:VEVENT\r\n/, '')

beforeAll(async () => {
  const [p] = await db
    .insert(publishers)
    .values({
      name: 'Run Scout',
      slug: `run-scout-${stamp}`,
      email: `run-scout-${stamp}@test.local`,
      verified: true,
      isPublisher: false,
      isScout: true,
    })
    .returning()
  scout = p!
})

afterEach(() => textExtraction.reset())

afterAll(async () => {
  if (sourceIds.length) await db.delete(ingestSources).where(inArray(ingestSources.id, sourceIds))
  await db.delete(editHistory).where(eq(editHistory.publisherId, scout.id))
  await db.delete(events).where(eq(events.createdBy, scout.id))
  if (venueIds.length) await db.delete(venues).where(inArray(venues.id, venueIds))
  await db.delete(publishers).where(eq(publishers.id, scout.id))
})

describe('feedUrl', () => {
  it('fills {from} and {to} with Berlin dates over horizon_days', async () => {
    const source = await newSource()
    // 23:30 UTC is already the next day in Berlin
    expect(feedUrl(source, new Date('2026-10-28T23:30:00Z'))).toBe(
      `https://${source.slug}.test/?scope=2026-10-29--2027-04-27`,
    )
  })
})

describe('runIngest', () => {
  it('stores new feed events as pending items', async () => {
    const stub = stubExtractor()
    const source = await newSource()
    const urls: string[] = []
    const result = await runIngest({
      only: source.slug,
      now: NOW,
      fetchText: async (url) => {
        urls.push(url)
        return fixture
      },
    })
    expect(result.skipped).toBe(false)
    expect(urls).toEqual([`https://${source.slug}.test/?scope=2026-10-28--2027-04-26`])
    expect(result.sources).toEqual([
      { slug: source.slug, ok: true, seen: 5, created: 5, updated: 0, synced: 0, gone: 0 },
    ])
    expect(stub.calls).toBe(5)

    const items = await itemsOf(source.id)
    expect(items).toHaveLength(5)
    expect(items.every((i) => i.status === 'pending' && i.contentHash !== null)).toBe(true)
    const persian = items.find((i) => i.externalId === PERSIAN)!
    expect(persian.draft).toMatchObject({
      title: 'Persian Love: SHAB SHOD',
      starts_at: '2026-10-30T22:00:00+01:00',
      times_unverified: false,
    })
    expect(persian.firstSeenAt.getTime()).toBe(NOW.getTime())

    const row = await sourceRow(source.id)
    expect(row.lastRunAt?.getTime()).toBe(NOW.getTime())
    expect(row.lastItemCount).toBe(5)
    expect(row.lastError).toBeNull()
  })

  it('only touches lastSeenAt for an unchanged feed and does not extract again', async () => {
    let stub = stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    expect(stub.calls).toBe(5)

    stub = stubExtractor()
    // A re-export with a new DTSTAMP is no change
    const result = await run(source, fixture.replaceAll('DTSTAMP:20261028T', 'DTSTAMP:20261029T'), LATER)
    expect(result.sources[0]).toMatchObject({ ok: true, seen: 5, created: 0, updated: 0 })
    expect(stub.calls).toBe(0)
    const items = await itemsOf(source.id)
    expect(items.every((i) => i.lastSeenAt.getTime() === LATER.getTime())).toBe(true)
    expect(items.every((i) => i.firstSeenAt.getTime() === NOW.getTime())).toBe(true)
  })

  it('keeps a rejected item rejected but updates its draft', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    const before = await itemOf(source.id, PERSIAN)
    await db.update(ingestItems).set({ status: 'rejected' }).where(eq(ingestItems.id, before.id))

    const changed = fixture.replace('SUMMARY:Persian Love: SHAB SHOD', 'SUMMARY:Persian Love: SHAB SHOD (new date)')
    const result = await run(source, changed, LATER)
    expect(result.sources[0]).toMatchObject({ ok: true, created: 0, updated: 1, synced: 0 })

    const after = await itemOf(source.id, PERSIAN)
    expect(after.status).toBe('rejected')
    expect(after.eventId).toBeNull()
    expect((after.draft as { title: string }).title).toBe('Persian Love: SHAB SHOD (new date)')
    expect(after.raw).toContain('(new date)')
    expect(after.contentHash).not.toBe(before.contentHash)
  })

  it('syncs a changed feed event into its accepted event and logs it via ingest', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    const event = await accept(await itemOf(source.id, PERSIAN))

    const result = await run(source, movePersian(fixture), LATER)
    expect(result.sources[0]).toMatchObject({ ok: true, updated: 1, synced: 1 })

    const synced = await eventRow(event.id)
    expect(synced.startsAt.toISOString()).toBe('2026-11-06T21:00:00.000Z')
    expect(synced.endsAt?.toISOString()).toBe('2026-11-07T03:00:00.000Z')
    expect(synced.title).toBe('Persian Love: SHAB SHOD')
    expect(synced.description).not.toBe('')
    expect(synced.city).toBe('Berlin')
    // links.website merged in; other links kept
    expect(synced.links).toEqual({
      instagram: 'https://instagram.com/acud',
      website: 'https://acudmachtneu.de/events/persian-love-shab-shod/',
    })

    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, event.id))
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ entityType: 'event', action: 'updated', publisherId: scout.id })
    expect(history[0]!.diff.via).toBe('ingest')
    expect(history[0]!.diff.starts_at).toEqual({
      before: '2026-10-30T21:00:00.000Z',
      after: '2026-11-06T21:00:00.000Z',
    })
    expect(history[0]!.diff).not.toHaveProperty('city')

    // An unchanged next run neither syncs nor logs again
    const again = await run(source, movePersian(fixture), LATEST)
    expect(again.sources[0]).toMatchObject({ updated: 0, synced: 0 })
    expect(await db.select().from(editHistory).where(eq(editHistory.entityId, event.id))).toHaveLength(1)
  })

  it('syncs a mapped venue with its city, and falls back to the source name for a deleted venue', async () => {
    stubExtractor()
    const [club] = await db
      .insert(venues)
      .values({ name: `Run Club ${stamp}`, address: 'Veteranenstr. 21', city: 'Potsdam' })
      .returning()
    venueIds.push(club!.id)
    const missing = '0190a0b0-0000-7000-8000-00000000dead'
    const source = await newSource({ ...ACUD, venues: { Club: club!.id } })
    await run(source, fixture, NOW)
    const event = await accept(await itemOf(source.id, PERSIAN))

    await run(source, movePersian(fixture), LATER)
    expect(await eventRow(event.id)).toMatchObject({ venueId: club!.id, locationText: null, city: 'Potsdam' })

    await db
      .update(ingestSources)
      .set({ config: { ...ACUD, venues: { Club: missing } } })
      .where(eq(ingestSources.id, source.id))
    const result = await run(source, fixture, LATEST)
    expect(result.sources[0]).toMatchObject({ ok: true, synced: 1 })
    // City stays with the event when no venue replaces it
    expect(await eventRow(event.id)).toMatchObject({ venueId: null, locationText: source.name, city: 'Potsdam' })
  })

  it('does not sync an event whose item is detached', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    const event = await accept(await itemOf(source.id, PERSIAN), { detachedAt: NOW })

    const result = await run(source, movePersian(fixture), LATER)
    expect(result.sources[0]).toMatchObject({ ok: true, updated: 1, synced: 0 })

    const after = await eventRow(event.id)
    expect(after.startsAt.getTime()).toBe(event.startsAt.getTime())
    expect(after.links).toEqual(event.links)
    expect(await db.select().from(editHistory).where(eq(editHistory.entityId, event.id))).toHaveLength(0)
    const item = await itemOf(source.id, PERSIAN)
    expect((item.draft as { starts_at: string }).starts_at).toBe('2026-11-06T22:00:00+01:00')
  })

  it('does not overwrite an event edited by hand while the run was extracting', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    const item = await itemOf(source.id, PERSIAN)
    const event = await accept(item)

    // PUT /events/:id lands mid-run: it edits the event and detaches the item in one go
    textExtraction.setExtractor({
      async extract() {
        await db.update(events).set({ title: 'Edited by hand' }).where(eq(events.id, event.id))
        await db.update(ingestItems).set({ detachedAt: LATER }).where(eq(ingestItems.id, item.id))
        return extraction({ start_time: '22:00', end_time: '04:00' })
      },
    })
    const result = await run(source, movePersian(fixture), LATER)
    expect(result.sources[0]).toMatchObject({ ok: true, updated: 1, synced: 0 })

    const after = await eventRow(event.id)
    expect(after.title).toBe('Edited by hand')
    expect(after.startsAt.getTime()).toBe(event.startsAt.getTime())
    expect(await db.select().from(editHistory).where(eq(editHistory.entityId, event.id))).toHaveLength(0)
  })

  it('marks an item gone when it leaves the feed and clears it when it comes back', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    await accept(await itemOf(source.id, PERSIAN))

    const result = await run(source, withoutPersian(fixture), LATER)
    expect(result.sources[0]).toMatchObject({ ok: true, seen: 4, gone: 1 })
    const items = await itemsOf(source.id)
    const gone = items.filter((i) => i.goneAt !== null)
    expect(gone.map((i) => i.externalId)).toEqual([PERSIAN])
    expect(gone[0]!.goneAt!.getTime()).toBe(LATER.getTime())

    // Gone and kept by a scout, then back in the feed: a later disappearance shows up again
    await db.update(ingestItems).set({ goneResolvedAt: LATER }).where(eq(ingestItems.id, gone[0]!.id))
    const back = await run(source, fixture, LATEST)
    expect(back.sources[0]).toMatchObject({ ok: true, gone: 0 })
    const item = await itemOf(source.id, PERSIAN)
    expect(item.goneAt).toBeNull()
    expect(item.goneResolvedAt).toBeNull()
  })

  it('does not mark items gone that start outside the run window', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    // Burre (2390) started 2026-10-16, before the window that starts today
    const withoutBurre = fixture.replace(/BEGIN:VEVENT\r\n(?:(?!BEGIN:VEVENT)[\s\S])*?-2390@[\s\S]*?END:VEVENT\r\n/, '')
    const result = await run(source, withoutBurre, LATER)
    expect(result.sources[0]).toMatchObject({ ok: true, seen: 4, gone: 0 })
    expect((await itemOf(source.id, '2390')).goneAt).toBeNull()
  })

  it('records an HTML error page as the source error, marks nothing gone and runs the next source', async () => {
    stubExtractor()
    const broken = await newSource(ACUD, '-a')
    const healthy = await newSource(ACUD, '-b')
    await run(broken, fixture, NOW)

    const result = await runIngest({
      only: [broken.slug, healthy.slug],
      now: LATER,
      fetchText: async (url) => (url.includes(broken.slug) ? '<html>error</html>' : fixture),
    })
    expect(result.sources.map((s) => s.slug)).toEqual([broken.slug, healthy.slug])
    expect(result.sources[0]).toMatchObject({ ok: false, gone: 0 })
    expect(result.sources[0]!.error).toMatch(/iCal/)
    expect(result.sources[1]).toMatchObject({ ok: true, created: 5 })

    const row = await sourceRow(broken.id)
    expect(row.lastError).toMatch(/iCal/)
    expect(row.lastItemCount).toBe(5)
    expect((await itemsOf(broken.id)).every((i) => i.goneAt === null)).toBe(true)
    expect(await itemsOf(healthy.id)).toHaveLength(5)
  })

  it('treats an empty feed after a non-empty run as an error and marks nothing gone', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)

    const result = await run(source, EMPTY_FEED, LATER)
    expect(result.sources[0]).toMatchObject({ ok: false, seen: 0, gone: 0 })
    const row = await sourceRow(source.id)
    expect(row.lastError).toMatch(/empty/i)
    expect(row.lastItemCount).toBe(5)
    expect((await itemsOf(source.id)).every((i) => i.goneAt === null)).toBe(true)

    // The next good run clears the error
    const good = await run(source, fixture, LATEST)
    expect(good.sources[0]).toMatchObject({ ok: true })
    expect((await sourceRow(source.id)).lastError).toBeNull()
  })

  it('fails the whole source when the id pattern stops matching, and marks nothing gone', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    const event = await accept(await itemOf(source.id, PERSIAN))

    // A pattern that no longer fits the UIDs must not turn every event into a new item
    await db
      .update(ingestSources)
      .set({ config: { ...ACUD, external_id_pattern: '-(\\d+)@nowhere\\.test$' } })
      .where(eq(ingestSources.id, source.id))
    const result = await run(source, movePersian(fixture), LATER)
    expect(result.sources[0]).toMatchObject({ ok: false, created: 0, updated: 0, gone: 0 })
    expect(result.sources[0]!.error).toMatch(/nowhere/)
    expect((await sourceRow(source.id)).lastError).toMatch(/acudmachtneu\.de/)

    const items = await itemsOf(source.id)
    expect(items).toHaveLength(5)
    expect(items.every((i) => i.goneAt === null)).toBe(true)
    expect((await itemOf(source.id, PERSIAN)).eventId).toBe(event.id)
    expect((await eventRow(event.id)).startsAt.getTime()).toBe(event.startsAt.getTime())
  })

  it('treats an empty feed as an error when items are stored, even without a recorded last count', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    // A first run that crashed after writing items but before recording its count
    await db.update(ingestSources).set({ lastItemCount: null }).where(eq(ingestSources.id, source.id))

    const result = await run(source, EMPTY_FEED, LATER)
    expect(result.sources[0]).toMatchObject({ ok: false, seen: 0, gone: 0 })
    expect((await sourceRow(source.id)).lastError).toMatch(/empty/i)
    expect((await itemsOf(source.id)).every((i) => i.goneAt === null)).toBe(true)
  })

  it('does not extract for rejected or detached items whose content changed', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    await db.update(ingestItems).set({ status: 'rejected' }).where(eq(ingestItems.id, (await itemOf(source.id, PERSIAN)).id))
    await accept(await itemOf(source.id, '2390'), { detachedAt: NOW })

    const stub = stubExtractor()
    const changed = fixture
      .replace('SUMMARY:Persian Love: SHAB SHOD', 'SUMMARY:Persian Love: SHAB SHOD (changed)')
      .replace('SUMMARY:Burre w/ Heavenphetamine', 'SUMMARY:Burre w/ Heavenphetamine (changed)')
    const result = await run(source, changed, LATER)
    expect(result.sources[0]).toMatchObject({ ok: true, updated: 2, synced: 0 })
    expect(stub.calls).toBe(0)
    expect((await itemOf(source.id, PERSIAN)).draft).toMatchObject({ title: 'Persian Love: SHAB SHOD (changed)' })
    expect((await itemOf(source.id, '2390')).draft).toMatchObject({ title: 'Burre w/ Heavenphetamine (changed)' })
  })

  it('fails a source with an invalid config', async () => {
    const source = await newSource({ external_id_pattern: '(' })
    const result = await run(source, fixture, NOW)
    expect(result.sources[0]).toMatchObject({ slug: source.slug, ok: false })
    expect((await sourceRow(source.id)).lastError).toBeTruthy()
    expect(await itemsOf(source.id)).toHaveLength(0)
  })

  it('stores feed times unverified when extraction fails and retries on the next run', async () => {
    textExtraction.setExtractor({
      async extract() {
        throw new Error('provider down')
      },
    })
    const source = await newSource()
    const first = await run(source, fixture, NOW)
    expect(first.sources[0]).toMatchObject({ ok: true, created: 5 })
    const failed = await itemOf(source.id, PERSIAN)
    expect(failed.contentHash).toBeNull()
    expect(failed.draft).toMatchObject({ times_unverified: true, starts_at: '2026-10-30T22:00:00+01:00' })

    const stub = stubExtractor()
    const second = await run(source, fixture, LATER)
    expect(stub.calls).toBe(5)
    expect(second.sources[0]).toMatchObject({ ok: true, created: 0, updated: 5 })
    const retried = await itemOf(source.id, PERSIAN)
    expect(retried.contentHash).not.toBeNull()
    expect(retried.draft).toMatchObject({ times_unverified: false, ends_at: '2026-10-31T04:00:00+01:00' })
  })

  it('does not push unverified feed times onto an accepted event when extraction fails', async () => {
    stubExtractor()
    const source = await newSource()
    await run(source, fixture, NOW)
    const event = await accept(await itemOf(source.id, PERSIAN))

    textExtraction.setExtractor({
      async extract() {
        throw new Error('provider down')
      },
    })
    const failed = await run(source, movePersian(fixture), LATER)
    expect(failed.sources[0]).toMatchObject({ ok: true, updated: 1, synced: 0 })
    const after = await eventRow(event.id)
    expect(after.startsAt.getTime()).toBe(event.startsAt.getTime())
    expect(await db.select().from(editHistory).where(eq(editHistory.entityId, event.id))).toHaveLength(0)
    expect((await itemOf(source.id, PERSIAN)).contentHash).toBeNull()

    // The next run with a working extractor retries and syncs
    stubExtractor()
    const retried = await run(source, movePersian(fixture), LATEST)
    expect(retried.sources[0]).toMatchObject({ ok: true, synced: 1 })
    expect((await eventRow(event.id)).startsAt.toISOString()).toBe('2026-11-06T21:00:00.000Z')
  })

  it('fails the source when it asks for text extraction but none is configured', async () => {
    textExtraction.setExtractor({
      async extract() {
        throw new ExtractionError('unavailable', 'Text extraction is not configured on this server')
      },
    })
    const source = await newSource()
    const result = await run(source, fixture, NOW)
    expect(result.sources[0]).toMatchObject({ ok: false })
    expect(result.sources[0]!.error).toMatch(/extract_from_text.*not configured/)
    expect((await sourceRow(source.id)).lastError).toMatch(/not configured/)
  })

  it('does not extract when the source does not ask for it', async () => {
    const stub = stubExtractor()
    const source = await newSource({ external_id_pattern: '-(\\d+)@' })
    const result = await run(source, fixture, NOW)
    expect(result.sources[0]).toMatchObject({ ok: true, created: 5 })
    expect(stub.calls).toBe(0)
    expect((await itemOf(source.id, PERSIAN)).contentHash).not.toBeNull()
  })

  it('skips a run while another one holds the lock', async () => {
    stubExtractor()
    const source = await newSource()
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      return fixture
    }
    const results = await Promise.all([
      runIngest({ only: source.slug, now: NOW, fetchText: slow }),
      runIngest({ only: source.slug, now: NOW, fetchText: slow }),
    ])
    expect(results.map((r) => r.skipped).sort()).toEqual([false, true])
    expect(results.find((r) => r.skipped)!.sources).toEqual([])
    expect(await itemsOf(source.id)).toHaveLength(5)
  })
})
