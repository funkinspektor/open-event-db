import type { FastifyInstance, FastifyRequest } from 'fastify'
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import {
  ingestDraftSchema,
  ingestGoneSchema,
  ingestLinkSchema,
  ingestListQuerySchema,
  ingestRejectSchema,
  type IngestItemView,
} from '@open-event-db/shared'
import { events, ingestItems, ingestSources, venues } from '@open-event-db/db'
import { db } from '../db.js'
import { conflict, forbidden, notFound } from '../errors.js'
import { currentPublisher, requireAuth, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'
import { cancelEvent, eventSnapshot } from '../queries/events.js'
import { findDuplicateCandidates } from '../queries/duplicates.js'
import { detachIngest } from '../ingest/detach.js'

const read = { onRequest: requireAuth }
const write = { onRequest: requireAuth, config: { rateLimit: writeRateLimit } }

/** The inbox is shared by scouts only. Returns the acting scout. */
function requireScout(req: FastifyRequest) {
  const me = currentPublisher(req)
  if (!me.isScout) throw forbidden('Only scouts can use the inbox')
  return me
}

const draftStartsAt = sql`(${ingestItems.draft}->>'starts_at')::timestamptz`

const isNew = and(eq(ingestItems.status, 'pending'), isNull(ingestItems.goneAt))
// Accepted items that left their feed and still wait for a decision. Detached items (claimed, edited by a
// human or linked) are out: the event is no longer the feed's to cancel. An event cancelled elsewhere is settled.
const isGone = and(
  eq(ingestItems.status, 'accepted'),
  isNull(ingestItems.detachedAt),
  isNotNull(ingestItems.goneAt),
  isNull(ingestItems.goneResolvedAt),
  isNotNull(ingestItems.eventId),
  ne(events.status, 'cancelled'),
)

async function counts(): Promise<{ new: number; gone: number }> {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(ingestItems).where(isNew)
  const [g] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ingestItems)
    .innerJoin(events, eq(events.id, ingestItems.eventId))
    .where(isGone)
  return { new: n?.n ?? 0, gone: g?.n ?? 0 }
}

async function listItems(view: 'new' | 'gone'): Promise<IngestItemView[]> {
  const base = db
    .select({ item: ingestItems, source: { slug: ingestSources.slug, name: ingestSources.name } })
    .from(ingestItems)
    .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
  const rows =
    view === 'new'
      ? await base.where(isNew).orderBy(asc(draftStartsAt), asc(ingestItems.id))
      : await base
          .innerJoin(events, eq(events.id, ingestItems.eventId))
          .where(isGone)
          .orderBy(asc(draftStartsAt), asc(ingestItems.id))

  return Promise.all(
    rows.map(async ({ item, source }) => {
      const draft = ingestDraftSchema.parse(item.draft)
      const duplicates =
        view === 'new'
          ? await findDuplicateCandidates({
              venueId: draft.venue_id,
              locationText: draft.location_text,
              startsAt: new Date(draft.starts_at),
              endsAt: draft.ends_at ? new Date(draft.ends_at) : null,
              title: draft.title,
            })
          : []
      return {
        id: item.id,
        status: item.status,
        source,
        draft,
        gone_at: item.goneAt?.toISOString() ?? null,
        event_id: item.eventId,
        duplicates,
      }
    }),
  )
}

export async function ingestRoutes(app: FastifyInstance) {
  app.get('/ingest/items', read, async (req) => {
    requireScout(req)
    const { view } = ingestListQuerySchema.parse(req.query)
    const [data, itemCounts] = await Promise.all([listItems(view), counts()])
    return { data, meta: { counts: itemCounts } }
  })

  app.get('/ingest/count', read, async (req) => {
    requireScout(req)
    return { data: await counts() }
  })

  app.post<{ Params: { id: string } }>('/ingest/items/:id/accept', write, async (req) => {
    const me = requireScout(req)

    const eventId = await db.transaction(async (tx) => {
      // The status guard is the lock: of two concurrent accepts the second waits, then matches no row.
      const [item] = await tx
        .update(ingestItems)
        .set({ status: 'accepted', decidedBy: me.id, decidedAt: new Date() })
        .where(and(eq(ingestItems.id, req.params.id), eq(ingestItems.status, 'pending')))
        .returning()
      if (!item) {
        const [exists] = await tx.select({ id: ingestItems.id }).from(ingestItems).where(eq(ingestItems.id, req.params.id))
        if (!exists) throw notFound('Inbox item not found')
        throw conflict('Item has already been decided')
      }

      const [source] = await tx.select().from(ingestSources).where(eq(ingestSources.id, item.sourceId))
      if (!source) throw new Error('ingest item without source')
      const draft = ingestDraftSchema.parse(item.draft)

      let venueId = draft.venue_id
      let city = draft.city
      let locationText = draft.location_text
      if (venueId) {
        const [venue] = await tx.select({ city: venues.city }).from(venues).where(eq(venues.id, venueId))
        if (venue) city = venue.city
        else {
          // The mapped venue was deleted since the run: keep a readable place.
          venueId = null
          locationText = draft.location_text ?? source.name
        }
      }

      // Created by the source's scout and left unclaimed: no owner row
      const [event] = await tx
        .insert(events)
        .values({
          title: draft.title,
          description: draft.description,
          startsAt: new Date(draft.starts_at),
          endsAt: draft.ends_at ? new Date(draft.ends_at) : null,
          venueId,
          locationText,
          city,
          tags: [],
          links: draft.links,
          createdBy: source.publisherId,
        })
        .returning()
      if (!event) throw new Error('insert returned no row')
      await logEdit(tx, {
        entityType: 'event',
        entityId: event.id,
        publisherId: me.id,
        action: 'created',
        diff: { ...diff(null, eventSnapshot(event)), via: 'ingest' },
      })
      await tx.update(ingestItems).set({ eventId: event.id }).where(eq(ingestItems.id, item.id))
      return event.id
    })

    return { data: { event_id: eventId } }
  })

  // Static path: registered next to '/ingest/items/:id/*'; find-my-way prefers the static segment
  app.post('/ingest/items/reject', write, async (req) => {
    const me = requireScout(req)
    const { ids } = ingestRejectSchema.parse(req.body)
    const rejected = await db
      .update(ingestItems)
      .set({ status: 'rejected', decidedBy: me.id, decidedAt: new Date() })
      .where(and(inArray(ingestItems.id, ids), eq(ingestItems.status, 'pending')))
      .returning({ id: ingestItems.id })
    return { data: { rejected: rejected.length } }
  })

  app.post<{ Params: { id: string } }>('/ingest/items/:id/link', write, async (req) => {
    const me = requireScout(req)
    const { event_id } = ingestLinkSchema.parse(req.body)

    await db.transaction(async (tx) => {
      // Event first, then items: the lock order of PUT/DELETE /events/:id and the sync run
      const [target] = await tx.select({ id: events.id }).from(events).where(eq(events.id, event_id)).for('update')
      if (!target) throw notFound('Event not found')
      // An item the event was synced from (re-posted under a new id) must not later offer it as gone
      await detachIngest(tx, event_id)
      // Detached from the start: the linked event is a human's, the feed must not overwrite it
      const [item] = await tx
        .update(ingestItems)
        .set({ status: 'accepted', eventId: event_id, detachedAt: new Date(), decidedBy: me.id, decidedAt: new Date() })
        .where(and(eq(ingestItems.id, req.params.id), eq(ingestItems.status, 'pending')))
        .returning({ id: ingestItems.id })
      if (item) return
      const [exists] = await tx.select({ id: ingestItems.id }).from(ingestItems).where(eq(ingestItems.id, req.params.id))
      if (!exists) throw notFound('Inbox item not found')
      throw conflict('Item has already been decided')
    })

    return { data: { event_id } }
  })

  app.post<{ Params: { id: string } }>('/ingest/items/:id/gone', write, async (req) => {
    const me = requireScout(req)
    const { action } = ingestGoneSchema.parse(req.body)

    await db.transaction(async (tx) => {
      const [found] = await tx
        .select({ eventId: ingestItems.eventId })
        .from(ingestItems)
        .where(eq(ingestItems.id, req.params.id))
      if (!found) throw notFound('Inbox item not found')
      if (!found.eventId) throw conflict('Item is not gone from its source')

      // Event first, then item: the lock order of PUT/DELETE /events/:id and the sync run
      const [event] = await tx.select().from(events).where(eq(events.id, found.eventId)).for('update')
      const [item] = await tx.select().from(ingestItems).where(eq(ingestItems.id, req.params.id)).for('update')
      // The same conditions as the Gone view, checked under the locks so a detach committed meanwhile counts
      if (
        !event ||
        !item ||
        item.status !== 'accepted' ||
        item.detachedAt ||
        !item.goneAt ||
        item.goneResolvedAt ||
        event.status === 'cancelled'
      ) {
        throw conflict('Item is not gone from its source')
      }

      if (action === 'cancel') await cancelEvent(tx, event, me.id)
      else await tx.update(ingestItems).set({ goneResolvedAt: new Date() }).where(eq(ingestItems.id, item.id))
    })

    return { data: { ok: true } }
  })
}
