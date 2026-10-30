import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { ingestItems, ingestSources, publishers, type IngestSource, type Publisher } from '@open-event-db/db'
import { db } from '../db.js'

const stamp = Date.now()
let scout: Publisher
let source: IngestSource

beforeAll(async () => {
  const [p] = await db
    .insert(publishers)
    .values({
      name: 'Ingest Schema Scout',
      slug: `ingest-schema-scout-${stamp}`,
      email: `ingest-schema-scout-${stamp}@test.local`,
      verified: true,
      isPublisher: false,
      isScout: true,
    })
    .returning()
  scout = p!
  const [s] = await db
    .insert(ingestSources)
    .values({
      slug: `ingest-schema-${stamp}`,
      name: 'Schema test source',
      kind: 'ical',
      url: 'https://example.test/feed.ics',
      publisherId: scout.id,
    })
    .returning()
  source = s!
})

afterAll(async () => {
  // items cascade with their source
  await db.delete(ingestSources).where(eq(ingestSources.id, source.id))
  await db.delete(publishers).where(eq(publishers.id, scout.id))
})

describe('ingest schema', () => {
  it('applies defaults and enforces one item per (source, externalId)', async () => {
    expect(source.enabled).toBe(true)
    expect(source.config).toEqual({})

    const values = { sourceId: source.id, externalId: 'uid-1', draft: { title: 'A' }, raw: 'BEGIN:VEVENT' }
    const [item] = await db.insert(ingestItems).values(values).returning()
    expect(item!.status).toBe('pending')
    expect(item!.contentHash).toBeNull()
    expect(item!.eventId).toBeNull()

    await expect(db.insert(ingestItems).values(values)).rejects.toThrow()
  })

  it('stores a fit verdict and defaults had_duplicates to false', async () => {
    const [item] = await db
      .insert(ingestItems)
      .values({ sourceId: source.id, externalId: 'uid-fit', draft: { title: 'F' }, raw: 'BEGIN:VEVENT' })
      .returning()
    expect(item!.hadDuplicates).toBe(false)
    expect(item!.fitVerdict).toBeNull()

    const fit = { fitVerdict: 'no' as const, fitReason: 'Indie night', fitScoredAt: new Date(), fitFingerprint: 'x' }
    await db.update(ingestItems).set(fit).where(eq(ingestItems.id, item!.id))
    const [read] = await db.select().from(ingestItems).where(eq(ingestItems.id, item!.id))
    expect(read).toMatchObject(fit)

    await expect(
      db
        .update(ingestItems)
        .set({ fitVerdict: 'nope' as never })
        .where(eq(ingestItems.id, item!.id)),
    ).rejects.toThrow()
  })

  it('has pg_trgm available', async () => {
    const rows = await db.execute<{ s: number }>(sql`SELECT similarity('Burre', 'Burre w/ Heavenphetamine') AS s`)
    expect(Number(rows[0]!.s)).toBeGreaterThan(0)
  })
})
