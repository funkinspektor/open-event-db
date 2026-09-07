import type { FastifyInstance } from 'fastify'
import { and, asc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm'
import {
  checkSlugQuerySchema,
  publisherListQuerySchema,
  publisherUpdateSchema,
} from '@open-event-db/shared'
import {
  eventOwners,
  events,
  generateApiKey,
  publishers,
  venues,
  type Publisher,
} from '@open-event-db/db'
import { db } from '../db.js'
import { encodeCursor, decodeCursor } from '../cursor.js'
import { badRequest, notFound } from '../errors.js'
import { currentPublisher, requireAuth, requireSession, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'

interface PublisherCursor extends Record<string, string> {
  name: string
  id: string
}

const write = { onRequest: requireAuth, config: { rateLimit: writeRateLimit } }

function serializePublisher(p: Publisher) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    links: p.links,
    verified: p.verified,
    created_at: p.createdAt.toISOString(),
  }
}

function publisherSnapshot(p: Publisher): Record<string, unknown> {
  return { name: p.name, slug: p.slug, links: p.links }
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
      .select()
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
      data: page.map(serializePublisher),
      meta: { cursor: nextCursor, has_more: hasMore },
    }
  })

  app.put('/publishers/me', write, async (req) => {
    const me = currentPublisher(req)
    const body = publisherUpdateSchema.parse(req.body)

    const patch: Partial<typeof publishers.$inferInsert> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.links !== undefined) patch.links = body.links
    if (body.slug !== undefined && body.slug !== me.slug) {
      const [taken] = await db
        .select({ id: publishers.id })
        .from(publishers)
        .where(eq(publishers.slug, body.slug))
        .limit(1)
      if (taken) throw badRequest('This slug is already taken', 'slug_taken')
      patch.slug = body.slug
    }
    if (Object.keys(patch).length === 0) return { data: serializePublisher(me) }

    const updated = await db.transaction(async (tx) => {
      const [p] = await tx
        .update(publishers)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(publishers.id, me.id))
        .returning()
      if (!p) throw new Error('update returned no row')
      await logEdit(tx, {
        entityType: 'publisher',
        entityId: me.id,
        publisherId: me.id,
        action: 'updated',
        diff: diff(publisherSnapshot(me), publisherSnapshot(p)),
      })
      return p
    })

    return { data: serializePublisher(updated) }
  })

  app.post(
    '/publishers/me/api-key',
    { onRequest: requireSession, config: { rateLimit: writeRateLimit } },
    async (req, reply) => {
      const me = currentPublisher(req)
      const { key, hash } = generateApiKey()
      await db
        .update(publishers)
        .set({ apiKeyHash: hash, updatedAt: new Date() })
        .where(eq(publishers.id, me.id))
      reply.status(201)
      return { data: { api_key: key } }
    },
  )

  app.get<{ Params: { slug: string } }>('/publishers/:slug', async (req) => {
    const { slug } = req.params

    const [publisher] = await db.select().from(publishers).where(eq(publishers.slug, slug)).limit(1)
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
        ...serializePublisher(publisher),
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
