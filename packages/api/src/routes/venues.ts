import type { FastifyInstance } from 'fastify'
import { and, asc, eq, gt, ilike, inArray, not, or, sql } from 'drizzle-orm'
import { venueCreateSchema, venueListQuerySchema, venueUpdateSchema } from '@open-event-db/shared'
import { events, ingestSources, venues, type Venue as VenueRow } from '@open-event-db/db'
import { db } from '../db.js'
import { encodeCursor, decodeCursor } from '../cursor.js'
import { notFound } from '../errors.js'
import { serializeCoordinates } from '../serializers.js'
import { currentPublisher, requireAuth, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'
import { serializeSlimEvent, slimEventColumns } from '../queries/events.js'

interface VenueCursor extends Record<string, string> {
  name: string
  id: string
}

const write = { onRequest: requireAuth, config: { rateLimit: writeRateLimit } }

interface VenueFeed {
  slug: string
  name: string
}

// A source carries a venue when it is linked to it or maps one of its feed locations to it
const carriesVenue = sql`(
  ${ingestSources.venueId} = ${venues.id}
  OR EXISTS (SELECT 1 FROM jsonb_each_text(${ingestSources.config} -> 'venues') m WHERE m.value = ${venues.id}::text)
)`

const hasFeed = sql`EXISTS (SELECT 1 FROM ${ingestSources} WHERE ${ingestSources.enabled} AND ${carriesVenue})`

/** The enabled feed sources carrying each of the given venues, by venue id. */
async function feedsOf(venueIds: string[]): Promise<Map<string, VenueFeed[]>> {
  const byVenue = new Map<string, VenueFeed[]>()
  if (venueIds.length === 0) return byVenue
  const rows = await db
    .select({ venueId: venues.id, slug: ingestSources.slug, name: ingestSources.name })
    .from(venues)
    .innerJoin(ingestSources, and(eq(ingestSources.enabled, true), carriesVenue))
    .where(inArray(venues.id, venueIds))
    .orderBy(asc(ingestSources.slug))
  for (const { venueId, ...feed } of rows) byVenue.set(venueId, [...(byVenue.get(venueId) ?? []), feed])
  return byVenue
}

function serializeVenue(v: VenueRow, feeds: VenueFeed[] = []) {
  return {
    id: v.id,
    name: v.name,
    address: v.address,
    city: v.city,
    coordinates: serializeCoordinates(v.coordinates),
    links: v.links,
    feeds,
    created_at: v.createdAt.toISOString(),
    updated_at: v.updatedAt.toISOString(),
  }
}

function venueSnapshot(v: VenueRow): Record<string, unknown> {
  return {
    name: v.name,
    address: v.address,
    city: v.city,
    coordinates: serializeCoordinates(v.coordinates),
    links: v.links,
  }
}

export async function venueRoutes(app: FastifyInstance) {
  app.get('/venues', async (req) => {
    const { limit, cursor, city, q, feed } = venueListQuerySchema.parse(req.query)
    const decoded = cursor ? decodeCursor<VenueCursor>(cursor) : null

    const conditions = []
    if (city) conditions.push(eq(venues.city, city))
    if (q) conditions.push(ilike(venues.name, `%${q}%`))
    if (feed === 'any') conditions.push(hasFeed)
    if (feed === 'none') conditions.push(not(hasFeed))
    if (decoded) {
      conditions.push(
        or(
          gt(venues.name, decoded.name),
          and(eq(venues.name, decoded.name), gt(venues.id, decoded.id)),
        )!,
      )
    }

    const rows = await db
      .select()
      .from(venues)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(venues.name), asc(venues.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last ? encodeCursor({ name: last.name, id: last.id }) : null

    const feeds = await feedsOf(page.map((v) => v.id))
    return {
      data: page.map((v) => serializeVenue(v, feeds.get(v.id))),
      meta: { cursor: nextCursor, has_more: hasMore },
    }
  })

  app.get<{ Params: { id: string } }>('/venues/:id', async (req) => {
    const { id } = req.params

    const [venue] = await db.select().from(venues).where(eq(venues.id, id)).limit(1)
    if (!venue) throw notFound('Venue not found')

    const [upcoming, feeds] = await Promise.all([
      db
        .select(slimEventColumns)
        .from(events)
        .leftJoin(venues, eq(events.venueId, venues.id))
        .where(
          and(
            eq(events.venueId, id),
            sql`${events.status} IN ('scheduled','postponed')`,
            sql`${events.startsAt} >= now()`,
          ),
        )
        .orderBy(asc(events.startsAt), asc(events.id))
        .limit(20),
      feedsOf([id]),
    ])

    return {
      data: {
        ...serializeVenue(venue, feeds.get(id)),
        upcoming_events: upcoming.map(serializeSlimEvent),
      },
    }
  })

  app.post('/venues', write, async (req, reply) => {
    const me = currentPublisher(req)
    const body = venueCreateSchema.parse(req.body)

    const venue = await db.transaction(async (tx) => {
      const [v] = await tx
        .insert(venues)
        .values({
          name: body.name,
          address: body.address,
          city: body.city,
          coordinates: [body.coordinates.lng, body.coordinates.lat],
          links: body.links ?? {},
        })
        .returning()
      if (!v) throw new Error('insert returned no row')
      await logEdit(tx, {
        entityType: 'venue',
        entityId: v.id,
        publisherId: me.id,
        action: 'created',
        diff: diff(null, venueSnapshot(v)),
      })
      return v
    })

    reply.status(201)
    return { data: serializeVenue(venue) }
  })

  app.put<{ Params: { id: string } }>('/venues/:id', write, async (req) => {
    const me = currentPublisher(req)
    const body = venueUpdateSchema.parse(req.body)

    const [current] = await db.select().from(venues).where(eq(venues.id, req.params.id)).limit(1)
    if (!current) throw notFound('Venue not found')

    const patch: Partial<typeof venues.$inferInsert> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.address !== undefined) patch.address = body.address
    if (body.city !== undefined) patch.city = body.city
    if (body.links !== undefined) patch.links = body.links
    if (body.coordinates !== undefined) {
      patch.coordinates = [body.coordinates.lng, body.coordinates.lat]
    }
    if (Object.keys(patch).length === 0) {
      const feeds = await feedsOf([current.id])
      return { data: serializeVenue(current, feeds.get(current.id)) }
    }

    const updated = await db.transaction(async (tx) => {
      const [v] = await tx
        .update(venues)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(venues.id, current.id))
        .returning()
      if (!v) throw new Error('update returned no row')
      await logEdit(tx, {
        entityType: 'venue',
        entityId: v.id,
        publisherId: me.id,
        action: 'updated',
        diff: diff(venueSnapshot(current), venueSnapshot(v)),
      })
      return v
    })

    const feeds = await feedsOf([updated.id])
    return { data: serializeVenue(updated, feeds.get(updated.id)) }
  })
}
