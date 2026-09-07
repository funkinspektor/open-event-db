import type { FastifyInstance } from 'fastify'
import { and, asc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm'
import {
  checkSlugQuerySchema,
  publisherListQuerySchema,
} from '@open-event-db/shared'
import { eventOwners, events, publishers, venues } from '@open-event-db/db'
import { db } from '../db.js'
import { encodeCursor, decodeCursor } from '../cursor.js'
import { notFound } from '../errors.js'

interface PublisherCursor extends Record<string, string> {
  name: string
  id: string
}

export async function publisherRoutes(app: FastifyInstance) {
  app.get('/publishers/check-slug', async (req) => {
    const { slug } = checkSlugQuerySchema.parse(req.query)
    const [row] = await db
      .select({ exists: sql<boolean>`true` })
      .from(publishers)
      .where(eq(publishers.slug, slug))
      .limit(1)
    return { data: { available: !row } }
  })

  app.get('/publishers', async (req) => {
    const { limit, cursor, q } = publisherListQuerySchema.parse(req.query)

    const decoded = cursor ? decodeCursor<PublisherCursor>(cursor) : null

    const conditions = [eq(publishers.verified, true)]
    if (q) conditions.push(ilike(publishers.name, `%${q}%`))
    if (decoded) {
      conditions.push(
        or(
          gt(publishers.name, decoded.name),
          and(eq(publishers.name, decoded.name), gt(publishers.id, decoded.id)),
        )!,
      )
    }

    const rows = await db
      .select({
        id: publishers.id,
        name: publishers.name,
        slug: publishers.slug,
        links: publishers.links,
        verified: publishers.verified,
        createdAt: publishers.createdAt,
      })
      .from(publishers)
      .where(and(...conditions))
      .orderBy(asc(publishers.name), asc(publishers.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last ? encodeCursor({ name: last.name, id: last.id }) : null

    return {
      data: page.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        links: p.links,
        verified: p.verified,
        created_at: p.createdAt.toISOString(),
      })),
      meta: { cursor: nextCursor, has_more: hasMore },
    }
  })

  app.get<{ Params: { slug: string } }>('/publishers/:slug', async (req) => {
    const { slug } = req.params

    const [publisher] = await db
      .select({
        id: publishers.id,
        name: publishers.name,
        slug: publishers.slug,
        links: publishers.links,
        verified: publishers.verified,
        createdAt: publishers.createdAt,
      })
      .from(publishers)
      .where(eq(publishers.slug, slug))
      .limit(1)

    if (!publisher) throw notFound('Publisher not found')

    const ownedEventIds = db
      .select({ id: eventOwners.eventId })
      .from(eventOwners)
      .where(eq(eventOwners.publisherId, publisher.id))

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
        venueId: venues.id,
        venueName: venues.name,
        venueCity: venues.city,
      })
      .from(events)
      .leftJoin(venues, eq(events.venueId, venues.id))
      .where(
        and(
          inArray(events.id, ownedEventIds),
          sql`${events.status} IN ('scheduled','postponed')`,
          sql`${events.startsAt} >= now()`,
        ),
      )
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(20)

    return {
      data: {
        id: publisher.id,
        name: publisher.name,
        slug: publisher.slug,
        links: publisher.links,
        verified: publisher.verified,
        created_at: publisher.createdAt.toISOString(),
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
          venue: r.venueId
            ? { id: r.venueId, name: r.venueName!, city: r.venueCity! }
            : null,
        })),
      },
    }
  })
}
