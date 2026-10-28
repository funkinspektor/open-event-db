import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq, inArray } from 'drizzle-orm'
import { events, publishers, venues, type Venue } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { findDuplicateCandidates } from './duplicates.js'

const stamp = Date.now()
let app: FastifyInstance
let venue: Venue
let otherVenue: Venue
let publisherId: string
const eventIds: string[] = []

// 2026-11-14 is a Saturday in CET (UTC+1): 20:00 Berlin = 19:00Z
const night = new Date('2026-11-14T19:00:00Z')
const nextNight = new Date('2026-11-15T19:00:00Z')

async function addEvent(values: Partial<typeof events.$inferInsert> & { title: string; startsAt: Date }) {
  const [e] = await db
    .insert(events)
    .values({ city: 'Dupcity', createdBy: publisherId, ...values })
    .returning()
  eventIds.push(e!.id)
  return e!
}

const mine = <T extends { id: string }>(rows: T[]) => rows.filter((r) => eventIds.includes(r.id))

beforeAll(async () => {
  app = await buildApp({ logger: false })
  const [p] = await db
    .insert(publishers)
    .values({ name: `Dup Scout ${stamp}`, slug: `dup-scout-${stamp}`, email: `dup-${stamp}@test.local`, verified: true, isPublisher: false, isScout: true })
    .returning()
  publisherId = p!.id
  const vs = await db
    .insert(venues)
    .values([
      { name: `Dupclub ${stamp}`, address: '1 Dup St', city: 'Dupcity' },
      { name: `Otherclub ${stamp}`, address: '2 Dup St', city: 'Dupcity' },
    ])
    .returning()
  venue = vs[0]!
  otherVenue = vs[1]!
})

afterAll(async () => {
  await db.delete(events).where(inArray(events.id, eventIds))
  await db.delete(venues).where(inArray(venues.id, [venue.id, otherVenue.id]))
  await db.delete(publishers).where(eq(publishers.id, publisherId))
  await app.close()
})

describe('findDuplicateCandidates', () => {
  it('finds a same-venue same-day event and flags a near-identical title as likely', async () => {
    const e = await addEvent({ title: `Techno Nacht ${stamp}`, startsAt: night, venueId: venue.id })
    const rows = mine(await findDuplicateCandidates({ venueId: venue.id, startsAt: new Date('2026-11-14T20:30:00Z'), title: `Techno Nacht ${stamp}` }))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: e.id,
      title: `Techno Nacht ${stamp}`,
      starts_at: night.toISOString(),
      ends_at: null,
      venue_name: venue.name,
      added_by_name: `Dup Scout ${stamp}`,
      likely: true,
    })
    expect(rows[0]!.similarity).toBeGreaterThanOrEqual(0.4)
  })

  it('does not find the event on the next Berlin day, but uses Berlin day boundaries', async () => {
    const day = await findDuplicateCandidates({ venueId: venue.id, startsAt: nextNight })
    expect(mine(day).map((r) => r.title)).not.toContain(`Techno Nacht ${stamp}`)
    // 23:30 Berlin on the 14th is still the 14th; 00:30 Berlin on the 15th is not
    const late = await findDuplicateCandidates({ venueId: venue.id, startsAt: new Date('2026-11-14T22:30:00Z') })
    expect(mine(late).map((r) => r.title)).toContain(`Techno Nacht ${stamp}`)
    const after = await findDuplicateCandidates({ venueId: venue.id, startsAt: new Date('2026-11-14T23:30:00Z') })
    expect(mine(after).map((r) => r.title)).not.toContain(`Techno Nacht ${stamp}`)
  })

  it('ignores events at another venue and cancelled events, and honours excludeId', async () => {
    const cancelled = await addEvent({ title: `Cancelled ${stamp}`, startsAt: night, venueId: venue.id, status: 'cancelled' })
    const elsewhere = await addEvent({ title: `Elsewhere ${stamp}`, startsAt: night, venueId: otherVenue.id })
    const own = await addEvent({ title: `Self ${stamp}`, startsAt: night, venueId: venue.id })
    const rows = mine(await findDuplicateCandidates({ venueId: venue.id, startsAt: night, excludeId: own.id }))
    const ids = rows.map((r) => r.id)
    expect(ids).not.toContain(cancelled.id)
    expect(ids).not.toContain(elsewhere.id)
    expect(ids).not.toContain(own.id)
  })

  it('matches an event on its location_text containing the venue name', async () => {
    const e = await addEvent({ title: `Texty ${stamp}`, startsAt: night, locationText: `${venue.name}, Veteranenstr.` })
    const rows = mine(await findDuplicateCandidates({ venueId: venue.id, startsAt: night }))
    expect(rows.map((r) => r.id)).toContain(e.id)
  })

  it('with only location_text, matches equal location_text or an event venue named in the input', async () => {
    const byText = await addEvent({ title: `ByText ${stamp}`, startsAt: night, locationText: `Hinterhof ${stamp}` })
    const byVenue = await findDuplicateCandidates({ locationText: `hinterhof ${stamp}`, startsAt: night })
    expect(byVenue.map((r) => r.id)).toContain(byText.id)

    const viaVenue = await findDuplicateCandidates({ locationText: `${venue.name}, Veteranenstr. 1`, startsAt: night })
    expect(mine(viaVenue).map((r) => r.title)).toContain(`Techno Nacht ${stamp}`)
  })

  it('returns nothing without any place', async () => {
    expect(await findDuplicateCandidates({ startsAt: night })).toEqual([])
  })

  it('overlaps multi-hour events with the window and uses the input range when it spans days', async () => {
    const festivalVenue = otherVenue.id
    const overnight = await addEvent({
      title: `Overnight ${stamp}`,
      startsAt: new Date('2026-12-05T22:00:00Z'),
      endsAt: new Date('2026-12-06T10:00:00Z'),
      venueId: festivalVenue,
    })
    // overnight event started the previous day but overlaps 6 Dec
    const rows = await findDuplicateCandidates({ venueId: festivalVenue, startsAt: new Date('2026-12-06T12:00:00Z') })
    expect(rows.map((r) => r.id)).toContain(overnight.id)

    const farEvent = await addEvent({ title: `Far ${stamp}`, startsAt: new Date('2026-12-09T19:00:00Z'), venueId: festivalVenue })
    const spanning = await findDuplicateCandidates({
      venueId: festivalVenue,
      startsAt: new Date('2026-12-05T10:00:00Z'),
      endsAt: new Date('2026-12-10T10:00:00Z'),
    })
    expect(spanning.map((r) => r.id)).toEqual(expect.arrayContaining([overnight.id, farEvent.id]))
    const sameDay = await findDuplicateCandidates({ venueId: festivalVenue, startsAt: new Date('2026-12-05T10:00:00Z'), endsAt: new Date('2026-12-05T16:00:00Z') })
    expect(sameDay.map((r) => r.id)).not.toContain(farEvent.id)
  })

  it('orders by title similarity, then start time, and respects the limit', async () => {
    const day = new Date('2027-01-16T19:00:00Z')
    const close = await addEvent({ title: `Jazz Session ${stamp}`, startsAt: new Date('2027-01-16T21:00:00Z'), venueId: venue.id })
    const far = await addEvent({ title: `Pottery workshop ${stamp}`, startsAt: new Date('2027-01-16T17:00:00Z'), venueId: venue.id })
    const rows = await findDuplicateCandidates({ venueId: venue.id, startsAt: day, title: `Jazz Session ${stamp}` })
    expect(rows.map((r) => r.id)).toEqual([close.id, far.id])
    expect(rows[0]!.similarity).toBeGreaterThan(rows[1]!.similarity)
    expect(rows[1]!.likely).toBe(false)

    const noTitle = await findDuplicateCandidates({ venueId: venue.id, startsAt: day })
    expect(noTitle.map((r) => r.id)).toEqual([far.id, close.id])
    expect(noTitle.every((r) => r.similarity === 0 && !r.likely)).toBe(true)

    expect(await findDuplicateCandidates({ venueId: venue.id, startsAt: day }, 1)).toHaveLength(1)
  })
})

describe('GET /api/v1/events/duplicates', () => {
  it('returns candidates without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/events/duplicates?venue_id=${venue.id}&starts_at=${encodeURIComponent('2026-11-14T20:00:00Z')}&title=${encodeURIComponent(`Techno Nacht ${stamp}`)}`,
    })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    expect(Array.isArray(data)).toBe(true)
    expect(mine<{ id: string; title: string }>(data).map((r) => r.title)).toContain(`Techno Nacht ${stamp}`)
  })

  it('400s without starts_at', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/events/duplicates?venue_id=${venue.id}` })
    expect(res.statusCode).toBe(400)
  })
})
