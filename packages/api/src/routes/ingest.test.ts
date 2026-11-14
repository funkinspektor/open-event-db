import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq, inArray } from 'drizzle-orm'
import {
  editHistory,
  ensureSuggestionsSource,
  eventOrganizers,
  events,
  ingestItems,
  ingestSources,
  venues,
  type Account,
  type IngestItem,
  type Organizer,
  type Venue,
} from '@open-event-db/db'
import { ingestSourceConfigSchema } from '@open-event-db/shared'
import { encodeCursor } from '../cursor.js'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { email, type EmailTransport } from '../email.js'
import { cleanup, createAccount } from '../test/fixtures.js'
import { imageStore, localImageStore, memoryImageStore } from '../images/store.js'
import { ingestImages } from '../ingest/image.js'
import { parseUrbanSpreeDetail, type UrbanSpreeCard } from '../ingest/adapters/urbanspree.js'
import { normalizeFeedEvent } from '../ingest/normalize.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9])

let app: FastifyInstance
let scout: Account
let feedScout: Account
let alice: Account
let aliceOrganizer: Organizer
let keyScout: string
let keyAlice: string
let venue: Venue
let sourceId: string
const stamp = Date.now()
let seq = 0
const eventIds: string[] = []

const auth = (key: string) => ({ authorization: `Bearer ${key}` })
const sourceName = `Inbox Source ${stamp}`

const draftOf = (over: Record<string, unknown> = {}) => ({
  title: `Inbox event ${stamp}-${++seq}`,
  description: 'Verbatim feed description',
  starts_at: '2031-03-01T20:00:00.000Z',
  ends_at: null,
  venue_id: null,
  location_text: 'Feed Hall',
  city: 'Feedcity',
  links: { website: 'https://feed.test/e' },
  image_url: null,
  source_url: 'https://feed.test/e',
  times_unverified: false,
  ...over,
})

async function newItem(over: Partial<typeof ingestItems.$inferInsert> = {}, draft: Record<string, unknown> = draftOf()): Promise<IngestItem> {
  const [item] = await db
    .insert(ingestItems)
    .values({ sourceId, externalId: `ext-${stamp}-${++seq}`, draft, raw: 'raw', ...over })
    .returning()
  return item!
}

const itemRow = async (id: string) => (await db.select().from(ingestItems).where(eq(ingestItems.id, id)))[0]!
const eventRow = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0]!

/** The view's items of this file's source, every page of it. */
async function listIds(view: 'new' | 'filtered' | 'gone'): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const url = `/api/v1/ingest/items?view=${view}&source=inbox-${stamp}&limit=100${cursor ? `&cursor=${cursor}` : ''}`
    const res = await app.inject({ method: 'GET', url, headers: auth(keyScout) })
    expect(res.statusCode).toBe(200)
    const body: { data: { id: string }[]; meta: { cursor: string | null } } = res.json()
    ids.push(...body.data.map((i) => i.id))
    cursor = body.meta.cursor
  } while (cursor)
  return ids
}

const listUrl = (query: string) => `/api/v1/ingest/items?source=inbox-${stamp}&limit=100&${query}`

const post = (url: string, key: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api/v1/ingest${url}`, headers: auth(key), payload: payload as object })

beforeAll(async () => {
  app = await buildApp({ logger: false })
  const sc = await createAccount({ scout: true, organizer: false, label: 'inbox-scout' })
  const al = await createAccount({ label: 'inbox-alice' })
  scout = sc.account
  keyScout = sc.key
  alice = al.account
  aliceOrganizer = al.organizer!
  keyAlice = al.key
  feedScout = (await createAccount({ scout: true, organizer: false, label: 'inbox-feed-scout' })).account

  const [v] = await db
    .insert(venues)
    .values({ name: `Inbox Venue ${stamp}`, address: '1 Test St', city: 'Venuetown' })
    .returning()
  venue = v!
  const [src] = await db
    .insert(ingestSources)
    .values({ slug: `inbox-${stamp}`, name: sourceName, kind: 'ical', url: 'https://inbox.test/feed.ics', accountId: feedScout.id })
    .returning()
  sourceId = src!.id
})

afterAll(async () => {
  const ids = [scout.id, alice.id, feedScout.id]
  const created = await db.select({ id: events.id }).from(events).where(inArray(events.createdBy, ids))
  const allEventIds = [...new Set([...eventIds, ...created.map((e) => e.id)])]
  await db.delete(ingestSources).where(eq(ingestSources.id, sourceId)) // cascades items
  if (allEventIds.length) await db.delete(editHistory).where(inArray(editHistory.entityId, allEventIds))
  await db.delete(editHistory).where(inArray(editHistory.accountId, ids))
  await db.delete(events).where(inArray(events.id, allEventIds))
  await db.delete(venues).where(eq(venues.id, venue.id))
  await cleanup()
  await app.close()
})

describe('access control', () => {
  it('answers 401 without credentials and 403 for non-scouts on every endpoint', async () => {
    const item = await newItem()
    const calls: [string, string, unknown?][] = [
      ['GET', '/api/v1/ingest/items'],
      ['GET', '/api/v1/ingest/count'],
      ['GET', `/api/v1/ingest/items/${item.id}`],
      ['POST', `/api/v1/ingest/items/${item.id}/accept`, {}],
      ['POST', '/api/v1/ingest/items/reject', { ids: [item.id] }],
      ['POST', `/api/v1/ingest/items/${item.id}/link`, { event_id: item.id }],
      ['POST', `/api/v1/ingest/items/${item.id}/gone`, { action: 'keep' }],
    ]
    for (const [method, url, payload] of calls) {
      const anon = await app.inject({ method: method as 'GET', url, payload: payload as object })
      expect(anon.statusCode, `${method} ${url} anonymous`).toBe(401)
      const res = await app.inject({ method: method as 'GET', url, headers: auth(keyAlice), payload: payload as object })
      expect(res.statusCode, `${method} ${url} non-scout`).toBe(403)
      expect(res.json().error.code).toBe('forbidden')
    }
    expect((await itemRow(item.id)).status).toBe('pending')
  })
})

describe('GET /ingest/items/:id', () => {
  const getItem = (id: string) => app.inject({ method: 'GET', url: `/api/v1/ingest/items/${id}`, headers: auth(keyScout) })

  it('returns a new item with its venue and duplicates', async () => {
    const draft = draftOf({ venue_id: venue.id, starts_at: '2031-05-01T20:00:00.000Z', title: `Detail dup ${stamp}` })
    const [twin] = await db
      .insert(events)
      .values({ title: draft.title, startsAt: new Date(draft.starts_at), venueId: venue.id, city: venue.city, createdBy: alice.id })
      .returning()
    eventIds.push(twin!.id)
    const item = await newItem({}, draft)
    const res = await getItem(item.id)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toMatchObject({ id: item.id, state: 'new', status: 'pending', source: { name: sourceName }, venue_name: venue.name })
    expect(data.venue).toEqual({ id: venue.id, name: venue.name, address: venue.address, city: venue.city, coordinates: null })
    expect(data.duplicates.map((d: { id: string }) => d.id)).toContain(twin!.id)
  })

  it('reports the state of decided and over items', async () => {
    const rejected = await newItem({ status: 'rejected' })
    expect((await getItem(rejected.id)).json().data).toMatchObject({ state: 'rejected', duplicates: [] })

    const over = await newItem({}, draftOf({ starts_at: '2020-01-01T20:00:00.000Z' }))
    expect((await getItem(over.id)).json().data.state).toBe('over')

    const removed = await newItem({ goneAt: new Date() })
    expect((await getItem(removed.id)).json().data.state).toBe('removed')

    const { item: gone, event } = await acceptedGoneItem()
    expect((await getItem(gone.id)).json().data).toMatchObject({ state: 'gone', event_id: event.id })

    await db.update(ingestItems).set({ goneResolvedAt: new Date() }).where(eq(ingestItems.id, gone.id))
    expect((await getItem(gone.id)).json().data).toMatchObject({ state: 'accepted', event_id: event.id })
  })

  it('answers 404 for an unknown item or id and for a broken draft', async () => {
    expect((await getItem('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
    expect((await getItem('nope')).statusCode).toBe(404)
    const broken = await newItem({}, { title: 'no dates' } as unknown as ReturnType<typeof draftOf>)
    expect((await getItem(broken.id)).statusCode).toBe(404)
  })
})

/** An accepted item whose event is live while the item left the feed: the Gone view's case. */
async function acceptedGoneItem() {
  const item = await newItem({ goneAt: new Date() })
  const [event] = await db
    .insert(events)
    .values({ title: `Gone detail ${++seq}`, startsAt: new Date('2034-01-01T20:00:00Z'), city: 'Gonetown', createdBy: feedScout.id })
    .returning()
  eventIds.push(event!.id)
  await db.update(ingestItems).set({ status: 'accepted', eventId: event!.id }).where(eq(ingestItems.id, item.id))
  return { item, event: event! }
}

describe('GET /ingest/items and /ingest/count', () => {
  it('lists pending items by draft start with duplicates and counts', async () => {
    const count0 = await app.inject({ method: 'GET', url: '/api/v1/ingest/count', headers: auth(keyScout) })
    const before = count0.json().data as { new: number; filtered: number; gone: number }

    const [dup] = await db
      .insert(events)
      .values({
        title: 'Same Night Party',
        startsAt: new Date('2032-06-01T20:00:00Z'),
        venueId: venue.id,
        city: venue.city,
        createdBy: alice.id,
      })
      .returning()
    eventIds.push(dup!.id)
    const late = await newItem({}, draftOf({ starts_at: '2032-07-01T20:00:00.000Z' }))
    const early = await newItem({}, draftOf({ title: 'Same Night Party', starts_at: '2032-06-01T20:00:00.000Z', venue_id: venue.id }))
    // Offsets must sort by instant, not by text: 2032-06-01T23:00+02:00 is 21:00Z, after the 20:00Z item
    const offset = await newItem({}, draftOf({ starts_at: '2032-06-01T23:00:00.000+02:00' }))
    const hidden = await newItem({ goneAt: new Date() })
    const rejected = await newItem({ status: 'rejected' })
    const misfit = await newItem({ fitVerdict: 'no', fitReason: 'Not our thing' }, draftOf({ starts_at: '2032-08-01T20:00:00.000Z' }))

    const res = await app.inject({ method: 'GET', url: listUrl('view=new'), headers: auth(keyScout) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const mine = body.data.filter((i: { source: { slug: string } }) => i.source.slug === `inbox-${stamp}`)
    const ids = mine.map((i: { id: string }) => i.id)
    expect(ids.filter((id: string) => [early.id, offset.id, late.id].includes(id))).toEqual([early.id, offset.id, late.id])
    expect(ids).not.toContain(hidden.id)
    expect(ids).not.toContain(rejected.id)
    expect(ids).not.toContain(misfit.id)

    const first = mine.find((i: { id: string }) => i.id === early.id)
    expect(first.source).toEqual({ slug: `inbox-${stamp}`, name: sourceName, kind: 'ical' })
    expect(first.status).toBe('pending')
    expect(first.event_id).toBeNull()
    expect(first.draft.title).toBe('Same Night Party')
    expect(first.venue_name).toBe(venue.name)
    expect(mine.find((i: { id: string }) => i.id === late.id).venue_name).toBeNull()
    expect(first.duplicates.map((d: { id: string }) => d.id)).toEqual([dup!.id])
    expect(first.duplicates[0].likely).toBe(true)
    expect(mine.find((i: { id: string }) => i.id === late.id).duplicates).toEqual([])

    // Filtered by source, the counts are that source's; GET /ingest/count counts them all
    expect(body.meta.counts.new).toBe(mine.length)

    const count = await app.inject({ method: 'GET', url: '/api/v1/ingest/count', headers: auth(keyScout) })
    expect(count.json().data.new).toBeGreaterThanOrEqual(before.new + 3)
    // The misfit is counted as filtered (other test files may add more), and not as new: see counts.new above
    expect(count.json().data.filtered).toBeGreaterThanOrEqual(before.filtered + 1)
  })

  it('leaves out pending items that are over, but keeps running ones', async () => {
    const hour = 60 * 60 * 1000
    const day = 24 * hour
    const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
    // Ended yesterday (25 h ago is before the start of today in Berlin)
    const ended = await newItem({}, draftOf({ starts_at: iso(-28 * hour), ends_at: iso(-25 * hour) }))
    const startedYesterday = await newItem({}, draftOf({ starts_at: iso(-25 * hour), ends_at: null }))
    // A running exhibition: started months ago, ends next month
    const running = await newItem({}, draftOf({ starts_at: iso(-90 * day), ends_at: iso(30 * day) }))

    const ids = await listIds('new')
    expect(ids).toContain(running.id)
    expect(ids).not.toContain(ended.id)
    expect(ids).not.toContain(startedYesterday.id)

    // The count uses the same filter as the list
    const res = await app.inject({ method: 'GET', url: listUrl('view=new'), headers: auth(keyScout) })
    expect(res.json().meta.counts.new).toBe(res.json().data.length)

    const accept = await post(`/items/${ended.id}/accept`, keyScout)
    expect(accept.statusCode).toBe(409)
    expect(accept.json().error.code).toBe('conflict')
    expect((await itemRow(ended.id)).status).toBe('pending')
    const ok = await post(`/items/${running.id}/accept`, keyScout)
    expect(ok.statusCode).toBe(200)
    eventIds.push(ok.json().data.event_id)
  })

  it('skips an item whose stored draft is broken instead of failing the list', async () => {
    const valid = await newItem()
    const { title: _title, ...withoutTitle } = draftOf()
    const broken = await newItem({}, withoutTitle as ReturnType<typeof draftOf>)

    try {
      const ids = await listIds('new')
      expect(ids).toContain(valid.id)
      expect(ids).not.toContain(broken.id)
    } finally {
      await db.delete(ingestItems).where(eq(ingestItems.id, broken.id))
    }
  })

  it('pages through a view in start order and filters it by source', async () => {
    const [other] = await db
      .insert(ingestSources)
      .values({ slug: `inbox-b-${stamp}`, name: `${sourceName} B`, kind: 'ical', url: 'https://inbox.test/b.ics', accountId: feedScout.id })
      .returning()
    const page = (query: string) =>
      app.inject({ method: 'GET', url: `/api/v1/ingest/items?source=inbox-b-${stamp}&${query}`, headers: auth(keyScout) })
    try {
      const at = (starts_at: string) => newItem({ sourceId: other!.id }, draftOf({ starts_at }))
      const late = await at('2033-02-01T20:00:00.000Z')
      // Same start: the id decides, so a page boundary between the two loses neither
      const tied = [await at('2033-01-01T20:00:00.000Z'), await at('2033-01-01T20:00:00.000Z')].sort((a, b) =>
        a.id.localeCompare(b.id),
      )
      await newItem({}, draftOf({ starts_at: '2033-01-01T19:00:00.000Z' })) // another source

      const first = await page('limit=2')
      expect(first.statusCode).toBe(200)
      expect(first.json().data.map((i: { id: string }) => i.id)).toEqual(tied.map((i) => i.id))
      expect(first.json().meta).toMatchObject({ has_more: true, counts: { new: 3, filtered: 0, gone: 0 } })

      const second = await page(`limit=2&cursor=${first.json().meta.cursor}`)
      expect(second.json().data.map((i: { id: string }) => i.id)).toEqual([late.id])
      expect(second.json().meta).toMatchObject({ has_more: false, cursor: null })

      // Every source with items in the view, whichever one is listed
      const sources = first.json().meta.sources as { slug: string; name: string; count: number }[]
      expect(sources).toContainEqual({ slug: `inbox-b-${stamp}`, name: `${sourceName} B`, count: 3 })
      expect(sources.map((s) => s.slug)).toContain(`inbox-${stamp}`)

      // An unreadable cursor starts from the top; an unknown source lists nothing
      const garbled = await page('limit=2&cursor=nonsense')
      expect(garbled.json().data.map((i: { id: string }) => i.id)).toEqual(tied.map((i) => i.id))
      const unknown = await app.inject({ method: 'GET', url: `/api/v1/ingest/items?source=nope-${stamp}`, headers: auth(keyScout) })
      expect(unknown.statusCode).toBe(200)
      expect(unknown.json().data).toEqual([])
      expect(unknown.json().meta.counts).toEqual({ new: 0, filtered: 0, gone: 0 })
    } finally {
      await db.delete(ingestSources).where(eq(ingestSources.id, other!.id)) // cascades items
    }
  })

  describe('fit verdicts', () => {
    const items: { fitD2: IngestItem; fitD3: IngestItem; maybeD1: IngestItem; unscoredD2: IngestItem; noD1: IngestItem } = {} as never
    let fitSource: string
    const day = (d: number) => `2034-04-0${d}T20:00:00.000Z`
    const page = (query: string) =>
      app.inject({ method: 'GET', url: `/api/v1/ingest/items?source=${fitSource}&${query}`, headers: auth(keyScout) })
    const idsOf = (res: { json: () => { data: { id: string }[] } }) => res.json().data.map((i) => i.id)

    beforeAll(async () => {
      fitSource = `inbox-fit-${stamp}`
      const [src] = await db
        .insert(ingestSources)
        .values({ slug: fitSource, name: `${sourceName} Fit`, kind: 'ical', url: 'https://inbox.test/fit.ics', accountId: feedScout.id })
        .returning()
      const at = (d: number, verdict?: 'fit' | 'maybe' | 'no') =>
        newItem(
          { sourceId: src!.id, ...(verdict ? { fitVerdict: verdict, fitReason: `Reason ${verdict}` } : {}) },
          draftOf({ starts_at: day(d) }),
        )
      items.maybeD1 = await at(1, 'maybe')
      items.fitD3 = await at(3, 'fit')
      items.unscoredD2 = await at(2)
      items.noD1 = await at(1, 'no')
      items.fitD2 = await at(2, 'fit')
    })

    afterAll(async () => {
      await db.delete(ingestSources).where(eq(ingestSources.slug, fitSource)) // cascades items
    })

    // Soonest first, whatever the verdict; same start: by id
    const newOrder = () => [items.maybeD1.id, ...[items.fitD2.id, items.unscoredD2.id].sort(), items.fitD3.id]

    it('sorts by start date regardless of the verdict and moves misfits to the filtered view', async () => {
      const res = await page('view=new&limit=100')
      expect(idsOf(res)).toEqual(newOrder())
      expect(res.json().meta.counts).toEqual({ new: 4, filtered: 1, gone: 0 })
      const fitView = res.json().data.find((i: { id: string }) => i.id === items.fitD2.id)
      expect(fitView.fit).toEqual({ verdict: 'fit', reason: 'Reason fit' })
      expect(res.json().data.find((i: { id: string }) => i.id === items.unscoredD2.id).fit).toBeNull()

      const filtered = await page('view=filtered&limit=100')
      expect(idsOf(filtered)).toEqual([items.noD1.id])
      expect(filtered.json().data[0].fit).toEqual({ verdict: 'no', reason: 'Reason no' })
      expect(filtered.json().meta.counts).toEqual({ new: 4, filtered: 1, gone: 0 })
      expect(filtered.json().meta.sources).toContainEqual({ slug: fitSource, name: `${sourceName} Fit`, count: 1 })

      // A filtered item's detail page keeps its actions: its state is still new
      const detail = await app.inject({ method: 'GET', url: `/api/v1/ingest/items/${items.noD1.id}`, headers: auth(keyScout) })
      expect(detail.json().data).toMatchObject({ state: 'new', fit: { verdict: 'no', reason: 'Reason no' } })
    })

    it('looks up duplicates for filtered items too', async () => {
      const draft = draftOf({ starts_at: '2034-05-01T20:00:00.000Z', venue_id: venue.id, title: `Filtered dup ${stamp}` })
      const [twin] = await db
        .insert(events)
        .values({ title: draft.title, startsAt: new Date(draft.starts_at), venueId: venue.id, city: venue.city, createdBy: alice.id })
        .returning()
      eventIds.push(twin!.id)
      const [src] = await db.select().from(ingestSources).where(eq(ingestSources.slug, fitSource))
      const item = await newItem({ sourceId: src!.id, fitVerdict: 'no', fitReason: 'Nope' }, draft)
      try {
        const res = await page('view=filtered&limit=100')
        const mine = res.json().data.find((i: { id: string }) => i.id === item.id)
        expect(mine.duplicates.map((d: { id: string }) => d.id)).toContain(twin!.id)
      } finally {
        await db.delete(ingestItems).where(eq(ingestItems.id, item.id))
      }
    })

    it('lists an item with a verdict but no reason with fit: null', async () => {
      const [src] = await db.select().from(ingestSources).where(eq(ingestSources.slug, fitSource))
      const item = await newItem({ sourceId: src!.id, fitVerdict: 'fit', fitReason: null }, draftOf({ starts_at: '2034-05-02T20:00:00.000Z' }))
      try {
        const res = await page('view=new&limit=100')
        const mine = res.json().data.find((i: { id: string }) => i.id === item.id)
        expect(mine.fit).toBeNull()
      } finally {
        await db.delete(ingestItems).where(eq(ingestItems.id, item.id))
      }
    })

    it('pages through the date order, including items with the same start', async () => {
      const order = newOrder()
      const first = await page('view=new&limit=2')
      expect(idsOf(first)).toEqual(order.slice(0, 2))
      expect(first.json().meta.has_more).toBe(true)
      const second = await page(`view=new&limit=2&cursor=${first.json().meta.cursor}`)
      expect(idsOf(second)).toEqual(order.slice(2))
      expect(second.json().meta).toMatchObject({ has_more: false, cursor: null })
    })

    it('a cursor from the old fit order keeps paging by date', async () => {
      const order = newOrder()
      const old = encodeCursor({ rank: 0, starts_at: day(1), id: items.maybeD1.id })
      const res = await page(`view=new&limit=10&cursor=${old}`)
      expect(idsOf(res)).toEqual(order.slice(1))
    })
  })

  it('defaults to the new view and rejects an unknown view', async () => {
    const def = await app.inject({ method: 'GET', url: '/api/v1/ingest/items', headers: auth(keyScout) })
    expect(def.statusCode).toBe(200)
    const bad = await app.inject({ method: 'GET', url: '/api/v1/ingest/items?view=all', headers: auth(keyScout) })
    expect(bad.statusCode).toBe(400)
  })
})

describe('GET /ingest/accuracy', () => {
  it('reports per-source accuracy over the last 60 days', async () => {
    const slug = `inbox-acc-${stamp}`
    const [src] = await db
      .insert(ingestSources)
      .values({ slug, name: `${sourceName} Accuracy`, kind: 'ical', url: 'https://inbox.test/acc.ics', accountId: feedScout.id })
      .returning()
    try {
      const now = Date.now()
      const decided = (over: Partial<typeof ingestItems.$inferInsert>) =>
        newItem({ sourceId: src!.id, decidedAt: new Date(now - 24 * 3600_000), ...over })
      await decided({ status: 'accepted', fitVerdict: 'fit' })
      await decided({ status: 'rejected', fitVerdict: 'fit' })
      await decided({ status: 'rejected', fitVerdict: 'fit', hadDuplicates: true }) // a duplicate reject says nothing about fit
      await decided({ status: 'rejected', fitVerdict: 'no' })
      await decided({ status: 'accepted', fitVerdict: 'no' })
      await decided({ status: 'accepted', fitVerdict: 'maybe' })
      await decided({ status: 'accepted', fitVerdict: 'fit', decidedAt: new Date(now - 61 * 24 * 3600_000) })
      await decided({ status: 'accepted' })
      await newItem({ sourceId: src!.id, fitVerdict: 'fit' }) // still pending

      const res = await app.inject({ method: 'GET', url: '/api/v1/ingest/accuracy', headers: auth(keyScout) })
      expect(res.statusCode).toBe(200)
      const rows: { slug: string; name: string }[] = res.json().data
      expect(rows.find((r) => r.slug === slug)).toEqual({
        slug,
        name: `${sourceName} Accuracy`,
        fit_decided: 2,
        fit_accepted: 1,
        no_decided: 2,
        no_rejected: 1,
        rescued: 1,
      })

      const names = rows.map((r) => r.name)
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')))

      const alicesTry = await app.inject({ method: 'GET', url: '/api/v1/ingest/accuracy', headers: auth(keyAlice) })
      expect(alicesTry.statusCode).toBe(403)
    } finally {
      await db.delete(ingestSources).where(eq(ingestSources.id, src!.id)) // cascades items
    }
  })
})

describe('public visibility', () => {
  it('never lists a pending inbox item on GET /api/v1/events, only an accepted one', async () => {
    const startsAt = '2031-05-01T20:00:00.000Z'
    const pending = await newItem({}, draftOf({ title: `Unaccepted ${stamp}`, starts_at: startsAt }))
    const accepted = await newItem({}, draftOf({ title: `Accepted ${stamp}`, starts_at: startsAt }))
    const ok = await post(`/items/${accepted.id}/accept`, keyScout)
    expect(ok.statusCode).toBe(200)
    eventIds.push(ok.json().data.event_id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/events?from=2031-05-01T19:00:00Z&to=2031-05-01T21:00:00Z&limit=100',
    })
    expect(res.statusCode).toBe(200)
    const titles = res.json().data.map((e: { title: string }) => e.title)
    expect(titles).toContain(`Accepted ${stamp}`)
    expect(titles).not.toContain(`Unaccepted ${stamp}`)
    expect((await itemRow(pending.id)).status).toBe('pending')
  })
})

describe('POST /ingest/items/:id/accept', () => {
  afterEach(() => {
    imageStore.reset()
    ingestImages.reset()
  })

  it('copies the feed image into the store', async () => {
    const store = memoryImageStore()
    imageStore.setStore(store)
    const fetched: string[] = []
    ingestImages.setFetch((async (url: URL) => {
      fetched.push(String(url))
      return new Response(PNG)
    }) as unknown as typeof fetch)
    const item = await newItem({}, draftOf({ image_url: 'https://feed.test/flyer.png' }))
    const res = await post(`/items/${item.id}/accept`, keyScout)
    expect(res.statusCode).toBe(200)
    const eventId = res.json().data.event_id as string
    eventIds.push(eventId)
    expect(fetched).toEqual(['https://feed.test/flyer.png'])
    const event = (await app.inject({ method: 'GET', url: `/api/v1/events/${eventId}` })).json().data
    expect(event.image_url).toMatch(new RegExp(`^https://images\\.test/events/${eventId}/[0-9a-f-]{36}\\.png$`))
    expect([...store.objects.values()].map((o) => o.data)).toEqual([PNG])
    expect((await itemRow(item.id)).imageSourceUrl).toBe('https://feed.test/flyer.png')
  })

  it('gives the event the categories of the draft, none for a draft stored before categories', async () => {
    const item = await newItem({}, draftOf({ categories: ['concert', 'party'] }))
    const res = await post(`/items/${item.id}/accept`, keyScout)
    expect(res.statusCode).toBe(200)
    const eventId = res.json().data.event_id as string
    eventIds.push(eventId)
    const event = (await app.inject({ method: 'GET', url: `/api/v1/events/${eventId}` })).json().data
    expect(event.categories).toEqual(['concert', 'party'])

    const old = await newItem()
    const view = await app.inject({ method: 'GET', url: `/api/v1/ingest/items/${old.id}`, headers: auth(keyScout) })
    expect(view.json().data.draft.categories).toEqual([])
    const oldRes = await post(`/items/${old.id}/accept`, keyScout)
    eventIds.push(oldRes.json().data.event_id as string)
    const oldEvent = (await app.inject({ method: 'GET', url: `/api/v1/events/${oldRes.json().data.event_id}` })).json().data
    expect(oldEvent.categories).toEqual([])
  })

  it('gives the event the lineup of the draft', async () => {
    const lineup = [{ name: 'Säule', acts: [{ name: 'Timnah', time: '23:59', live: false, note: null }] }]
    const item = await newItem({}, draftOf({ lineup }))
    const res = await post(`/items/${item.id}/accept`, keyScout)
    expect(res.statusCode).toBe(200)
    const eventId = res.json().data.event_id as string
    eventIds.push(eventId)
    expect((await eventRow(eventId)).lineup).toEqual(lineup)
  })

  it('accepts without an image when the feed image cannot be fetched', async () => {
    imageStore.setStore(memoryImageStore())
    ingestImages.setFetch((async () => new Response('gone', { status: 404 })) as unknown as typeof fetch)
    const item = await newItem({}, draftOf({ image_url: 'https://feed.test/missing.png' }))
    const res = await post(`/items/${item.id}/accept`, keyScout)
    expect(res.statusCode).toBe(200)
    eventIds.push(res.json().data.event_id)
    const event = (await app.inject({ method: 'GET', url: `/api/v1/events/${res.json().data.event_id}` })).json().data
    expect(event.image_url).toBeNull()
    expect((await itemRow(item.id)).imageSourceUrl).toBeNull()
  })

  it('publishes the draft as an unclaimed scout event', async () => {
    const item = await newItem({}, draftOf({ venue_id: venue.id, ends_at: '2031-03-01T23:00:00.000Z', location_text: 'Back room' }))
    const draft = item.draft as ReturnType<typeof draftOf>
    const res = await post(`/items/${item.id}/accept`, keyScout)
    expect(res.statusCode).toBe(200)
    const eventId = res.json().data.event_id as string
    eventIds.push(eventId)

    const detail = await app.inject({ method: 'GET', url: `/api/v1/events/${eventId}` })
    const event = detail.json().data
    expect(event.title).toBe(draft.title)
    expect(event.description).toBe('Verbatim feed description')
    expect(event.starts_at).toBe(draft.starts_at)
    expect(event.ends_at).toBe('2031-03-01T23:00:00.000Z')
    expect(event.city).toBe('Venuetown')
    expect(event.venue.id).toBe(venue.id)
    expect(event.location_text).toBe('Back room')
    expect(event.links).toEqual({ website: 'https://feed.test/e' })
    expect(event.tags).toEqual([])
    expect(event.claimed).toBe(false)
    expect(event.organizers).toEqual([])
    expect(event.added_by.id).toBe(feedScout.id)
    expect(event.synced_from).toEqual({ source_name: sourceName, source_url: 'https://feed.test/e' })

    const stored = await itemRow(item.id)
    expect(stored.status).toBe('accepted')
    expect(stored.eventId).toBe(eventId)
    expect(stored.decidedBy).toBe(scout.id)
    expect(stored.decidedAt).not.toBeNull()
    expect(stored.detachedAt).toBeNull()

    const rows = await db.select().from(eventOrganizers).where(eq(eventOrganizers.eventId, eventId))
    expect(rows).toEqual([])
    const [log] = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    expect(log?.action).toBe('created')
  })

  it('accepting a feed item always creates an unclaimed event, even when the scout is an organizer member', async () => {
    const { account, key } = await createAccount({ scout: true }) // also owns a verified organizer
    const item = await newItem()
    const res = await post(`/items/${item.id}/accept`, key)
    expect(res.statusCode).toBe(200)
    const eventId = res.json().data.event_id as string
    eventIds.push(eventId)

    const acceptedEvent = (await app.inject({ method: 'GET', url: `/api/v1/events/${eventId}` })).json().data
    expect(acceptedEvent).toMatchObject({ claimed: false, organizers: [] })
    expect(await db.select().from(eventOrganizers).where(eq(eventOrganizers.eventId, eventId))).toEqual([])
    // Attributed as before: to the source's scout, with the accepting scout as the actor of the log
    expect((await eventRow(eventId)).createdBy).toBe(feedScout.id)
    const [log] = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    expect(log?.accountId).toBe(account.id)
  })

  it('uses the draft city without a venue', async () => {
    const item = await newItem()
    const res = await post(`/items/${item.id}/accept`, keyScout)
    const event = await eventRow(res.json().data.event_id)
    eventIds.push(event.id)
    expect(event.city).toBe('Feedcity')
    expect(event.venueId).toBeNull()
    expect(event.locationText).toBe('Feed Hall')
  })

  it('answers 409 when the item is not pending and 404 for an unknown id', async () => {
    const item = await newItem()
    const first = await post(`/items/${item.id}/accept`, keyScout)
    expect(first.statusCode).toBe(200)
    eventIds.push(first.json().data.event_id)
    const second = await post(`/items/${item.id}/accept`, keyScout)
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('conflict')

    const rejected = await newItem({ status: 'rejected' })
    expect((await post(`/items/${rejected.id}/accept`, keyScout)).statusCode).toBe(409)

    const missing = await post('/items/00000000-0000-4000-8000-000000000000/accept', keyScout)
    expect(missing.statusCode).toBe(404)
  })

  it('creates one event when two scouts accept at once', async () => {
    const item = await newItem()
    const results = await Promise.all([post(`/items/${item.id}/accept`, keyScout), post(`/items/${item.id}/accept`, keyScout)])
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409])
    const ok = results.find((r) => r.statusCode === 200)!
    eventIds.push(ok.json().data.event_id)
    const created = await db.select().from(events).where(eq(events.title, (item.draft as { title: string }).title))
    expect(created).toHaveLength(1)
  })

  it('falls back to the location text when the draft venue was deleted', async () => {
    const [gone] = await db.insert(venues).values({ name: `Gone Venue ${stamp}`, address: 'x', city: 'Goneville' }).returning()
    const item = await newItem({}, draftOf({ venue_id: gone!.id, location_text: null }))
    await db.delete(venues).where(eq(venues.id, gone!.id))

    const res = await post(`/items/${item.id}/accept`, keyScout)
    expect(res.statusCode).toBe(200)
    const event = await eventRow(res.json().data.event_id)
    eventIds.push(event.id)
    expect(event.venueId).toBeNull()
    expect(event.locationText).toBe(sourceName)
    expect(event.city).toBe('Feedcity')

    const kept = await newItem({}, draftOf({ venue_id: gone!.id, location_text: 'Draft place' }))
    const res2 = await post(`/items/${kept.id}/accept`, keyScout)
    const event2 = await eventRow(res2.json().data.event_id)
    eventIds.push(event2.id)
    expect(event2.locationText).toBe('Draft place')
  })
})

describe('POST /ingest/items/reject', () => {
  it('rejects pending items only and removes them from the new view', async () => {
    const a = await newItem()
    const b = await newItem()
    const accepted = await newItem({ status: 'accepted' })
    expect(await listIds('new')).toEqual(expect.arrayContaining([a.id, b.id]))

    const res = await post('/items/reject', keyScout, { ids: [a.id, b.id, accepted.id] })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ rejected: 2 })
    expect((await itemRow(a.id)).status).toBe('rejected')
    expect((await itemRow(b.id)).status).toBe('rejected')
    expect((await itemRow(a.id)).decidedBy).toBe(scout.id)
    expect((await itemRow(accepted.id)).status).toBe('accepted')
    const ids = await listIds('new')
    expect(ids).not.toContain(a.id)
    expect(ids).not.toContain(b.id)
  })

  it('marks items that had duplicate candidates', async () => {
    const dupDraft = draftOf({ venue_id: venue.id, starts_at: '2031-06-01T20:00:00.000Z', title: `Reject dup ${stamp}` })
    const [twin] = await db
      .insert(events)
      .values({ title: dupDraft.title, startsAt: new Date(dupDraft.starts_at), venueId: venue.id, city: venue.city, createdBy: alice.id })
      .returning()
    eventIds.push(twin!.id)
    const withTwin = await newItem({}, dupDraft)
    const alone = await newItem({}, draftOf({ starts_at: '2031-06-02T20:00:00.000Z', title: `Reject alone ${stamp}` }))

    const res = await post('/items/reject', keyScout, { ids: [withTwin.id, alone.id] })
    expect(res.json().data).toEqual({ rejected: 2 })
    expect((await itemRow(withTwin.id)).hadDuplicates).toBe(true)
    expect((await itemRow(alone.id)).hadDuplicates).toBe(false)
  })

  it('still rejects an item with a broken draft', async () => {
    const { title: _title, ...broken } = draftOf()
    const item = await newItem({}, broken)
    const res = await post('/items/reject', keyScout, { ids: [item.id] })
    expect(res.json().data).toEqual({ rejected: 1 })
    const row = await itemRow(item.id)
    expect(row.status).toBe('rejected')
    expect(row.hadDuplicates).toBe(false)
  })

  it('validates the body', async () => {
    expect((await post('/items/reject', keyScout, { ids: [] })).statusCode).toBe(400)
    expect((await post('/items/reject', keyScout, { ids: ['nope'] })).statusCode).toBe(400)
  })
})

describe('POST /ingest/items/:id/link', () => {
  it('links a pending item to an existing event and detaches it', async () => {
    const [target] = await db
      .insert(events)
      .values({ title: 'Existing event', startsAt: new Date('2033-01-01T20:00:00Z'), city: 'Linktown', createdBy: alice.id })
      .returning()
    eventIds.push(target!.id)
    const item = await newItem()

    const res = await post(`/items/${item.id}/link`, keyScout, { event_id: target!.id })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ event_id: target!.id })
    const stored = await itemRow(item.id)
    expect(stored.status).toBe('accepted')
    expect(stored.eventId).toBe(target!.id)
    expect(stored.detachedAt).not.toBeNull()
    expect(stored.decidedBy).toBe(scout.id)
    expect(await listIds('new')).not.toContain(item.id)

    const after = await eventRow(target!.id)
    expect(after.title).toBe('Existing event')
    expect(after.updatedAt).toEqual(target!.updatedAt)
    const detail = await app.inject({ method: 'GET', url: `/api/v1/events/${target!.id}` })
    expect(detail.json().data.synced_from).toBeNull()
  })

  it('detaches the item the event was synced from, so it never shows up as gone', async () => {
    // Event E came from item A; the source re-posts it under a new id (item B), which a scout links to E
    const a = await newItem()
    const accepted = await post(`/items/${a.id}/accept`, keyScout)
    const eventId = accepted.json().data.event_id as string
    eventIds.push(eventId)
    const b = await newItem()

    const res = await post(`/items/${b.id}/link`, keyScout, { event_id: eventId })
    expect(res.statusCode).toBe(200)
    expect((await itemRow(a.id)).detachedAt).not.toBeNull()

    // The next run misses A
    await db.update(ingestItems).set({ goneAt: new Date() }).where(eq(ingestItems.id, a.id))
    expect(await listIds('gone')).not.toContain(a.id)
    expect((await post(`/items/${a.id}/gone`, keyScout, { action: 'cancel' })).statusCode).toBe(409)
    expect((await eventRow(eventId)).status).toBe('scheduled')
  })

  describe('taking fields from the feed (a concert entered by hand, then listed by Urban Spree)', () => {
    const SPREE = 'https://www.urbanspree.com/program/concerts/linear-movement-der-k%C3%BCnftige-musikant-twilight-ritual.html'
    const OWN_TICKETS = 'https://tickets.example.org/night'

    afterEach(() => {
      imageStore.reset()
      ingestImages.reset()
    })

    /** The draft the Urban Spree run stored for the event, read from the saved detail page. */
    function spreeDraft() {
      const card: UrbanSpreeCard = {
        kind: 'concert',
        externalId: 'concerts/linear-movement-der-künftige-musikant-twilight-ritual',
        url: SPREE,
        title: 'LINEAR MOVEMENT + DER KÜNFTIGE MUSIKANT +…',
        day: { year: 2027, month: 1, day: 9 },
        time: '20:00',
        endDay: null,
        imageUrl: 'https://www.urbanspree.com/assets/project/urbanspree/mediasource/IMG_3093.JPG',
        raw: '',
      }
      const html = readFileSync(fileURLToPath(new URL('../ingest/fixtures/urbanspree/linear-movement.html', import.meta.url)), 'utf8')
      const ev = parseUrbanSpreeDetail(html, card, { today: { year: 2026, month: 10, day: 29 }, cards: [card] })
      const config = ingestSourceConfigSchema.parse({ venues: { 'Urban Spree': venue.id }, default_categories: ['concert'] })
      return normalizeFeedEvent(ev!, config, null)
    }

    /** The event as a scout entered it by hand the day before the feed listed it. */
    async function ownEvent(over: Partial<typeof events.$inferInsert> = {}) {
      const [event] = await db
        .insert(events)
        .values({
          title: 'Hand-entered night',
          description: 'Live acts and DJs.',
          startsAt: new Date('2027-01-09T19:00:00Z'),
          venueId: venue.id,
          city: 'Berlin',
          tags: ['minimal', 'synth'],
          links: { tickets: OWN_TICKETS },
          createdBy: scout.id,
          ...over,
        })
        .returning()
      eventIds.push(event!.id)
      return event!
    }

    function stubImages() {
      const store = memoryImageStore()
      imageStore.setStore(store)
      ingestImages.setFetch((async () => new Response(PNG)) as unknown as typeof fetch)
      return store
    }

    it('takes the chosen fields and links, keeps the rest, and stays detached', async () => {
      const store = stubImages()
      const draft = spreeDraft()
      expect(draft.title).toBe('LINEAR MOVEMENT + DER KÜNFTIGE MUSIKANT + TWILIGHT RITUAL')
      expect(draft.description).toContain('Linear Movement (live)')
      const event = await ownEvent()
      const item = await newItem({}, draft)

      const res = await post(`/items/${item.id}/link`, keyScout, {
        event_id: event.id,
        fields: ['description', 'categories', 'image'],
        links: ['facebook', 'gone-key'],
      })
      expect(res.statusCode).toBe(200)

      const after = await eventRow(event.id)
      expect(after.title).toBe('Hand-entered night')
      expect(after.description).toBe(draft.description)
      expect(after.categories).toEqual(draft.categories)
      expect(after.tags).toEqual(['minimal', 'synth'])
      expect(after.startsAt).toEqual(event.startsAt)
      expect(after.links).toEqual({ tickets: OWN_TICKETS, facebook: 'https://www.facebook.com/events/2698407777240408' })
      expect(after.imageKey).toMatch(new RegExp(`^events/${event.id}/`))
      expect([...store.objects.values()].map((o) => o.data)).toEqual([PNG])

      const stored = await itemRow(item.id)
      expect(stored.status).toBe('accepted')
      expect(stored.detachedAt).not.toBeNull()

      const history = await db.select().from(editHistory).where(eq(editHistory.entityId, event.id))
      const merge = history.find((h) => (h.diff as { via?: string }).via === 'ingest-link')
      expect(merge?.accountId).toBe(scout.id)
      expect(Object.keys(merge!.diff as object).sort()).toEqual(['categories', 'description', 'links', 'via'])
    })

    it('takes the lineup when it is chosen, and only then', async () => {
      const lineup = [{ name: null, acts: [{ name: 'Linear Movement', time: null, live: true, note: null }] }]
      const event = await ownEvent()
      const skipped = await newItem({}, { ...spreeDraft(), lineup })
      await post(`/items/${skipped.id}/link`, keyScout, { event_id: event.id, fields: ['title'] })
      expect((await eventRow(event.id)).lineup).toEqual([])

      const other = await ownEvent()
      const taken = await newItem({}, { ...spreeDraft(), lineup })
      const res = await post(`/items/${taken.id}/link`, keyScout, { event_id: other.id, fields: ['lineup'] })
      expect(res.statusCode).toBe(200)
      expect((await eventRow(other.id)).lineup).toEqual(lineup)
    })

    it('replaces a link the event already has when its key is chosen', async () => {
      const event = await ownEvent()
      const item = await newItem({}, spreeDraft())
      expect((await post(`/items/${item.id}/link`, keyScout, { event_id: event.id, links: ['tickets'] })).statusCode).toBe(200)
      expect((await eventRow(event.id)).links).toEqual({
        tickets: 'https://shotgun.live/en/events/linear-movement-der-kunftige-musikant-twilight-ritual',
      })
    })

    it('hands the event to the feed when synced: every synced field, the image, and the item stays attached', async () => {
      stubImages()
      const draft = spreeDraft()
      const event = await ownEvent({ startsAt: new Date('2027-01-09T18:00:00Z') })
      const item = await newItem({}, draft)

      const res = await post(`/items/${item.id}/link`, keyScout, { event_id: event.id, fields: ['title'], sync: true })
      expect(res.statusCode).toBe(200)

      const after = await eventRow(event.id)
      expect(after.title).toBe(draft.title)
      expect(after.description).toBe(draft.description)
      expect(after.startsAt).toEqual(new Date(draft.starts_at))
      expect(after.tags).toEqual(['minimal', 'synth'])
      expect(after.links).toEqual({ tickets: OWN_TICKETS, website: SPREE })
      expect(after.imageKey).not.toBeNull()

      const stored = await itemRow(item.id)
      expect(stored.detachedAt).toBeNull()
      expect(stored.imageSourceUrl).toBe(draft.image_url)
      const detail = await app.inject({ method: 'GET', url: `/api/v1/events/${event.id}` })
      expect(detail.json().data.synced_from).not.toBeNull()
    })

    it('leaves an event with organizers to them: no fields, but a plain link still works', async () => {
      const event = await ownEvent({ createdBy: alice.id })
      await db.insert(eventOrganizers).values({ eventId: event.id, organizerId: aliceOrganizer.id, role: 'creator' })
      const item = await newItem({}, spreeDraft())

      const merge = await post(`/items/${item.id}/link`, keyScout, { event_id: event.id, fields: ['description'] })
      expect(merge.statusCode).toBe(403)
      expect((await itemRow(item.id)).status).toBe('pending')
      expect((await eventRow(event.id)).description).toBe(event.description)

      expect((await post(`/items/${item.id}/link`, keyScout, { event_id: event.id })).statusCode).toBe(200)
      await db.delete(eventOrganizers).where(eq(eventOrganizers.eventId, event.id))
    })
  })

  it('404s for an unknown event and 409s for a decided item', async () => {
    const item = await newItem()
    const missing = await post(`/items/${item.id}/link`, keyScout, { event_id: '00000000-0000-4000-8000-000000000000' })
    expect(missing.statusCode).toBe(404)
    expect((await itemRow(item.id)).status).toBe('pending')

    const [target] = await db
      .insert(events)
      .values({ title: 'Link target', startsAt: new Date('2033-01-02T20:00:00Z'), city: 'Linktown', createdBy: alice.id })
      .returning()
    eventIds.push(target!.id)
    const rejected = await newItem({ status: 'rejected' })
    expect((await post(`/items/${rejected.id}/link`, keyScout, { event_id: target!.id })).statusCode).toBe(409)
  })
})

describe('gone items', () => {
  async function acceptedGone() {
    const item = await newItem({ goneAt: new Date() })
    const [event] = await db
      .insert(events)
      .values({ title: `Gone event ${++seq}`, startsAt: new Date('2034-01-01T20:00:00Z'), city: 'Gonetown', createdBy: feedScout.id })
      .returning()
    eventIds.push(event!.id)
    await db.update(ingestItems).set({ status: 'accepted', eventId: event!.id }).where(eq(ingestItems.id, item.id))
    return { item, event: event! }
  }

  it('lists accepted items that left the feed until they are resolved', async () => {
    const { item } = await acceptedGone()
    const pendingGone = await newItem({ goneAt: new Date() })
    const resolved = await newItem({ status: 'accepted', goneAt: new Date(), goneResolvedAt: new Date() })
    const ids = await listIds('gone')
    expect(ids).toContain(item.id)
    expect(ids).not.toContain(pendingGone.id)
    expect(ids).not.toContain(resolved.id)

    const res = await app.inject({ method: 'GET', url: listUrl('view=gone'), headers: auth(keyScout) })
    const row = res.json().data.find((i: { id: string }) => i.id === item.id)
    expect(row.status).toBe('accepted')
    expect(row.gone_at).not.toBeNull()
    expect(row.event_id).not.toBeNull()
    expect(row.duplicates).toEqual([])
    expect(res.json().meta.counts.gone).toBeGreaterThanOrEqual(1)
  })

  it('keep marks the item resolved and drops it from the list', async () => {
    const { item, event } = await acceptedGone()
    const res = await post(`/items/${item.id}/gone`, keyScout, { action: 'keep' })
    expect(res.statusCode).toBe(200)
    expect((await itemRow(item.id)).goneResolvedAt).not.toBeNull()
    expect((await eventRow(event.id)).status).toBe('scheduled')
    expect(await listIds('gone')).not.toContain(item.id)
  })

  it('cancel cancels the event, logs it and detaches the item', async () => {
    const { item, event } = await acceptedGone()
    const res = await post(`/items/${item.id}/gone`, keyScout, { action: 'cancel' })
    expect(res.statusCode).toBe(200)
    expect((await eventRow(event.id)).status).toBe('cancelled')
    expect((await itemRow(item.id)).detachedAt).not.toBeNull()
    const log = await db.select().from(editHistory).where(eq(editHistory.entityId, event.id))
    expect(log.map((l) => l.action)).toContain('cancelled')
    expect(log.find((l) => l.action === 'cancelled')?.accountId).toBe(scout.id)
    expect(await listIds('gone')).not.toContain(item.id)
  })

  it('hides items whose event was cancelled elsewhere', async () => {
    const { item, event } = await acceptedGone()
    await db.update(events).set({ status: 'cancelled' }).where(eq(events.id, event.id))
    expect(await listIds('gone')).not.toContain(item.id)
  })

  it('does not list or act on detached items, so scouts cannot cancel a human-owned event', async () => {
    const [owned] = await db
      .insert(events)
      .values({ title: `Owned event ${++seq}`, startsAt: new Date('2034-02-01T20:00:00Z'), city: 'Gonetown', createdBy: alice.id })
      .returning()
    eventIds.push(owned!.id)
    const edited = await newItem({ status: 'accepted', eventId: owned!.id, goneAt: new Date(), detachedAt: new Date() })
    // A pending item linked to alice's event is detached at link time; the feed then drops it
    const pending = await newItem()
    expect((await post(`/items/${pending.id}/link`, keyScout, { event_id: owned!.id })).statusCode).toBe(200)
    await db.update(ingestItems).set({ goneAt: new Date() }).where(eq(ingestItems.id, pending.id))

    const ids = await listIds('gone')
    expect(ids).not.toContain(edited.id)
    expect(ids).not.toContain(pending.id)

    for (const item of [edited, pending]) {
      for (const action of ['cancel', 'keep']) {
        const res = await post(`/items/${item.id}/gone`, keyScout, { action })
        expect(res.statusCode, `${action} on ${item.id}`).toBe(409)
        expect(res.json().error.code).toBe('conflict')
      }
      expect((await itemRow(item.id)).goneResolvedAt).toBeNull()
    }
    expect((await eventRow(owned!.id)).status).toBe('scheduled')
  })

  it('409s for an item that is not gone and 400s for a bad action', async () => {
    const pending = await newItem()
    expect((await post(`/items/${pending.id}/gone`, keyScout, { action: 'keep' })).statusCode).toBe(409)
    expect((await post(`/items/${pending.id}/gone`, keyScout, { action: 'burn' })).statusCode).toBe(400)
    expect((await post('/items/00000000-0000-4000-8000-000000000000/gone', keyScout, { action: 'keep' })).statusCode).toBe(404)
  })
})

describe('synced_from on event detail', () => {
  it('is set while synced and null after a human edit', async () => {
    const item = await newItem()
    const accepted = await post(`/items/${item.id}/accept`, keyScout)
    const eventId = accepted.json().data.event_id as string
    eventIds.push(eventId)

    const before = await app.inject({ method: 'GET', url: `/api/v1/events/${eventId}` })
    expect(before.json().data.synced_from).toEqual({ source_name: sourceName, source_url: 'https://feed.test/e' })

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyScout),
      payload: { title: 'Edited by hand' },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json().data.synced_from).toBeNull()
    const after = await app.inject({ method: 'GET', url: `/api/v1/events/${eventId}` })
    expect(after.json().data.synced_from).toBeNull()
  })
})

describe('provenance', () => {
  const city = `Provtown-${stamp}`
  const scoutEvent = async () => {
    const [e] = await db
      .insert(events)
      .values({ title: `Scout tip ${stamp}-${++seq}`, startsAt: new Date('2033-02-01T20:00:00Z'), city, createdBy: scout.id })
      .returning()
    eventIds.push(e!.id)
    return e!
  }
  const detailOf = async (id: string) => (await app.inject({ method: 'GET', url: `/api/v1/events/${id}` })).json().data
  const listed = async (provenance: string) => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/events?city=${city}&provenance=${provenance}` })
    expect(res.statusCode).toBe(200)
    return res.json().data.map((e: { id: string; provenance: string }) => e.id)
  }

  it('a scout event becomes venue_site once the venue lists it, and falls back when it is gone', async () => {
    const e = await scoutEvent()
    expect((await detailOf(e.id)).provenance).toBe('scout')
    expect(await listed('scout')).toContain(e.id)

    // The venue's site lists it later; a plain link (no sync) is enough
    const item = await newItem()
    expect((await post(`/items/${item.id}/link`, keyScout, { event_id: e.id })).statusCode).toBe(200)
    const detail = await detailOf(e.id)
    expect(detail.provenance).toBe('venue_site')
    expect(detail.venue_listing).toEqual(
      expect.objectContaining({ source_name: sourceName, source_url: 'https://feed.test/e' }),
    )
    expect(await listed('venue_site')).toContain(e.id)
    expect(await listed('scout')).not.toContain(e.id)

    await db.update(ingestItems).set({ goneAt: new Date() }).where(eq(ingestItems.id, item.id))
    const gone = await detailOf(e.id)
    expect(gone.provenance).toBe('scout')
    expect(gone.venue_listing).toBeNull()
  })

  it('an unofficial source does not vouch for an event', async () => {
    const [src] = await db
      .insert(ingestSources)
      .values({ slug: `prov-agg-${stamp}`, name: 'Aggregator', kind: 'ical', url: 'https://agg.test/feed.ics', accountId: feedScout.id, official: false })
      .returning()
    try {
      const e = await scoutEvent()
      await newItem({ sourceId: src!.id, status: 'accepted', eventId: e.id })
      const detail = await detailOf(e.id)
      expect(detail.provenance).toBe('scout')
      expect(detail.venue_listing).toBeNull()
    } finally {
      await db.delete(ingestSources).where(eq(ingestSources.id, src!.id))
    }
  })

  it('an organizer claim outranks the venue listing', async () => {
    const e = await scoutEvent()
    await newItem({ status: 'accepted', eventId: e.id })
    await db.insert(eventOrganizers).values({ eventId: e.id, organizerId: aliceOrganizer.id, role: 'creator' })
    const detail = await detailOf(e.id)
    expect(detail.provenance).toBe('organizer')
    expect(detail.venue_listing).not.toBeNull()
    expect(await listed('organizer')).toContain(e.id)
  })
})

describe('suggestions in the inbox', () => {
  const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000'
  let suggestionsSource: string
  let submitter: Account
  let firstTimer: Account
  const mails: { to: string; title: string; startsAt: string; url: string }[] = []
  let failMail = false
  let attempts = 0
  let reviewer: Account
  let keyReviewer: string

  beforeAll(async () => {
    suggestionsSource = await ensureSuggestionsSource(db)
    submitter = (await createAccount({ label: 'inbox-submitter', organizer: false })).account
    firstTimer = (await createAccount({ label: 'inbox-first', organizer: false })).account
    // A scout of its own: the write rate limit counts per account
    const r = await createAccount({ scout: true, organizer: false, label: 'inbox-reviewer' })
    reviewer = r.account
    keyReviewer = r.key
  })

  beforeEach(() => {
    mails.length = 0
    failMail = false
    attempts = 0
    const live: EmailTransport['sendEventLive'] = async (msg) => {
      attempts++
      if (failMail) throw new Error('mail provider down')
      mails.push(msg)
    }
    email.setTransport({ sendMagicLink: async () => {}, sendEmailChangedNotice: async () => {}, sendEventLive: live })
  })

  afterEach(() => {
    email.reset()
    imageStore.reset()
    ingestImages.reset()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await db.delete(ingestItems).where(inArray(ingestItems.submittedBy, [submitter.id, firstTimer.id]))
  })

  const suggestion = (by: Account, over: Partial<typeof ingestItems.$inferInsert> = {}, draft: Record<string, unknown> = {}) =>
    newItem(
      { sourceId: suggestionsSource, externalId: randomUUID(), submittedBy: by.id, ...over },
      draftOf({ links: {}, source_url: null, ...draft }),
    )

  const detail = (id: string) => app.inject({ method: 'GET', url: `/api/v1/ingest/items/${id}`, headers: auth(keyReviewer) })

  /** Every item of a view of the suggestions source, all pages, and the view's counts. */
  async function suggestionsIn(view: 'new' | 'filtered' | 'gone') {
    const items: { id: string; source: { kind: string }; submitter: unknown; fit: unknown }[] = []
    let cursor: string | null = null
    let counts: { new: number; filtered: number; gone: number } = { new: 0, filtered: 0, gone: 0 }
    do {
      const url: string = `/api/v1/ingest/items?view=${view}&source=suggestions&limit=100${cursor ? `&cursor=${cursor}` : ''}`
      const res = await app.inject({ method: 'GET', url, headers: auth(keyReviewer) })
      expect(res.statusCode).toBe(200)
      const body: { data: typeof items; meta: { cursor: string | null; counts: typeof counts } } = res.json()
      items.push(...body.data)
      counts = body.meta.counts
      cursor = body.meta.cursor
    } while (cursor)
    return { items, counts }
  }

  const waitForMails = (n: number) => vi.waitFor(() => expect(mails).toHaveLength(n), { timeout: 2000 })
  const settle = () => new Promise((r) => setTimeout(r, 100))

  it('lists a suggestion with its submitter and record', async () => {
    await suggestion(submitter, { status: 'accepted' })
    await suggestion(submitter, { status: 'accepted', detachedAt: new Date() }) // merged
    await suggestion(submitter, { status: 'rejected' })
    await suggestion(submitter, { status: 'withdrawn' })
    const open = await suggestion(submitter)
    const first = await suggestion(firstTimer)
    const feed = await newItem()

    const { items } = await suggestionsIn('new')
    const listed = items.find((i) => i.id === open.id)
    expect(listed?.source.kind).toBe('suggestion')
    expect(listed?.submitter).toEqual({ display_name: submitter.displayName, handle: submitter.handle, accepted: 2, decided: 3 })
    expect(items.find((i) => i.id === first.id)?.submitter).toEqual({
      display_name: firstTimer.displayName,
      handle: firstTimer.handle,
      accepted: 0,
      decided: 0,
    })

    const one = (await detail(open.id)).json().data
    expect(one.source.kind).toBe('suggestion')
    expect(one.submitter).toMatchObject({ accepted: 2, decided: 3 })
    const feedView = (await detail(feed.id)).json().data
    expect(feedView.source.kind).toBe('ical')
    expect(feedView.submitter).toBeNull()
  })

  it('a misfit suggestion stays in New', async () => {
    const before = (await suggestionsIn('new')).counts
    const misfit = await suggestion(submitter, { fitVerdict: 'no', fitReason: 'Not a club night' })
    const { items, counts } = await suggestionsIn('new')
    expect(items.find((i) => i.id === misfit.id)?.fit).toEqual({ verdict: 'no', reason: 'Not a club night' })
    expect(counts.new).toBe(before.new + 1)
    expect(counts.filtered).toBe(before.filtered)
    expect((await suggestionsIn('filtered')).items.map((i) => i.id)).not.toContain(misfit.id)
  })

  it('withdrawn items are in no view and no count', async () => {
    const before = (await suggestionsIn('new')).counts
    const gone = await suggestion(submitter, { status: 'withdrawn', fitVerdict: 'no', fitReason: 'x' })
    for (const view of ['new', 'filtered', 'gone'] as const) {
      expect((await suggestionsIn(view)).items.map((i) => i.id)).not.toContain(gone.id)
    }
    expect((await suggestionsIn('new')).counts).toEqual(before)
    expect((await detail(gone.id)).statusCode).toBe(404)
  })

  it('accept publishes a suggestion as created by the submitter', async () => {
    const store = memoryImageStore()
    imageStore.setStore(store)
    const fetched: string[] = []
    ingestImages.setFetch((async (url: URL) => {
      fetched.push(String(url))
      return new Response(PNG)
    }) as unknown as typeof fetch)
    const id = randomUUID()
    const key = `suggestions/${id}/${randomUUID()}.png`
    await store.put(key, PNG, 'image/png')
    const item = await suggestion(submitter, { id, imageKey: key }, { image_url: store.url(key), venue_id: venue.id })

    const res = await post(`/items/${item.id}/accept`, keyReviewer)
    expect(res.statusCode).toBe(200)
    const eventId = res.json().data.event_id as string
    eventIds.push(eventId)

    const event = await eventRow(eventId)
    expect(event.createdBy).toBe(submitter.id)
    expect(event.title).toBe((item.draft as { title: string }).title)
    expect(await db.select().from(eventOrganizers).where(eq(eventOrganizers.eventId, eventId))).toEqual([])
    const logs = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    const created = logs.find((l) => l.action === 'created')
    expect(created?.accountId).toBe(reviewer.id)
    expect((created?.diff as { via?: string }).via).toBe('suggestion')

    // The image moved: copied onto the event, the suggestion's own object deleted
    expect(fetched).toEqual([store.url(key)])
    expect(event.imageKey).toMatch(new RegExp(`^events/${eventId}/`))
    expect(store.objects.has(key)).toBe(false)
    expect([...store.objects.keys()]).toEqual([event.imageKey])
    const stored = await itemRow(item.id)
    expect(stored.status).toBe('accepted')
    expect(stored.imageKey).toBeNull()
    // Never shown as synced from "Suggestions"
    const page = (await app.inject({ method: 'GET', url: `/api/v1/events/${eventId}` })).json().data
    expect(page.synced_from).toBeNull()
    expect(page.added_by.id).toBe(submitter.id)
  })

  it('accept copies the image from a local development store too (served from localhost)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oedb-sugg-'))
    try {
      const store = localImageStore(dir, 'http://localhost:3001/images')
      imageStore.setStore(store)
      const id = randomUUID()
      const key = `suggestions/${id}/${randomUUID()}.png`
      await store.put(key, PNG, 'image/png')
      const item = await suggestion(submitter, { id, imageKey: key }, { image_url: store.url(key) })
      const res = await post(`/items/${item.id}/accept`, keyReviewer)
      expect(res.statusCode).toBe(200)
      const eventId = res.json().data.event_id as string
      eventIds.push(eventId)
      const event = await eventRow(eventId)
      expect(event.imageKey).toMatch(new RegExp(`^events/${eventId}/`))
      expect((await store.read(event.imageKey!))?.data).toEqual(PNG)
      expect(await store.read(key)).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('link moves the suggestion image when the scout takes it, else drops it', async () => {
    const store = memoryImageStore()
    imageStore.setStore(store)
    ingestImages.setFetch((async () => new Response(PNG)) as unknown as typeof fetch)
    const withImage = async () => {
      const id = randomUUID()
      const key = `suggestions/${id}/${randomUUID()}.png`
      await store.put(key, PNG, 'image/png')
      return { key, item: await suggestion(submitter, { id, imageKey: key }, { image_url: store.url(key) }) }
    }
    const target = async (title: string) => {
      const [e] = await db
        .insert(events)
        .values({ title, startsAt: new Date('2033-01-04T20:00:00Z'), city: 'Linktown', createdBy: alice.id })
        .returning()
      eventIds.push(e!.id)
      return e!
    }

    const taken = await withImage()
    const takenTarget = await target('Takes the image')
    const res = await post(`/items/${taken.item.id}/link`, keyReviewer, { event_id: takenTarget.id, fields: ['image'] })
    expect(res.statusCode).toBe(200)
    expect((await eventRow(takenTarget.id)).imageKey).toMatch(new RegExp(`^events/${takenTarget.id}/`))
    expect(store.objects.has(taken.key)).toBe(false)
    expect((await itemRow(taken.item.id)).imageKey).toBeNull()

    const left = await withImage()
    const leftTarget = await target('Keeps its own image')
    expect((await post(`/items/${left.item.id}/link`, keyReviewer, { event_id: leftTarget.id })).statusCode).toBe(200)
    expect((await eventRow(leftTarget.id)).imageKey).toBeNull()
    expect(store.objects.has(left.key)).toBe(false)
    const stored = await itemRow(left.item.id)
    expect(stored.imageKey).toBeNull()
    expect((stored.draft as { image_url: string | null }).image_url).toBeNull()

    // Synced: a suggestion has no feed, so it is detached all the same and never shown as synced from "Suggestions"
    const synced = await suggestion(submitter)
    const syncTarget = await target('Synced from a suggestion')
    expect((await post(`/items/${synced.id}/link`, keyReviewer, { event_id: syncTarget.id, sync: true })).statusCode).toBe(200)
    expect((await itemRow(synced.id)).detachedAt).not.toBeNull()
    const page = (await app.inject({ method: 'GET', url: `/api/v1/events/${syncTarget.id}` })).json().data
    expect(page.synced_from).toBeNull()
  })

  it('accept publishes a suggestion without a start time as a day', async () => {
    const item = await suggestion(submitter, {}, { starts_at: '2031-03-01T23:00:00.000Z', times_unverified: true })
    const res = await post(`/items/${item.id}/accept`, keyReviewer)
    expect(res.statusCode).toBe(200)
    eventIds.push(res.json().data.event_id)
    expect((await eventRow(res.json().data.event_id)).startTimeKnown).toBe(false)
  })

  it('accept with an edited event publishes the edit', async () => {
    const edited = {
      title: 'Fixed',
      starts_at: '2031-05-01T19:00:00.000Z',
      ends_at: '2031-05-01T23:00:00.000Z',
      description: 'Checked by the team',
      venue_id: venue.id,
      categories: ['concert'],
      links: { tickets: 'https://tickets.test/fixed' },
    }
    const item = await suggestion(submitter, {}, { title: 'Fixd', city: 'Elsewhere' })
    const res = await post(`/items/${item.id}/accept`, keyReviewer, { event: edited })
    expect(res.statusCode).toBe(200)
    const eventId = res.json().data.event_id as string
    eventIds.push(eventId)
    const event = await eventRow(eventId)
    expect(event).toMatchObject({
      title: 'Fixed',
      description: 'Checked by the team',
      venueId: venue.id,
      city: 'Venuetown',
      categories: ['concert'],
      links: { tickets: 'https://tickets.test/fixed' },
      createdBy: submitter.id,
      startTimeKnown: true,
    })
    expect(event.startsAt.toISOString()).toBe('2031-05-01T19:00:00.000Z')
    expect(event.endsAt?.toISOString()).toBe('2031-05-01T23:00:00.000Z')

    // A feed item too: the creator stays the source's scout; the edit is a human's, so the feed stops syncing it
    const feed = await newItem()
    const feedRes = await post(`/items/${feed.id}/accept`, keyReviewer, { event: { ...edited, title: 'Fixed feed' } })
    expect(feedRes.statusCode).toBe(200)
    const feedEventId = feedRes.json().data.event_id as string
    eventIds.push(feedEventId)
    const feedEvent = await eventRow(feedEventId)
    expect(feedEvent.title).toBe('Fixed feed')
    expect(feedEvent.createdBy).toBe(feedScout.id)
    expect((await itemRow(feed.id)).detachedAt).not.toBeNull()
    const [log] = await db.select().from(editHistory).where(eq(editHistory.entityId, feedEventId))
    expect((log?.diff as { via?: string }).via).toBe('ingest')
  })

  it('invalid edited event leaves the item pending', async () => {
    const item = await suggestion(submitter)
    const event = { title: `Never ${stamp}`, starts_at: '2031-05-01T19:00:00.000Z', venue_id: venue.id }
    const bad = await post(`/items/${item.id}/accept`, keyReviewer, { event: { ...event, starts_at: 'tomorrow evening' } })
    expect(bad.statusCode).toBe(400)
    const backwards = await post(`/items/${item.id}/accept`, keyReviewer, {
      event: { ...event, ends_at: '2031-05-01T18:00:00.000Z' },
    })
    expect(backwards.statusCode).toBe(400)
    const noPlace = await post(`/items/${item.id}/accept`, keyReviewer, { event: { ...event, venue_id: null } })
    expect(noPlace.statusCode).toBe(400)
    const noVenue = await post(`/items/${item.id}/accept`, keyReviewer, {
      event: { ...event, venue_id: '00000000-0000-4000-8000-000000000000' },
    })
    expect(noVenue.statusCode).toBe(404)
    expect(noVenue.json().error.code).toBe('venue_not_found')

    const stored = await itemRow(item.id)
    expect(stored.status).toBe('pending')
    expect(stored.eventId).toBeNull()
    expect(stored.decidedBy).toBeNull()
    expect(await db.select().from(events).where(eq(events.title, event.title))).toEqual([])
  })

  it('withdrawn items cannot be accepted', async () => {
    const item = await suggestion(submitter, { status: 'withdrawn' })
    expect((await post(`/items/${item.id}/accept`, keyReviewer)).statusCode).toBe(409)
    const edited = await post(`/items/${item.id}/accept`, keyReviewer, {
      event: { title: 'Fixed', starts_at: '2031-05-01T19:00:00.000Z', venue_id: venue.id },
    })
    expect(edited.statusCode).toBe(409)
    const [target] = await db
      .insert(events)
      .values({ title: 'Withdrawn target', startsAt: new Date('2033-01-03T20:00:00Z'), city: 'Linktown', createdBy: alice.id })
      .returning()
    eventIds.push(target!.id)
    expect((await post(`/items/${item.id}/link`, keyReviewer, { event_id: target!.id })).statusCode).toBe(409)
    expect((await post('/items/reject', keyReviewer, { ids: [item.id] })).json().data).toEqual({ rejected: 0 })
    const stored = await itemRow(item.id)
    expect(stored.status).toBe('withdrawn')
    expect(stored.eventId).toBeNull()
  })

  it('reject stores the reason', async () => {
    const item = await suggestion(submitter)
    const res = await post('/items/reject', keyReviewer, { ids: [item.id], reason: '  Already listed under another name  ' })
    expect(res.json().data).toEqual({ rejected: 1 })
    const stored = await itemRow(item.id)
    expect(stored.status).toBe('rejected')
    expect(stored.rejectReason).toBe('Already listed under another name')

    const plain = await suggestion(submitter)
    await post('/items/reject', keyReviewer, { ids: [plain.id] })
    expect((await itemRow(plain.id)).rejectReason).toBeNull()

    const other = await suggestion(submitter)
    expect((await post('/items/reject', keyReviewer, { ids: [other.id], reason: 'x'.repeat(501) })).statusCode).toBe(400)
    expect((await itemRow(other.id)).status).toBe('pending')
  })

  it('live mail on accept and on link, not on reject', async () => {
    const accepted = await suggestion(submitter, {}, { title: `Live ${stamp}`, starts_at: '2031-07-04T19:30:00.000Z' })
    const res = await post(`/items/${accepted.id}/accept`, keyReviewer)
    expect(res.statusCode).toBe(200)
    const eventId = res.json().data.event_id as string
    eventIds.push(eventId)
    await waitForMails(1)
    expect(mails[0]).toMatchObject({
      to: submitter.email,
      title: `Live ${stamp}`,
      startsAt: '2031-07-04T19:30:00.000Z',
      url: `${WEB_URL}/events/${eventId}`,
    })

    // Linked to an existing event: the mail names that event
    const [target] = await db
      .insert(events)
      .values({ title: `Link live ${stamp}`, startsAt: new Date('2031-07-05T20:00:00Z'), city: 'Linktown', createdBy: alice.id })
      .returning()
    eventIds.push(target!.id)
    const linked = await suggestion(submitter)
    expect((await post(`/items/${linked.id}/link`, keyReviewer, { event_id: target!.id })).statusCode).toBe(200)
    await waitForMails(2)
    expect(mails[1]).toMatchObject({ to: submitter.email, title: `Link live ${stamp}`, url: `${WEB_URL}/events/${target!.id}` })
    expect((await itemRow(linked.id)).detachedAt).not.toBeNull()

    // No mail for a reject or a feed item
    const rejected = await suggestion(submitter)
    await post('/items/reject', keyReviewer, { ids: [rejected.id], reason: 'No' })
    const feed = await newItem()
    const feedRes = await post(`/items/${feed.id}/accept`, keyReviewer)
    eventIds.push(feedRes.json().data.event_id)
    await settle()
    expect(mails).toHaveLength(2)

    // A failing mail never fails the accept (nor leaves an unhandled rejection behind)
    failMail = true
    const unlucky = await suggestion(submitter)
    const unluckyRes = await post(`/items/${unlucky.id}/accept`, keyReviewer)
    expect(unluckyRes.statusCode).toBe(200)
    eventIds.push(unluckyRes.json().data.event_id)
    await vi.waitFor(() => expect(attempts).toBe(3), { timeout: 2000 })
    await settle()
  })
})
