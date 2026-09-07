import type { FastifyInstance } from 'fastify'
import { and, asc, eq, gt, ilike, or, sql } from 'drizzle-orm'
import { venueCreateSchema, venueListQuerySchema, venueUpdateSchema } from '@open-event-db/shared'
import { events, venues, type Venue as VenueRow } from '@open-event-db/db'
import { db } from '../db.js'
import { encodeCursor, decodeCursor } from '../cursor.js'
import { notFound } from '../errors.js'
import { serializeCoordinates } from '../serializers.js'
import { currentPublisher, requireAuth, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'

interface VenueCursor extends Record<string, string> {
  name: string
  id: string
}

const write = { onRequest: requireAuth, config: { rateLimit: writeRateLimit } }

function serializeVenue(v: VenueRow) {
  return {
    id: v.id,
    name: v.name,
    address: v.address,
    city: v.city,
    coordinates: serializeCoordinates(v.coordinates),
    links: v.links,
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
    const { limit, cursor, city, q } = venueListQuerySchema.parse(req.query)
    const decoded = cursor ? decodeCursor<VenueCursor>(cursor) : null

    const conditions = []
    if (city) conditions.push(eq(venues.city, city))
    if (q) conditions.push(ilike(venues.name, `%${q}%`))
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

    return {
      data: page.map(serializeVenue),
      meta: { cursor: nextCursor, has_more: hasMore },
    }
  })

  app.get<{ Params: { id: string } }>('/venues/:id', async (req) => {
    const { id } = req.params

    const [venue] = await db.select().from(venues).where(eq(venues.id, id)).limit(1)
    if (!venue) throw notFound('Venue not found')

    const upcoming = await db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        status: events.status,
        tags: events.tags,
        city: events.city,
        locationText: events.locationText,
        recurrence: events.recurrence,
      })
      .from(events)
      .where(
        and(
          eq(events.venueId, id),
          sql`${events.status} IN ('scheduled','postponed')`,
          sql`${events.startsAt} >= now()`,
        ),
      )
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(20)

    return {
      data: {
        ...serializeVenue(venue),
        upcoming_events: upcoming.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          starts_at: r.startsAt.toISOString(),
          ends_at: r.endsAt?.toISOString() ?? null,
          status: r.status,
          tags: r.tags,
          city: r.city,
          location_text: r.locationText,
          recurrence: r.recurrence,
          venue: { id: venue.id, name: venue.name, city: venue.city },
        })),
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
    if (Object.keys(patch).length === 0) return { data: serializeVenue(current) }

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

    return { data: serializeVenue(updated) }
  })
}
