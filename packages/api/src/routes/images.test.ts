import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq, inArray } from 'drizzle-orm'
import { editHistory, events, generateApiKey, publishers, type Publisher } from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'
import { imageStore, memoryImageStore } from '../images/store.js'

let app: FastifyInstance
let owner: Publisher
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
  const [p] = await db
    .insert(publishers)
    .values({ name: 'Image Owner', slug: `image-owner-${stamp}`, email: `image-owner-${stamp}@test.local`, verified: true, apiKeyHash: key.hash })
    .returning()
  owner = p!
})

beforeEach(() => imageStore.setStore(memoryImageStore()))
afterEach(() => imageStore.reset())

afterAll(async () => {
  await db.delete(editHistory).where(inArray(editHistory.publisherId, [owner.id]))
  await db.delete(events).where(eq(events.createdBy, owner.id))
  await db.delete(publishers).where(eq(publishers.id, owner.id))
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
