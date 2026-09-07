import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq, inArray } from 'drizzle-orm'
import {
  editHistory,
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
let keyA: string
let keyB: string
let venue: Venue
const stamp = Date.now()

const auth = (key: string) => ({ authorization: `Bearer ${key}` })

beforeAll(async () => {
  app = await buildApp({ logger: false })

  const a = generateApiKey()
  const b = generateApiKey()
  keyA = a.key
  keyB = b.key

  const rows = await db
    .insert(publishers)
    .values([
      { name: 'Test Alice', slug: `test-alice-${stamp}`, email: `alice-${stamp}@test.local`, verified: true, apiKeyHash: a.hash },
      { name: 'Test Bob', slug: `test-bob-${stamp}`, email: `bob-${stamp}@test.local`, verified: true, apiKeyHash: b.hash },
    ])
    .returning()
  alice = rows.find((p) => p.slug.startsWith('test-alice'))!
  bob = rows.find((p) => p.slug.startsWith('test-bob'))!

  const [v] = await db
    .insert(venues)
    .values({ name: `Test Venue ${stamp}`, address: '1 Test St', city: 'Testcity', coordinates: [13.4, 52.5] })
    .returning()
  venue = v!
})

afterAll(async () => {
  const ids = [alice.id, bob.id]
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
