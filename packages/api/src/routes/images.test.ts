import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq, inArray } from 'drizzle-orm'
import {
  editHistory,
  events,
  generateApiKey,
  ingestItems,
  ingestSources,
  publishers,
  type Publisher,
} from '@open-event-db/db'
import { EVENT_IMAGE_MAX_BYTES } from '@open-event-db/shared'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { imageStore, memoryImageStore } from '../images/store.js'

let app: FastifyInstance
let owner: Publisher
let stranger: Publisher
let ownerKey: string
let strangerKey: string
let store: ReturnType<typeof memoryImageStore>
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8])
const auth = (key: string) => ({ authorization: `Bearer ${key}` })
const stamp = Date.now()

async function newEvent(fields: Partial<typeof events.$inferInsert> = {}) {
  const [e] = await db
    .insert(events)
    .values({ title: `Image test ${stamp}`, startsAt: new Date('2030-05-01T20:00:00Z'), city: 'Berlin', createdBy: owner.id, ...fields })
    .returning()
  return e!
}

beforeAll(async () => {
  app = await buildApp({ logger: false })
  const key = generateApiKey()
  const other = generateApiKey()
  ownerKey = key.key
  strangerKey = other.key
  const rows = await db
    .insert(publishers)
    .values([
      { name: 'Image Owner', slug: `image-owner-${stamp}`, email: `image-owner-${stamp}@test.local`, verified: true, apiKeyHash: key.hash },
      { name: 'Image Stranger', slug: `image-stranger-${stamp}`, email: `image-stranger-${stamp}@test.local`, verified: true, apiKeyHash: other.hash },
    ])
    .returning()
  owner = rows.find((p) => p.slug.startsWith('image-owner'))!
  stranger = rows.find((p) => p.slug.startsWith('image-stranger'))!
})

beforeEach(() => {
  store = memoryImageStore()
  imageStore.setStore(store)
})
afterEach(() => imageStore.reset())

afterAll(async () => {
  await db.delete(ingestSources).where(eq(ingestSources.publisherId, owner.id))
  await db.delete(editHistory).where(inArray(editHistory.publisherId, [owner.id, stranger.id]))
  await db.delete(events).where(eq(events.createdBy, owner.id))
  await db.delete(publishers).where(inArray(publishers.id, [owner.id, stranger.id]))
  await app.close()
})

describe('image_url in event responses', () => {
  it('turns the stored key into the public URL in detail and list', async () => {
    const e = await newEvent({ imageKey: 'events/a/b.jpg' })
    const detail = await app.inject({ method: 'GET', url: `/api/v1/events/${e.id}` })
    expect(detail.json().data.image_url).toBe('https://images.test/events/a/b.jpg')
    const list = await app.inject({ method: 'GET', url: `/api/v1/events?added_by=${owner.id}&from=2030-01-01T00:00:00Z` })
    expect(list.json().data.find((x: { id: string }) => x.id === e.id).image_url).toBe('https://images.test/events/a/b.jpg')
  })

  it('serializes image_url as null without a key', async () => {
    const e = await newEvent()
    const detail = await app.inject({ method: 'GET', url: `/api/v1/events/${e.id}` })
    expect(detail.json().data.image_url).toBeNull()
  })

  it('serializes image_url as null when no store is configured', async () => {
    imageStore.setStore(null)
    const e = await newEvent({ imageKey: 'events/a/c.jpg' })
    const detail = await app.inject({ method: 'GET', url: `/api/v1/events/${e.id}` })
    expect(detail.json().data.image_url).toBeNull()
  })
})

/** An event the owner owns (creator row), so canEdit holds for them only. */
async function ownedEvent() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/events',
    headers: auth(ownerKey),
    payload: { title: `Owned ${stamp}`, starts_at: '2030-06-01T20:00:00Z', city: 'Berlin' },
  })
  expect(res.statusCode).toBe(201)
  return res.json().data.id as string
}

const upload = (id: string, body: Buffer, key = ownerKey, type = 'image/png') =>
  app.inject({ method: 'PUT', url: `/api/v1/events/${id}/image`, headers: { ...auth(key), 'content-type': type }, payload: body })

describe('PUT/DELETE /events/:id/image', () => {
  it('stores an upload, shows it and logs the edit', async () => {
    const id = await ownedEvent()
    const res = await upload(id, PNG)
    expect(res.statusCode).toBe(200)
    const url = res.json().data.image_url as string
    expect(url).toMatch(/^https:\/\/images\.test\/events\/[0-9a-f-]+\/[0-9a-f-]{36}\.png$/)
    const [key] = [...store.objects.keys()]
    expect(store.objects.get(key!)).toEqual({ data: PNG, type: 'image/png' })
    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, id))
    expect(history.some((h) => (h.diff as Record<string, unknown>).image_key !== undefined)).toBe(true)
  })

  it('deletes the previous object after replacing', async () => {
    const id = await ownedEvent()
    await upload(id, PNG)
    const res = await upload(id, JPEG, ownerKey, 'image/jpeg')
    expect(res.statusCode).toBe(200)
    expect([...store.objects.keys()]).toHaveLength(1)
    expect([...store.objects.values()][0]!.type).toBe('image/jpeg')
    expect(res.json().data.image_url).toMatch(/\.jpg$/)
  })

  it('removes the image', async () => {
    const id = await ownedEvent()
    await upload(id, PNG)
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/events/${id}/image`, headers: auth(ownerKey) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.image_url).toBeNull()
    expect(store.objects.size).toBe(0)
  })

  it('refuses people who cannot edit the event', async () => {
    const id = await ownedEvent()
    expect((await upload(id, PNG, strangerKey)).statusCode).toBe(403)
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/events/${id}/image`, headers: auth(strangerKey) })
    expect(del.statusCode).toBe(403)
    expect((await app.inject({ method: 'PUT', url: `/api/v1/events/${id}/image`, payload: PNG, headers: { 'content-type': 'image/png' } })).statusCode).toBe(401)
    expect(store.objects.size).toBe(0)
  })

  it('answers 404 for an unknown event', async () => {
    expect((await upload('00000000-0000-4000-8000-000000000000', PNG)).statusCode).toBe(404)
  })

  it('checks the file signature, not the header', async () => {
    const id = await ownedEvent()
    const res = await upload(id, Buffer.from('<html>hi</html>'))
    expect(res.statusCode).toBe(415)
    expect(res.json().error.code).toBe('unsupported_media_type')
    const json = await app.inject({ method: 'PUT', url: `/api/v1/events/${id}/image`, headers: auth(ownerKey), payload: { a: 1 } })
    expect(json.statusCode).toBe(415)
  })

  it('refuses images above the size limit', async () => {
    const id = await ownedEvent()
    const big = Buffer.concat([PNG, Buffer.alloc(EVENT_IMAGE_MAX_BYTES + 1 - PNG.length)])
    expect((await upload(id, big)).statusCode).toBe(413)
  })

  it('answers 503 while images are off', async () => {
    imageStore.setStore(null)
    const id = await ownedEvent()
    const res = await upload(id, PNG)
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe('images_unavailable')
  })

  it('detaches the feed item of a synced event', async () => {
    const e = await newEvent()
    const [source] = await db
      .insert(ingestSources)
      .values({ slug: `image-src-${stamp}`, name: 'Image source', kind: 'ical', url: 'https://feed.test/x.ics', publisherId: owner.id })
      .returning()
    const [item] = await db
      .insert(ingestItems)
      .values({ sourceId: source!.id, externalId: 'x', status: 'accepted', draft: {}, raw: '', eventId: e.id })
      .returning()
    await db.update(publishers).set({ isScout: true }).where(eq(publishers.id, owner.id))
    try {
      expect((await upload(e.id, PNG)).statusCode).toBe(200)
    } finally {
      await db.update(publishers).set({ isScout: false }).where(eq(publishers.id, owner.id))
    }
    const [after] = await db.select().from(ingestItems).where(eq(ingestItems.id, item!.id))
    expect(after!.detachedAt).not.toBeNull()
  })
})
