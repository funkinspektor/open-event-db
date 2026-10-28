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
  ingestItems,
  ingestSources,
  publishers,
  type Publisher,
} from '@open-event-db/db'
import { db } from '../db.js'
import { buildApp } from '../app.js'

let app: FastifyInstance
let scout: Publisher
let owner: Publisher
let creator: Publisher
let keyC: string
let keyS: string
let sourceId: string
const stamp = Date.now()

const auth = { authorization: '' }

async function syncedEvent(): Promise<{ eventId: string; itemId: string }> {
  const [event] = await db
    .insert(events)
    .values({
      title: `Synced ${stamp}`,
      startsAt: new Date('2030-01-01T20:00:00Z'),
      city: 'Testcity',
      createdBy: scout.id,
    })
    .returning()
  const [item] = await db
    .insert(ingestItems)
    .values({
      sourceId,
      externalId: `ext-${stamp}-${Math.random()}`,
      status: 'accepted',
      draft: { title: 'Synced' },
      raw: 'raw',
      eventId: event!.id,
    })
    .returning()
  return { eventId: event!.id, itemId: item!.id }
}

const cliPath = fileURLToPath(new URL('../../../db/src/cli.ts', import.meta.url))
const dbDir = fileURLToPath(new URL('../../../db', import.meta.url))

const detachedAt = async (itemId: string) =>
  (await db.select({ d: ingestItems.detachedAt }).from(ingestItems).where(eq(ingestItems.id, itemId)))[0]!.d

beforeAll(async () => {
  app = await buildApp({ logger: false })
  const sc = generateApiKey()
  keyS = sc.key
  auth.authorization = `Bearer ${keyS}`
  const [p] = await db
    .insert(publishers)
    .values({
      name: 'Detach Scout',
      slug: `detach-scout-${stamp}`,
      email: `detach-scout-${stamp}@test.local`,
      verified: true,
      isPublisher: false,
      isScout: true,
      apiKeyHash: sc.hash,
    })
    .returning()
  scout = p!
  const [o] = await db
    .insert(publishers)
    .values({
      name: 'Detach Owner',
      slug: `detach-owner-${stamp}`,
      email: `detach-owner-${stamp}@test.local`,
      verified: true,
    })
    .returning()
  owner = o!
  const cr = generateApiKey()
  keyC = cr.key
  const [c] = await db
    .insert(publishers)
    .values({
      name: 'Detach Creator',
      slug: `detach-creator-${stamp}`,
      email: `detach-creator-${stamp}@test.local`,
      verified: true,
      apiKeyHash: cr.hash,
    })
    .returning()
  creator = c!
  const [s] = await db
    .insert(ingestSources)
    .values({
      slug: `detach-src-${stamp}`,
      name: 'Detach source',
      kind: 'ical',
      url: 'https://example.test/feed.ics',
      publisherId: scout.id,
    })
    .returning()
  sourceId = s!.id
})

afterAll(async () => {
  await db.delete(ingestSources).where(eq(ingestSources.id, sourceId))
  await db.delete(editHistory).where(inArray(editHistory.publisherId, [scout.id]))
  await db.delete(events).where(inArray(events.createdBy, [scout.id, creator.id]))
  await db.delete(eventOwners).where(inArray(eventOwners.publisherId, [owner.id, creator.id]))
  await db.delete(editHistory).where(inArray(editHistory.publisherId, [owner.id, creator.id]))
  await db.delete(publishers).where(inArray(publishers.id, [scout.id, owner.id, creator.id]))
  await app.close()
})

describe('detach synced events', () => {
  it('detaches on PUT /events/:id', async () => {
    const { eventId, itemId } = await syncedEvent()
    expect(await detachedAt(itemId)).toBeNull()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth,
      payload: { title: 'Edited' },
    })
    expect(res.statusCode).toBe(200)
    expect(await detachedAt(itemId)).not.toBeNull()
  })

  it('detaches on DELETE /events/:id', async () => {
    const { eventId, itemId } = await syncedEvent()
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/events/${eventId}`, headers: auth })
    expect(res.statusCode).toBe(200)
    expect(await detachedAt(itemId)).not.toBeNull()
  })

  it('keeps the original detachedAt on a later edit', async () => {
    const { eventId, itemId } = await syncedEvent()
    const original = new Date('2030-02-02T10:00:00Z')
    await db.update(ingestItems).set({ detachedAt: original }).where(eq(ingestItems.id, itemId))
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/events/${eventId}`,
      headers: auth,
      payload: { title: 'Edited again' },
    })
    expect(res.statusCode).toBe(200)
    expect((await detachedAt(itemId))!.getTime()).toBe(original.getTime())
  })

  it('detaches on POST /events/:id/owners', async () => {
    // A claimed event whose item is still synced (e.g. claimed before detach existed)
    const { eventId, itemId } = await syncedEvent()
    await db.update(events).set({ createdBy: creator.id }).where(eq(events.id, eventId))
    await db.insert(eventOwners).values({ eventId, publisherId: creator.id, role: 'creator' })
    expect(await detachedAt(itemId)).toBeNull()

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventId}/owners`,
      headers: { authorization: `Bearer ${keyC}` },
      payload: { publisher_id: owner.id },
    })
    expect(res.statusCode).toBe(201)
    expect(await detachedAt(itemId)).not.toBeNull()
  })

  it('detaches on CLI claim-event', async () => {
    const { eventId, itemId } = await syncedEvent()
    execFileSync(process.execPath, ['--import', 'tsx', cliPath, 'claim-event', eventId, owner.slug], {
      cwd: dbDir,
      encoding: 'utf8',
    })
    expect(await detachedAt(itemId)).not.toBeNull()
  })
})
