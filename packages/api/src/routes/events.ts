import type { FastifyInstance } from 'fastify'
import {
  and,
  arrayOverlaps,
  asc,
  desc,
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
  canCancel,
  canEdit,
  canManageOwners,
  duplicateQuerySchema,
  EVENT_IMAGE_MAX_BYTES,
  EXTRACT_IMAGE_TYPES,
  eventCreateSchema,
  eventDaySchema,
  eventListQuerySchema,
  eventUpdateSchema,
  normalizeCategories,
  normalizeTags,
  type EventStatus,
} from '@open-event-db/shared'
import { eventOwners, events, publishers, venues, type Publisher } from '@open-event-db/db'
import { db } from '../db.js'
import { encodeCursor, decodeCursor } from '../cursor.js'
import { ApiError, badRequest, forbidden, notFound } from '../errors.js'
import { currentPublisher, requireAuth, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'
import { detachIngest } from '../ingest/detach.js'
import { calendarDay } from '../ingest/normalize.js'
import { berlinInstant } from '../extract/normalize.js'
import { findDuplicateCandidates } from '../queries/duplicates.js'
import { replaceEventImage } from '../images/events.js'
import { sniffImageType } from '../images/sniff.js'
import { imageStore } from '../images/store.js'
import {
  cancelEvent,
  eventSnapshot,
  getEventDetail,
  getOwners,
  serializeSlimEvent,
  slimEventColumns,
} from '../queries/events.js'

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
  return { ...e, owners: await getOwners(e.id) }
}

/** `starts_at` from a write: a timestamp, or a bare day (stored as 00:00 Berlin) when the start time isn't known. */
function startOf(value: string): { startsAt: Date; startTimeKnown: boolean } {
  if (!eventDaySchema.safeParse(value).success) return { startsAt: new Date(value), startTimeKnown: true }
  return { startsAt: berlinInstant(calendarDay(value), 0), startTimeKnown: false }
}

const actor = (p: Publisher) => ({ id: p.id, is_scout: p.isScout })

/** The event, if `me` may edit it; the same rule and messages as PUT /events/:id. */
async function editableEvent(id: string, me: Publisher) {
  const current = await loadEvent(id)
  if (!canEdit(current, actor(me))) {
    throw forbidden(current.owners.length ? 'Only event owners can edit this event' : 'Only scouts can edit unclaimed events')
  }
  return current
}

const imagesUnavailable = () => new ApiError(503, 'images_unavailable', 'Event images are not available right now')

export async function eventRoutes(app: FastifyInstance) {
  // Image uploads arrive as the raw body; the signature, not this header, decides what they are
  app.addContentTypeParser(
    [...EXTRACT_IMAGE_TYPES],
    { parseAs: 'buffer', bodyLimit: EVENT_IMAGE_MAX_BYTES },
    (_req, body, done) => done(null, body),
  )

  app.get('/events', async (req) => {
    const query = eventListQuerySchema.parse(req.query)
    const { limit, cursor, city, from, to, tags, categories, venue_id, publisher_id, added_by, q, order } = query
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
    if (categories?.length) conditions.push(arrayOverlaps(events.categories, categories))
    if (publisher_id) {
      const ownedIds = db
        .select({ id: eventOwners.eventId })
        .from(eventOwners)
        .where(eq(eventOwners.publisherId, publisher_id))
      conditions.push(inArray(events.id, ownedIds))
    }
    if (added_by) conditions.push(eq(events.createdBy, added_by))
    if (decoded) {
      const cursorDate = new Date(decoded.starts_at)
      const after = order === 'desc' ? lt : gt
      conditions.push(
        or(
          after(events.startsAt, cursorDate),
          and(eq(events.startsAt, cursorDate), after(events.id, decoded.id)),
        )!,
      )
    }

    const rows = await db
      .select(slimEventColumns)
      .from(events)
      .leftJoin(venues, eq(events.venueId, venues.id))
      .where(and(...conditions))
      .orderBy(...(order === 'desc' ? [desc(events.startsAt), desc(events.id)] : [asc(events.startsAt), asc(events.id)]))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page[page.length - 1]
    const nextCursor =
      hasMore && last
        ? encodeCursor({ starts_at: last.startsAt.toISOString(), id: last.id })
        : null

    return {
      data: page.map(serializeSlimEvent),
      meta: { cursor: nextCursor, has_more: hasMore },
    }
  })

  // Static path: must stay registered before '/events/:id'
  app.get('/events/duplicates', async (req) => {
    const q = duplicateQuerySchema.parse(req.query)
    const data = await findDuplicateCandidates({
      venueId: q.venue_id,
      locationText: q.location_text,
      startsAt: new Date(q.starts_at),
      endsAt: q.ends_at ? new Date(q.ends_at) : null,
      title: q.title,
      excludeId: q.exclude_id,
    })
    return { data }
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

    const { startsAt, startTimeKnown } = startOf(body.starts_at)
    const endsAt = body.ends_at ? new Date(body.ends_at) : null
    if (endsAt && endsAt <= startsAt) throw badRequest('ends_at must be after starts_at')

    const id = await db.transaction(async (tx) => {
      const [e] = await tx
        .insert(events)
        .values({
          title: body.title,
          description: body.description ?? '',
          startsAt,
          startTimeKnown,
          endsAt,
          venueId: body.venue_id ?? null,
          locationText: body.location_text ?? null,
          city,
          categories: normalizeCategories(body.categories ?? []),
          tags: normalizeTags(body.tags ?? []),
          links: body.links ?? {},
          recurrence: body.recurrence ?? null,
          createdBy: me.id,
        })
        .returning()
      if (!e) throw new Error('insert returned no row')
      // Scouts (is_publisher = false) add events on behalf of organizers: no owner until claimed
      if (me.isPublisher) {
        await tx.insert(eventOwners).values({ eventId: e.id, publisherId: me.id, role: 'creator' })
      }
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
    const current = await editableEvent(req.params.id, me)
    if (body.status === 'cancelled' && !canCancel(current, actor(me))) {
      throw forbidden('Only the event creator can cancel an event')
    }

    const patch: Partial<typeof events.$inferInsert> = {}
    if (body.title !== undefined) patch.title = body.title
    if (body.description !== undefined) patch.description = body.description
    if (body.starts_at !== undefined) Object.assign(patch, startOf(body.starts_at))
    if (body.ends_at !== undefined) patch.endsAt = body.ends_at ? new Date(body.ends_at) : null
    if (body.location_text !== undefined) patch.locationText = body.location_text
    if (body.categories !== undefined) patch.categories = normalizeCategories(body.categories)
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
      await detachIngest(tx, current.id)
    })

    return { data: await getEventDetail(current.id) }
  })

  app.put<{ Params: { id: string } }>('/events/:id/image', { ...write, bodyLimit: EVENT_IMAGE_MAX_BYTES }, async (req) => {
    const me = currentPublisher(req)
    const current = await editableEvent(req.params.id, me)
    if (!imageStore.store) throw imagesUnavailable()
    const type = Buffer.isBuffer(req.body) ? sniffImageType(req.body) : null
    if (!type) throw new ApiError(415, 'unsupported_media_type', 'Send one PNG, JPEG or WEBP image as the request body')
    await replaceEventImage(current.id, { data: req.body as Buffer, type }, { publisherId: me.id, detach: true })
    return { data: await getEventDetail(current.id) }
  })

  app.delete<{ Params: { id: string } }>('/events/:id/image', write, async (req) => {
    const me = currentPublisher(req)
    const current = await editableEvent(req.params.id, me)
    if (!imageStore.store) throw imagesUnavailable()
    await replaceEventImage(current.id, null, { publisherId: me.id, detach: true })
    return { data: await getEventDetail(current.id) }
  })

  app.delete<{ Params: { id: string } }>('/events/:id', write, async (req) => {
    const me = currentPublisher(req)
    const current = await loadEvent(req.params.id)

    if (!canCancel(current, actor(me))) {
      throw forbidden(
        current.owners.length
          ? 'Only the event creator can cancel an event'
          : 'Only scouts can cancel unclaimed events',
      )
    }

    await db.transaction((tx) => cancelEvent(tx, current, me.id))

    return { data: await getEventDetail(current.id) }
  })

  app.post<{ Params: { id: string } }>('/events/:id/owners', write, async (req, reply) => {
    const me = currentPublisher(req)
    const { publisher_id } = addOwnerSchema.parse(req.body)
    const current = await loadEvent(req.params.id)

    if (!canManageOwners(current, actor(me))) {
      throw forbidden('Only the event creator can manage owners')
    }

    const [target] = await db
      .select({ id: publishers.id, verified: publishers.verified, isPublisher: publishers.isPublisher })
      .from(publishers)
      .where(eq(publishers.id, publisher_id))
      .limit(1)
    if (!target) throw badRequest('publisher_id does not reference an existing publisher')
    if (!target.verified) throw badRequest('Publisher is not verified')
    if (!target.isPublisher) throw badRequest('Scouts cannot own events')

    const before = current.owners.map((o) => o.publisher_id)
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
      await detachIngest(tx, current.id)
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

      if (!canManageOwners(current, actor(me))) {
        throw forbidden('Only the event creator can manage owners')
      }

      const targetRole = current.owners.find((o) => o.publisher_id === target)?.role
      if (!targetRole) throw notFound('Publisher is not an owner of this event')
      if (targetRole === 'creator') throw badRequest('The creator cannot be removed from an event')

      const before = current.owners.map((o) => o.publisher_id)
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
