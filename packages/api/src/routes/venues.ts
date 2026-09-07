import type { FastifyInstance } from 'fastify'
import { and, asc, eq, gt, ilike, or, sql } from 'drizzle-orm'
import { venueListQuerySchema } from '@open-event-db/shared'
import { events, venues } from '@open-event-db/db'
import { db } from '../db.js'
import { encodeCursor, decodeCursor } from '../cursor.js'
import { notFound } from '../errors.js'
import { serializeCoordinates } from '../serializers.js'

interface VenueCursor extends Record<string, string> {
  name: string
  id: string
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
      data: page.map((v) => ({
        id: v.id,
        name: v.name,
        address: v.address,
        city: v.city,
        coordinates: serializeCoordinates(v.coordinates),
        links: v.links,
        created_at: v.createdAt.toISOString(),
        updated_at: v.updatedAt.toISOString(),
      })),
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
        id: venue.id,
        name: venue.name,
        address: venue.address,
        city: venue.city,
        coordinates: serializeCoordinates(venue.coordinates),
        links: venue.links,
        created_at: venue.createdAt.toISOString(),
        updated_at: venue.updatedAt.toISOString(),
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
}
