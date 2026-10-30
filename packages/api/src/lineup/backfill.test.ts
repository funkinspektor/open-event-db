import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { editHistory, events, ingestItems, ingestSources, publishers, type Publisher } from '@open-event-db/db'
import { db } from '../db.js'
import { backfillMarkdownLineups } from './backfill.js'

const stamp = Date.now()
let scout: Publisher
const ids: string[] = []
const sourceIds: string[] = []

async function newEvent(description: string, lineup: unknown[] = []) {
  const [e] = await db
    .insert(events)
    .values({
      title: `Backfill ${stamp}-${ids.length}`,
      description,
      lineup: lineup as never,
      startsAt: new Date('2031-09-01T20:00:00Z'),
      city: 'Berlin',
      locationText: 'Somewhere',
      createdBy: scout.id,
    })
    .returning()
  ids.push(e!.id)
  return e!
}

const row = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0]!

beforeAll(async () => {
  const [p] = await db
    .insert(publishers)
    .values({ name: 'Backfill Scout', slug: `backfill-${stamp}`, email: `backfill-${stamp}@test.local`, verified: true, isScout: true })
    .returning()
  scout = p!
})

afterAll(async () => {
  if (sourceIds.length) await db.delete(ingestSources).where(inArray(ingestSources.id, sourceIds))
  await db.delete(editHistory).where(inArray(editHistory.entityId, ids))
  await db.delete(events).where(inArray(events.id, ids))
  await db.delete(publishers).where(eq(publishers.id, scout.id))
})

describe('backfillMarkdownLineups', () => {
  it('lists what it would move without writing, then moves it and logs it once', async () => {
    const listed = await newEvent('A night.\n\n**Lineup**\n- NecroPhil\n- Frank Booth')
    const plain = await newEvent('**Tickets**\n- Presale 10€')
    const done = await newEvent('A night.\n\n**Lineup**\n- Someone', [{ name: null, acts: [{ name: 'Someone', time: null, live: false, note: null }] }])

    const dry = await backfillMarkdownLineups({ write: false, ids })
    expect(dry.map((c) => c.id)).toEqual([listed.id])
    expect(dry[0]).toMatchObject({ description: 'A night.', lineup: [{ name: null, acts: [{ name: 'NecroPhil' }, { name: 'Frank Booth' }] }] })
    expect((await row(listed.id)).lineup).toEqual([])

    await backfillMarkdownLineups({ write: true, ids })
    const moved = await row(listed.id)
    expect(moved.description).toBe('A night.')
    expect(moved.lineup.flatMap((g) => g.acts.map((a) => a.name))).toEqual(['NecroPhil', 'Frank Booth'])
    expect((await row(plain.id)).description).toBe('**Tickets**\n- Presale 10€')
    expect((await row(done.id)).description).toContain('**Lineup**')

    const history = await db.select().from(editHistory).where(eq(editHistory.entityId, listed.id))
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ action: 'updated', publisherId: scout.id })
    expect(history[0]!.diff).toMatchObject({ via: 'cli', description: { after: 'A night.' } })

    expect(await backfillMarkdownLineups({ write: false, ids })).toEqual([])
  })

  it('leaves events a feed keeps in sync to the feed', async () => {
    const synced = await newEvent('A night.\n\n**Lineup**\n- A')
    const [source] = await db
      .insert(ingestSources)
      .values({ slug: `backfill-src-${stamp}`, name: 'Backfill source', kind: 'ical', url: 'https://backfill.test/feed', publisherId: scout.id, config: {} })
      .returning()
    sourceIds.push(source!.id)
    await db.insert(ingestItems).values({
      sourceId: source!.id,
      externalId: 'x',
      draft: {},
      raw: '',
      status: 'accepted',
      eventId: synced.id,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    })
    expect(await backfillMarkdownLineups({ write: false, ids: [synced.id] })).toEqual([])
  })
})
