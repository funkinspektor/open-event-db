import type { FastifyInstance } from 'fastify'
import { and, asc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm'
import {
  checkSlugQuerySchema,
  organizerListQuerySchema,
  organizerUpdateSchema,
} from '@open-event-db/shared'
import { eventOrganizers, events, organizerMembers, organizers, venues, type Organizer } from '@open-event-db/db'
import { db } from '../db.js'
import { encodeCursor, decodeCursor } from '../cursor.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { currentAccount, requireAuth, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'
import { serializeSlimEvent, slimEventColumns } from '../queries/events.js'

interface OrganizerCursor extends Record<string, string> {
  name: string
  id: string
}

const write = { onRequest: requireAuth, config: { rateLimit: writeRateLimit } }

function serializeOrganizer(o: Organizer) {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    links: o.links,
    verified: o.verified,
    created_at: o.createdAt.toISOString(),
  }
}

function organizerSnapshot(o: Organizer): Record<string, unknown> {
  return { name: o.name, slug: o.slug, links: o.links }
}

export async function organizerRoutes(app: FastifyInstance) {
  app.get('/organizers/check-slug', async (req) => {
    const { slug } = checkSlugQuerySchema.parse(req.query)
    const [row] = await db
      .select({ exists: sql<boolean>`true` })
      .from(organizers)
      .where(eq(organizers.slug, slug))
      .limit(1)
    return { data: { available: !row } }
  })

  app.get('/organizers', async (req) => {
    const { limit, cursor, q } = organizerListQuerySchema.parse(req.query)

    const decoded = cursor ? decodeCursor<OrganizerCursor>(cursor) : null

    const conditions = [eq(organizers.verified, true)]
    if (q) conditions.push(ilike(organizers.name, `%${q}%`))
    if (decoded) {
      conditions.push(
        or(
          gt(organizers.name, decoded.name),
          and(eq(organizers.name, decoded.name), gt(organizers.id, decoded.id)),
        )!,
      )
    }

    const rows = await db
      .select()
      .from(organizers)
      .where(and(...conditions))
      .orderBy(asc(organizers.name), asc(organizers.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    const nextCursor = hasMore && last ? encodeCursor({ name: last.name, id: last.id }) : null

    return {
      data: page.map(serializeOrganizer),
      meta: { cursor: nextCursor, has_more: hasMore },
    }
  })

  app.get<{ Params: { slug: string } }>('/organizers/:slug', async (req) => {
    const { slug } = req.params

    const [organizer] = await db.select().from(organizers).where(eq(organizers.slug, slug)).limit(1)
    // Unverified organizers aren't public yet
    if (!organizer || !organizer.verified) throw notFound('Organizer not found')

    const organizedEventIds = db
      .select({ id: eventOrganizers.eventId })
      .from(eventOrganizers)
      .where(eq(eventOrganizers.organizerId, organizer.id))

    const upcoming = await db
      .select(slimEventColumns)
      .from(events)
      .leftJoin(venues, eq(events.venueId, venues.id))
      .where(
        and(
          inArray(events.id, organizedEventIds),
          sql`${events.status} IN ('scheduled','postponed')`,
          sql`${events.startsAt} >= now()`,
        ),
      )
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(20)

    return {
      data: {
        ...serializeOrganizer(organizer),
        upcoming_events: upcoming.map(serializeSlimEvent),
      },
    }
  })

  app.put<{ Params: { slug: string } }>('/organizers/:slug', write, async (req) => {
    const me = currentAccount(req)
    const body = organizerUpdateSchema.parse(req.body)

    const [organizer] = await db.select().from(organizers).where(eq(organizers.slug, req.params.slug)).limit(1)
    if (!organizer) throw notFound('Organizer not found')

    // Members edit their own profile whether or not the organizer is verified yet
    const [member] = await db
      .select({ accountId: organizerMembers.accountId })
      .from(organizerMembers)
      .where(and(eq(organizerMembers.organizerId, organizer.id), eq(organizerMembers.accountId, me.id)))
      .limit(1)
    if (!member) throw forbidden('You are not a member of this organizer', 'not_a_member')

    const patch: Partial<typeof organizers.$inferInsert> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.links !== undefined) patch.links = body.links
    if (body.slug !== undefined && body.slug !== organizer.slug) {
      const [taken] = await db
        .select({ id: organizers.id })
        .from(organizers)
        .where(eq(organizers.slug, body.slug))
        .limit(1)
      if (taken) throw badRequest('This slug is already taken', 'slug_taken')
      patch.slug = body.slug
    }
    if (Object.keys(patch).length === 0) return { data: serializeOrganizer(organizer) }

    const updated = await db.transaction(async (tx) => {
      const [o] = await tx
        .update(organizers)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(organizers.id, organizer.id))
        .returning()
      if (!o) throw new Error('update returned no row')
      await logEdit(tx, {
        entityType: 'organizer',
        entityId: organizer.id,
        accountId: me.id,
        action: 'updated',
        diff: diff(organizerSnapshot(organizer), organizerSnapshot(o)),
      })
      return o
    })

    return { data: serializeOrganizer(updated) }
  })
}
