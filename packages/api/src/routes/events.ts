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
import {
  addOwnerSchema,
  eventCreateSchema,
  eventListQuerySchema,
  eventUpdateSchema,
  normalizeTags,
  type EventStatus,
} from '@open-event-db/shared'
import { eventOwners, events, publishers, venues } from '@open-event-db/db'
import { db } from '../db.js'
import { encodeCursor, decodeCursor } from '../cursor.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { currentPublisher, requireAuth, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'
import { eventSnapshot, getEventDetail, getOwnerIds, getOwnerRole } from '../queries/events.js'

interface EventCursor extends Record<string, string> {
  starts_at: string
  id: string
}

const write = { onRequest: requireAuth, config: { rateLimit: writeRateLimit } }

async function venueCity(venueId: string): Promise<string> {
  const [v] = await db.select({ city: venues.city }).from(venues).where(eq(venues.id, venueId)).limit(1)
  if (!v) throw badRequest('venue_id does not reference an existing venue')
  return v.city
}

async function loadEvent(id: string) {
  const [e] = await db.select().from(events).where(eq(events.id, id)).limit(1)
  if (!e) throw notFound('Event not found')
  return e
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
    const detail = await getEventDetail(req.params.id)
    if (!detail) throw notFound('Event not found')
    return { data: detail }
  })

  app.post('/events', write, async (req, reply) => {
    const me = currentPublisher(req)
    const body = eventCreateSchema.parse(req.body)

    const city = body.venue_id ? await venueCity(body.venue_id) : body.city
    if (!city) throw badRequest('city is required when no venue_id is provided')

    const startsAt = new Date(body.starts_at)
    const endsAt = body.ends_at ? new Date(body.ends_at) : null
    if (endsAt && endsAt <= startsAt) throw badRequest('ends_at must be after starts_at')

    const id = await db.transaction(async (tx) => {
      const [e] = await tx
        .insert(events)
        .values({
          title: body.title,
          description: body.description ?? '',
          startsAt,
          endsAt,
          venueId: body.venue_id ?? null,
          locationText: body.location_text ?? null,
          city,
          tags: normalizeTags(body.tags ?? []),
          links: body.links ?? {},
          recurrence: body.recurrence ?? null,
          createdBy: me.id,
        })
        .returning()
      if (!e) throw new Error('insert returned no row')
      await tx.insert(eventOwners).values({ eventId: e.id, publisherId: me.id, role: 'creator' })
      await logEdit(tx, {
        entityType: 'event',
        entityId: e.id,
        publisherId: me.id,
        action: 'created',
        diff: diff(null, eventSnapshot(e)),
      })
      return e.id
    })

    reply.status(201)
    return { data: await getEventDetail(id) }
  })

  app.put<{ Params: { id: string } }>('/events/:id', write, async (req) => {
    const me = currentPublisher(req)
    const body = eventUpdateSchema.parse(req.body)
    const current = await loadEvent(req.params.id)

    const role = await getOwnerRole(current.id, me.id)
    if (!role) throw forbidden('Only event owners can edit this event')
    if (body.status === 'cancelled' && role !== 'creator') {
      throw forbidden('Only the event creator can cancel an event')
    }

    const patch: Partial<typeof events.$inferInsert> = {}
    if (body.title !== undefined) patch.title = body.title
    if (body.description !== undefined) patch.description = body.description
    if (body.starts_at !== undefined) patch.startsAt = new Date(body.starts_at)
    if (body.ends_at !== undefined) patch.endsAt = body.ends_at ? new Date(body.ends_at) : null
    if (body.location_text !== undefined) patch.locationText = body.location_text
    if (body.tags !== undefined) patch.tags = normalizeTags(body.tags)
    if (body.links !== undefined) patch.links = body.links
    if (body.recurrence !== undefined) patch.recurrence = body.recurrence
    if (body.status !== undefined) patch.status = body.status

    if (body.venue_id !== undefined) {
      patch.venueId = body.venue_id
      if (body.venue_id) patch.city = await venueCity(body.venue_id)
      else if (body.city) patch.city = body.city
    } else if (body.city !== undefined && !current.venueId) {
      patch.city = body.city
    }

    const startsAt = patch.startsAt ?? current.startsAt
    const endsAt = patch.endsAt === undefined ? current.endsAt : patch.endsAt
    if (endsAt && endsAt <= startsAt) throw badRequest('ends_at must be after starts_at')

    if (Object.keys(patch).length === 0) return { data: await getEventDetail(current.id) }

    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(events)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(events.id, current.id))
        .returning()
      if (!updated) throw new Error('update returned no row')
      const cancelledNow = updated.status === 'cancelled' && current.status !== 'cancelled'
      await logEdit(tx, {
        entityType: 'event',
        entityId: current.id,
        publisherId: me.id,
        action: cancelledNow ? 'cancelled' : 'updated',
        diff: diff(eventSnapshot(current), eventSnapshot(updated)),
      })
    })

    return { data: await getEventDetail(current.id) }
  })

  app.delete<{ Params: { id: string } }>('/events/:id', write, async (req) => {
    const me = currentPublisher(req)
    const current = await loadEvent(req.params.id)

    const role = await getOwnerRole(current.id, me.id)
    if (role !== 'creator') throw forbidden('Only the event creator can cancel an event')

    if (current.status !== 'cancelled') {
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(events)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(events.id, current.id))
          .returning()
        if (!updated) throw new Error('update returned no row')
        await logEdit(tx, {
          entityType: 'event',
          entityId: current.id,
          publisherId: me.id,
          action: 'cancelled',
          diff: diff(eventSnapshot(current), eventSnapshot(updated)),
        })
      })
    }

    return { data: await getEventDetail(current.id) }
  })

  app.post<{ Params: { id: string } }>('/events/:id/owners', write, async (req, reply) => {
    const me = currentPublisher(req)
    const { publisher_id } = addOwnerSchema.parse(req.body)
    const current = await loadEvent(req.params.id)

    const role = await getOwnerRole(current.id, me.id)
    if (role !== 'creator') throw forbidden('Only the event creator can manage owners')

    const [target] = await db
      .select({ id: publishers.id, verified: publishers.verified })
      .from(publishers)
      .where(eq(publishers.id, publisher_id))
      .limit(1)
    if (!target) throw badRequest('publisher_id does not reference an existing publisher')
    if (!target.verified) throw badRequest('Publisher is not verified')

    const before = await getOwnerIds(current.id)
    if (before.includes(publisher_id)) throw badRequest('Publisher is already an owner of this event')

    await db.transaction(async (tx) => {
      await tx.insert(eventOwners).values({ eventId: current.id, publisherId: publisher_id, role: 'co_owner' })
      await logEdit(tx, {
        entityType: 'event',
        entityId: current.id,
        publisherId: me.id,
        action: 'ownership_changed',
        diff: { owners: { before, after: [...before, publisher_id] } },
      })
    })

    reply.status(201)
    return { data: await getEventDetail(current.id) }
  })

  app.delete<{ Params: { id: string; publisher_id: string } }>(
    '/events/:id/owners/:publisher_id',
    write,
    async (req) => {
      const me = currentPublisher(req)
      const current = await loadEvent(req.params.id)
      const target = req.params.publisher_id

      const role = await getOwnerRole(current.id, me.id)
      if (role !== 'creator') throw forbidden('Only the event creator can manage owners')

      const targetRole = await getOwnerRole(current.id, target)
      if (!targetRole) throw notFound('Publisher is not an owner of this event')
      if (targetRole === 'creator') throw badRequest('The creator cannot be removed from an event')

      const before = await getOwnerIds(current.id)
      await db.transaction(async (tx) => {
        await tx
          .delete(eventOwners)
          .where(and(eq(eventOwners.eventId, current.id), eq(eventOwners.publisherId, target)))
        await logEdit(tx, {
          entityType: 'event',
          entityId: current.id,
          publisherId: me.id,
          action: 'ownership_changed',
          diff: { owners: { before, after: before.filter((id) => id !== target) } },
        })
      })

      return { data: await getEventDetail(current.id) }
    },
  )
}
