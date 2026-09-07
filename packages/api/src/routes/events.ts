import type { FastifyInstance } from 'fastify'
import {
  and,
  arrayOverlaps,
  asc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lt,
  or,
  sql,
} from 'drizzle-orm'
import { eventListQuerySchema, type EventStatus } from '@open-event-db/shared'
import { eventOwners, events, publishers, venues } from '@open-event-db/db'
import { db } from '../db.js'
import { encodeCursor, decodeCursor } from '../cursor.js'
import { notFound } from '../errors.js'
import { serializeCoordinates } from '../serializers.js'

interface EventCursor extends Record<string, string> {
  starts_at: string
  id: string
}

export async function eventRoutes(app: FastifyInstance) {
  app.get('/events', async (req) => {
    const query = eventListQuerySchema.parse(req.query)
    const { limit, cursor, city, from, to, tags, venue_id, publisher_id, q } = query
    const status: EventStatus[] = query.status?.length
      ? query.status
      : ['scheduled', 'postponed']
    const decoded = cursor ? decodeCursor<EventCursor>(cursor) : null

    const conditions = [inArray(events.status, status)]

    if (from) conditions.push(gte(events.startsAt, from))
    else if (!to && !decoded) conditions.push(sql`${events.startsAt} >= now()`)
    if (to) conditions.push(lt(events.startsAt, to))
    if (city) conditions.push(eq(events.city, city))
    if (venue_id) conditions.push(eq(events.venueId, venue_id))
    if (q) conditions.push(ilike(events.title, `%${q}%`))
    if (tags?.length) conditions.push(arrayOverlaps(events.tags, tags))
    if (publisher_id) {
      const ownedIds = db
        .select({ id: eventOwners.eventId })
        .from(eventOwners)
        .where(eq(eventOwners.publisherId, publisher_id))
      conditions.push(inArray(events.id, ownedIds))
    }
    if (decoded) {
      const cursorDate = new Date(decoded.starts_at)
      conditions.push(
        or(
          gt(events.startsAt, cursorDate),
          and(eq(events.startsAt, cursorDate), gt(events.id, decoded.id)),
        )!,
      )
    }

    const rows = await db
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
        venueId: venues.id,
        venueName: venues.name,
        venueCity: venues.city,
      })
      .from(events)
      .leftJoin(venues, eq(events.venueId, venues.id))
      .where(and(...conditions))
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last
        ? encodeCursor({ starts_at: last.startsAt.toISOString(), id: last.id })
        : null

    return {
      data: page.map((r) => ({
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
        venue: r.venueId
          ? { id: r.venueId, name: r.venueName!, city: r.venueCity! }
          : null,
      })),
      meta: { cursor: nextCursor, has_more: hasMore },
    }
  })

  app.get<{ Params: { id: string } }>('/events/:id', async (req) => {
    const { id } = req.params

    const [row] = await db
      .select({
        event: events,
        venue: venues,
      })
      .from(events)
      .leftJoin(venues, eq(events.venueId, venues.id))
      .where(eq(events.id, id))
      .limit(1)

    if (!row) throw notFound('Event not found')

    const owners = await db
      .select({
        publisherId: eventOwners.publisherId,
        role: eventOwners.role,
        slug: publishers.slug,
        name: publishers.name,
      })
      .from(eventOwners)
      .innerJoin(publishers, eq(publishers.id, eventOwners.publisherId))
      .where(eq(eventOwners.eventId, id))

    const e = row.event
    const v = row.venue

    return {
      data: {
        id: e.id,
        title: e.title,
        description: e.description,
        starts_at: e.startsAt.toISOString(),
        ends_at: e.endsAt?.toISOString() ?? null,
        status: e.status,
        tags: e.tags,
        links: e.links,
        recurrence: e.recurrence,
        location_text: e.locationText,
        city: e.city,
        created_by: e.createdBy,
        created_at: e.createdAt.toISOString(),
        updated_at: e.updatedAt.toISOString(),
        venue: v
          ? {
              id: v.id,
              name: v.name,
              address: v.address,
              city: v.city,
              coordinates: serializeCoordinates(v.coordinates),
            }
          : null,
        owners: owners.map((o) => ({
          publisher_id: o.publisherId,
          slug: o.slug,
          name: o.name,
          role: o.role,
        })),
      },
    }
  })
}
