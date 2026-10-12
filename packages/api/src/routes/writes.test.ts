import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq, inArray } from 'drizzle-orm'
import {
  editHistory,
  eventOwners,
  events,
  generateApiKey,
  publishers,
  venues,
  type Publisher,
  type Venue,
} from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'

let app: FastifyInstance
let alice: Publisher
let bob: Publisher
let scout: Publisher
let scout2: Publisher
let keyA: string
let keyB: string
let keyS: string
let keyS2: string
let venue: Venue
const stamp = Date.now()

const auth = (key: string) => ({ authorization: `Bearer ${key}` })

beforeAll(async () => {
  app = await buildApp({ logger: false })

  const a = generateApiKey()
  const b = generateApiKey()
  const sc = generateApiKey()
  const sc2 = generateApiKey()
  keyA = a.key
  keyB = b.key
  keyS = sc.key
  keyS2 = sc2.key

  const rows = await db
    .insert(publishers)
    .values([
      { name: 'Test Alice', slug: `test-alice-${stamp}`, email: `alice-${stamp}@test.local`, verified: true, apiKeyHash: a.hash },
      { name: 'Test Bob', slug: `test-bob-${stamp}`, email: `bob-${stamp}@test.local`, verified: true, apiKeyHash: b.hash },
      { name: 'Test Scout', slug: `test-scout-${stamp}`, email: `scout-${stamp}@test.local`, verified: true, isPublisher: false, isScout: true, apiKeyHash: sc.hash },
      { name: 'Test Scout Two', slug: `test-scout2-${stamp}`, email: `scout2-${stamp}@test.local`, verified: true, isPublisher: false, isScout: true, apiKeyHash: sc2.hash },
    ])
    .returning()
  alice = rows.find((p) => p.slug.startsWith('test-alice'))!
  bob = rows.find((p) => p.slug.startsWith('test-bob'))!
  scout = rows.find((p) => p.slug.startsWith('test-scout-'))!
  scout2 = rows.find((p) => p.slug.startsWith('test-scout2'))!

  const [v] = await db
    .insert(venues)
    .values({ name: `Test Venue ${stamp}`, address: '1 Test St', city: 'Testcity', coordinates: [13.4, 52.5] })
    .returning()
  venue = v!
})

afterAll(async () => {
  const ids = [alice.id, bob.id, scout.id, scout2.id]
  await db.delete(editHistory).where(inArray(editHistory.publisherId, ids))
  await db.delete(events).where(inArray(events.createdBy, ids))
  await db.delete(venues).where(eq(venues.id, venue.id))
  await db.delete(venues).where(eq(venues.name, `Created Venue ${stamp}`))
  await db.delete(publishers).where(inArray(publishers.id, ids))
  await app.close()
})

describe('auth middleware', () => {
  it('rejects unauthenticated writes with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/events', payload: {} })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
  })

  it('rejects an unknown API key with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth('oevt_definitely-not-a-real-key-000000'),
      payload: {},
    })
    expect(res.statusCode).toBe(401)
  })

  it('leaves reads open', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/events' })
    expect(res.statusCode).toBe(200)
  })
})

describe('events write flow', () => {
  let eventId: string

  it('validates the body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_error')
  })

  it('requires city when there is no venue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: 'No city', starts_at: '2030-01-01T20:00:00Z' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates an event, fills city from venue, sets creator, normalizes tags', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: {
        title: 'Test Night',
        starts_at: '2030-01-01T20:00:00Z',
        ends_at: '2030-01-02T04:00:00Z',
        venue_id: venue.id,
        tags: [' Techno', 'techno', 'Open-Air '],
        links: { ra: 'https://ra.co/events/1' },
      },
    })
    expect(res.statusCode).toBe(201)
    const e = res.json().data
    eventId = e.id
    expect(e.city).toBe('Testcity')
    expect(e.status).toBe('scheduled')
    expect(e.tags).toEqual(['techno', 'open-air'])
    expect(e.venue.id).toBe(venue.id)
    expect(e.owners).toEqual([
      expect.objectContaining({ publisher_id: alice.id, role: 'creator' }),
    ])
    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    expect(history.map((h) => h.action)).toEqual(['created'])
  })

  it('forbids edits by non-owners', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyB),
      payload: { title: 'Hijacked' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('only the creator can add co-owners', async () => {
    const byBob = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/owners`,
      headers: auth(keyB),
      payload: { publisher_id: bob.id },
    })
    expect(byBob.statusCode).toBe(403)

    const byAlice = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/owners`,
      headers: auth(keyA),
      payload: { publisher_id: bob.id },
    })
    expect(byAlice.statusCode).toBe(201)
    expect(byAlice.json().data.owners).toHaveLength(2)

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/owners`,
      headers: auth(keyA),
      payload: { publisher_id: bob.id },
    })
    expect(again.statusCode).toBe(400)
  })

  it('co-owners can edit and postpone but not cancel', async () => {
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyB),
      payload: { title: 'Test Night (co-edited)', status: 'postponed' },
    })
    expect(edit.statusCode).toBe(200)
    expect(edit.json().data.title).toBe('Test Night (co-edited)')
    expect(edit.json().data.status).toBe('postponed')

    const cancel = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyB),
      payload: { status: 'cancelled' },
    })
    expect(cancel.statusCode).toBe(403)

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyB),
    })
    expect(del.statusCode).toBe(403)
  })

  it('the creator cannot be removed, co-owners can', async () => {
    const removeCreator = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}/owners/${alice.id}`,
      headers: auth(keyA),
    })
    expect(removeCreator.statusCode).toBe(400)

    const removeBob = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}/owners/${bob.id}`,
      headers: auth(keyA),
    })
    expect(removeBob.statusCode).toBe(200)
    expect(removeBob.json().data.owners).toHaveLength(1)
  })

  it('the creator can cancel via DELETE and it is logged as cancelled', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyA),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('cancelled')

    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    expect(history.map((h) => h.action)).toContain('cancelled')
  })

  it('cancelled events are hidden from the default list but visible with status filter', async () => {
    const def = await app.inject({ method: 'GET', url: `/api/v1/events?publisher_id=${alice.id}` })
    expect(def.json().data.map((e: { id: string }) => e.id)).not.toContain(eventId)

    const all = await app.inject({
      method: 'GET',
      url: `/api/v1/events?publisher_id=${alice.id}&status=scheduled,postponed,cancelled`,
    })
    expect(all.json().data.map((e: { id: string }) => e.id)).toContain(eventId)
  })
})

describe('venues write flow', () => {
  it('any verified publisher can create and edit venues', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/venues',
      headers: auth(keyA),
      payload: {
        name: `Created Venue ${stamp}`,
        address: '2 Test St',
        city: 'Testcity',
        coordinates: { lat: 52.51, lng: 13.41 },
      },
    })
    expect(created.statusCode).toBe(201)
    const v = created.json().data
    expect(v.coordinates).toEqual({ lat: 52.51, lng: 13.41 })

    const edited = await app.inject({
      method: 'PUT',
      url: `/api/v1/venues/${v.id}`,
      headers: auth(keyB),
      payload: { address: '3 Test St' },
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().data.address).toBe('3 Test St')
  })
})

describe('publisher profile', () => {
  it('rejects a taken slug', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/publishers/me',
      headers: auth(keyA),
      payload: { slug: bob.slug },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('slug_taken')
  })

  it('updates own profile', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/publishers/me',
      headers: auth(keyA),
      payload: { name: 'Test Alice Renamed', links: { website: 'https://alice.test' } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.name).toBe('Test Alice Renamed')
  })

  it('API key generation requires a session, not an API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/publishers/me/api-key',
      headers: auth(keyA),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('event list order', () => {
  it('order=desc returns newest first and paginates with the cursor', async () => {
    const starts = ['2020-01-01T20:00:00Z', '2020-02-01T20:00:00Z', '2020-03-01T20:00:00Z']
    for (const [i, starts_at] of starts.entries()) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: auth(keyA),
        payload: { title: `Order test ${i}`, starts_at, venue_id: venue.id },
      })
      expect(res.statusCode).toBe(201)
    }

    const page = async (cursor?: string) => {
      const qs = new URLSearchParams({ venue_id: venue.id, to: '2021-01-01T00:00:00Z', order: 'desc', limit: '2' })
      if (cursor) qs.set('cursor', cursor)
      const res = await app.inject({ method: 'GET', url: `/api/v1/events?${qs}` })
      expect(res.statusCode).toBe(200)
      return res.json() as { data: { starts_at: string }[]; meta: { cursor: string | null; has_more: boolean } }
    }

    const first = await page()
    expect(first.data.map((e) => e.starts_at)).toEqual(['2020-03-01T20:00:00.000Z', '2020-02-01T20:00:00.000Z'])
    expect(first.meta.has_more).toBe(true)

    const second = await page(first.meta.cursor!)
    expect(second.data.map((e) => e.starts_at)).toEqual(['2020-01-01T20:00:00.000Z'])
    expect(second.meta.has_more).toBe(false)
  })

  it('rejects an unknown order', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/events?order=sideways' })
    expect(res.statusCode).toBe(400)
  })
})

const cliPath = fileURLToPath(new URL('../../../db/src/cli.ts', import.meta.url))
const dbDir = fileURLToPath(new URL('../../../db', import.meta.url))
const cli = (...args: string[]) =>
  execFileSync(process.execPath, ['--import', 'tsx', cliPath, ...args], { cwd: dbDir, encoding: 'utf8' })

describe('scouts and unclaimed events', () => {
  let eventId: string

  it('a scout creates an unclaimed event: added_by is the scout, no owners', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyS),
      payload: { title: 'Scouted Night', starts_at: '2030-02-01T22:00:00Z', venue_id: venue.id },
    })
    expect(res.statusCode).toBe(201)
    const e = res.json().data
    eventId = e.id
    expect(e.owners).toEqual([])
    expect(e.claimed).toBe(false)
    expect(e.added_by).toEqual({ id: scout.id, slug: scout.slug, name: 'Test Scout', is_scout: true })
    expect(e).not.toHaveProperty('created_by')
  })

  it('publisher-created events stay owned and claimed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: 'Owned Night', starts_at: '2030-02-02T22:00:00Z', venue_id: venue.id },
    })
    const e = res.json().data
    expect(e.claimed).toBe(true)
    expect(e.added_by).toEqual(expect.objectContaining({ id: alice.id, is_scout: false }))
  })

  it('lists unclaimed events in the feed with claimed=false and filters by added_by', async () => {
    const feed = await app.inject({ method: 'GET', url: `/api/v1/events?venue_id=${venue.id}` })
    const row = feed.json().data.find((e: { id: string }) => e.id === eventId)
    expect(row).toEqual(expect.objectContaining({ claimed: false }))

    const added = await app.inject({ method: 'GET', url: `/api/v1/events?added_by=${scout.id}` })
    expect(added.json().data.map((e: { id: string }) => e.id)).toEqual([eventId])
  })

  it('any scout can edit an unclaimed event; a non-owner publisher gets 403', async () => {
    const byOtherScout = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyS2),
      payload: { title: 'Scouted Night (fixed)' },
    })
    expect(byOtherScout.statusCode).toBe(200)

    const byPublisher = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyB),
      payload: { title: 'Hijacked' },
    })
    expect(byPublisher.statusCode).toBe(403)
  })

  it('nobody can add co-owners to an unclaimed event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/owners`,
      headers: auth(keyS),
      payload: { publisher_id: bob.id },
    })
    expect(res.statusCode).toBe(403)
  })

  it('scouts cannot be added as co-owners and are not listed as publishers', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyA),
      payload: { title: 'Owner test', starts_at: '2030-02-03T22:00:00Z', venue_id: venue.id },
    })
    const add = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${created.json().data.id}/owners`,
      headers: auth(keyA),
      payload: { publisher_id: scout.id },
    })
    expect(add.statusCode).toBe(400)

    const list = await app.inject({ method: 'GET', url: '/api/v1/publishers?q=Test%20Scout' })
    expect(list.json().data).toEqual([])
    const pubs = await app.inject({ method: 'GET', url: `/api/v1/publishers?q=Test%20Alice` })
    expect(pubs.json().data[0]).toEqual(expect.objectContaining({ is_publisher: true, is_scout: false }))
  })

  it('claim-event makes the publisher creator and locks scouts out', async () => {
    cli('claim-event', eventId, alice.slug)

    const detail = await app.inject({ method: 'GET', url: `/api/v1/events/${eventId}` })
    const e = detail.json().data
    expect(e.claimed).toBe(true)
    expect(e.owners).toEqual([expect.objectContaining({ publisher_id: alice.id, role: 'creator' })])
    expect(e.added_by.id).toBe(scout.id)

    const byScout = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth(keyS),
      payload: { title: 'Too late' },
    })
    expect(byScout.statusCode).toBe(403)

    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    const claim = history.find((h) => h.action === 'ownership_changed')
    expect(claim?.publisherId).toBe(alice.id)
    expect(claim?.diff).toEqual(expect.objectContaining({ via: 'cli' }))

    expect(() => cli('claim-event', eventId, bob.slug)).toThrow()
  })

  it('scouts can cancel unclaimed events via DELETE', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyS),
      payload: { title: 'Scouted Cancel', starts_at: '2030-02-04T22:00:00Z', venue_id: venue.id },
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${created.json().data.id}`,
      headers: auth(keyS2),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.status).toBe('cancelled')
  })

  it('delete-event hard-deletes and leaves only a content-free "deleted" history row', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: auth(keyS),
      payload: { title: 'Scouted Delete', starts_at: '2030-02-05T22:00:00Z', venue_id: venue.id },
    })
    const id = created.json().data.id
    cli('delete-event', id)

    const gone = await app.inject({ method: 'GET', url: `/api/v1/events/${id}` })
    expect(gone.statusCode).toBe(404)
    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, id))
    expect(history).toEqual([expect.objectContaining({ action: 'deleted', publisherId: scout.id, diff: { via: 'cli' } })])
  })

  it('delete-event asks before deleting a claimed event', async () => {
    // eventId was claimed by Alice above; answering anything but "y" aborts
    expect(() =>
      execFileSync(process.execPath, ['--import', 'tsx', cliPath, 'delete-event', eventId], {
        cwd: dbDir,
        input: 'n\n',
        stdio: 'pipe',
      }),
    ).toThrow()
    const owners = await db.select().from(eventOwners).where(eq(eventOwners.eventId, eventId))
    expect(owners).toHaveLength(1)

    cli('delete-event', eventId, '--yes')
    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, eventId))
    expect(history).toEqual([expect.objectContaining({ action: 'deleted', publisherId: alice.id })])
  })
})
