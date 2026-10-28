import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq, inArray } from 'drizzle-orm'
import {
  editHistory,
  eventOwners,
  events,
  generateApiKey,
  ingestItems,
  ingestSources,
  publishers,
  venues,
  type IngestItem,
  type Publisher,
  type Venue,
} from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'

let app: FastifyInstance
let scout: Publisher
let feedScout: Publisher
let alice: Publisher
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

async function newItem(over: Partial<typeof ingestItems.$inferInsert> = {}, draft = draftOf()): Promise<IngestItem> {
  const [item] = await db
    .insert(ingestItems)
    .values({ sourceId, externalId: `ext-${stamp}-${++seq}`, draft, raw: 'raw', ...over })
    .returning()
  return item!
}

const itemRow = async (id: string) => (await db.select().from(ingestItems).where(eq(ingestItems.id, id)))[0]!
const eventRow = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0]!

async function listIds(view: 'new' | 'gone'): Promise<string[]> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/ingest/items?view=${view}`, headers: auth(keyScout) })
  expect(res.statusCode).toBe(200)
  return res.json().data.map((i: { id: string }) => i.id)
}

const post = (url: string, key: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api/v1/ingest${url}`, headers: auth(key), payload: payload as object })

beforeAll(async () => {
  app = await buildApp({ logger: false })
  const s = generateApiKey()
  const a = generateApiKey()
  keyScout = s.key
  keyAlice = a.key
  const rows = await db
    .insert(publishers)
    .values([
      { name: 'Inbox Scout', slug: `inbox-scout-${stamp}`, email: `inbox-scout-${stamp}@test.local`, verified: true, isPublisher: false, isScout: true, apiKeyHash: s.hash },
      { name: 'Inbox Alice', slug: `inbox-alice-${stamp}`, email: `inbox-alice-${stamp}@test.local`, verified: true, apiKeyHash: a.hash },
      { name: 'Feed Scout', slug: `inbox-feed-scout-${stamp}`, email: `inbox-feed-${stamp}@test.local`, verified: true, isPublisher: false, isScout: true },
    ])
    .returning()
  scout = rows.find((p) => p.slug.startsWith('inbox-scout'))!
  alice = rows.find((p) => p.slug.startsWith('inbox-alice'))!
  feedScout = rows.find((p) => p.slug.startsWith('inbox-feed-scout'))!

  const [v] = await db
    .insert(venues)
    .values({ name: `Inbox Venue ${stamp}`, address: '1 Test St', city: 'Venuetown' })
    .returning()
  venue = v!
  const [src] = await db
    .insert(ingestSources)
    .values({ slug: `inbox-${stamp}`, name: sourceName, kind: 'ical', url: 'https://inbox.test/feed.ics', publisherId: feedScout.id })
    .returning()
  sourceId = src!.id
})

afterAll(async () => {
  const ids = [scout.id, alice.id, feedScout.id]
  const created = await db.select({ id: events.id }).from(events).where(inArray(events.createdBy, ids))
  const allEventIds = [...new Set([...eventIds, ...created.map((e) => e.id)])]
  await db.delete(ingestSources).where(eq(ingestSources.id, sourceId)) // cascades items
  if (allEventIds.length) await db.delete(editHistory).where(inArray(editHistory.entityId, allEventIds))
  await db.delete(editHistory).where(inArray(editHistory.publisherId, ids))
  await db.delete(events).where(inArray(events.id, allEventIds))
  await db.delete(venues).where(eq(venues.id, venue.id))
  await db.delete(publishers).where(inArray(publishers.id, ids))
  await app.close()
})

describe('access control', () => {
  it('answers 401 without credentials and 403 for non-scouts on every endpoint', async () => {
    const item = await newItem()
    const calls: [string, string, unknown?][] = [
      ['GET', '/api/v1/ingest/items'],
      ['GET', '/api/v1/ingest/count'],
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

describe('GET /ingest/items and /ingest/count', () => {
  it('lists pending items by draft start with duplicates and counts', async () => {
    const count0 = await app.inject({ method: 'GET', url: '/api/v1/ingest/count', headers: auth(keyScout) })
    const before = count0.json().data as { new: number; gone: number }

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

    const res = await app.inject({ method: 'GET', url: '/api/v1/ingest/items?view=new', headers: auth(keyScout) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const mine = body.data.filter((i: { source: { slug: string } }) => i.source.slug === `inbox-${stamp}`)
    const ids = mine.map((i: { id: string }) => i.id)
    expect(ids.filter((id: string) => [early.id, offset.id, late.id].includes(id))).toEqual([early.id, offset.id, late.id])
    expect(ids).not.toContain(hidden.id)
    expect(ids).not.toContain(rejected.id)

    const first = mine.find((i: { id: string }) => i.id === early.id)
    expect(first.source).toEqual({ slug: `inbox-${stamp}`, name: sourceName })
    expect(first.status).toBe('pending')
    expect(first.event_id).toBeNull()
    expect(first.draft.title).toBe('Same Night Party')
    expect(first.venue_name).toBe(venue.name)
    expect(mine.find((i: { id: string }) => i.id === late.id).venue_name).toBeNull()
    expect(first.duplicates.map((d: { id: string }) => d.id)).toEqual([dup!.id])
    expect(first.duplicates[0].likely).toBe(true)
    expect(mine.find((i: { id: string }) => i.id === late.id).duplicates).toEqual([])

    expect(body.meta.counts.new).toBeGreaterThanOrEqual(before.new + 3)
    expect(body.meta.counts.gone).toBeGreaterThanOrEqual(before.gone)

    const count = await app.inject({ method: 'GET', url: '/api/v1/ingest/count', headers: auth(keyScout) })
    expect(count.json().data.new).toBeGreaterThanOrEqual(before.new + 3)
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

    // The count uses the same filter as the list (retried: other test files add items in parallel)
    let consistent = false
    for (let i = 0; i < 5 && !consistent; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/ingest/items?view=new', headers: auth(keyScout) })
      const body = res.json()
      consistent = body.meta.counts.new === body.data.length
    }
    expect(consistent).toBe(true)

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

  it('defaults to the new view and rejects an unknown view', async () => {
    const def = await app.inject({ method: 'GET', url: '/api/v1/ingest/items', headers: auth(keyScout) })
    expect(def.statusCode).toBe(200)
    const bad = await app.inject({ method: 'GET', url: '/api/v1/ingest/items?view=all', headers: auth(keyScout) })
    expect(bad.statusCode).toBe(400)
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
    expect(event.owners).toEqual([])
    expect(event.added_by.id).toBe(feedScout.id)
    expect(event.synced_from).toEqual({ source_name: sourceName, source_url: 'https://feed.test/e' })

    const stored = await itemRow(item.id)
    expect(stored.status).toBe('accepted')
    expect(stored.eventId).toBe(eventId)
    expect(stored.decidedBy).toBe(scout.id)
    expect(stored.decidedAt).not.toBeNull()
    expect(stored.detachedAt).toBeNull()

    const [owner] = await db.select().from(eventOwners).where(eq(eventOwners.eventId, eventId))
    expect(owner).toBeUndefined()
    const [log] = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    expect(log?.action).toBe('created')
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

    const res = await app.inject({ method: 'GET', url: '/api/v1/ingest/items?view=gone', headers: auth(keyScout) })
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
    expect(log.find((l) => l.action === 'cancelled')?.publisherId).toBe(scout.id)
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
