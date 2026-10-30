import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import {
  canEdit,
  INGEST_SYNCED_FIELDS,
  SYNCED_LINK,
  ingestDraftSchema,
  ingestGoneSchema,
  ingestLinkSchema,
  ingestListQuerySchema,
  ingestRejectSchema,
  type IngestAccuracyRow,
  type IngestDraft,
  type IngestItemDetail,
  type IngestItemState,
  type IngestItemView,
  type IngestSourceCount,
  type IngestView,
} from '@open-event-db/shared'
import { events, ingestItems, ingestSources, venues, type IngestItem } from '@open-event-db/db'
import { db } from '../db.js'
import { decodeCursor, encodeCursor } from '../cursor.js'
import { badRequest, conflict, forbidden, notFound } from '../errors.js'
import { currentPublisher, requireAuth, writeRateLimit } from '../auth.js'
import { diff, logEdit } from '../history.js'
import { cancelEvent, eventSnapshot, getOwners } from '../queries/events.js'
import { findDuplicateCandidates } from '../queries/duplicates.js'
import { detachIngest } from '../ingest/detach.js'
import { copyItemImage, syncItemImage } from '../ingest/image.js'
import { mergePatch } from '../ingest/merge.js'
import { draftStartsAt, isOpen, notOver } from '../ingest/open.js'
import { serializeCoordinates } from '../serializers.js'

const read = { onRequest: requireAuth }
const write = { onRequest: requireAuth, config: { rateLimit: writeRateLimit } }

/** The inbox is shared by scouts only. Returns the acting scout. */
function requireScout(req: FastifyRequest) {
  const me = currentPublisher(req)
  if (!me.isScout) throw forbidden('Only scouts can use the inbox')
  return me
}

// Open items (pending, still in the feed, not over: a running exhibition stays until its end) the model did not
// judge a misfit; those it did are Filtered out. A filtered item is still an open item with every action.
const isNew = () => and(isOpen(), or(isNull(ingestItems.fitVerdict), ne(ingestItems.fitVerdict, 'no')))
const isFiltered = () => and(isOpen(), eq(ingestItems.fitVerdict, 'no'))
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

const itemCount = sql<number>`count(*)::int`

/** Items in each view, of one source (by slug) if given. */
async function counts(source?: string): Promise<{ new: number; filtered: number; gone: number }> {
  const ofSource = source ? eq(ingestSources.slug, source) : undefined
  const open = (inView: SQL | undefined) =>
    db
      .select({ n: itemCount })
      .from(ingestItems)
      .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
      .where(and(inView, ofSource))
  const [[n], [f]] = await Promise.all([open(isNew()), open(isFiltered())])
  const [g] = await db
    .select({ n: itemCount })
    .from(ingestItems)
    .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
    .innerJoin(events, eq(events.id, ingestItems.eventId))
    .where(and(isGone, ofSource))
  return { new: n?.n ?? 0, filtered: f?.n ?? 0, gone: g?.n ?? 0 }
}

/** The sources with items in a view and how many, by name: the inbox's source filter. */
async function sourceCounts(view: IngestView): Promise<IngestSourceCount[]> {
  const base = db
    .select({ slug: ingestSources.slug, name: ingestSources.name, count: itemCount })
    .from(ingestItems)
    .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
  const rows =
    view === 'gone'
      ? await base.innerJoin(events, eq(events.id, ingestItems.eventId)).where(isGone).groupBy(ingestSources.id)
      : await base.where(view === 'new' ? isNew() : isFiltered()).groupBy(ingestSources.id)
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/**
 * How often the scouts agreed with the model, per source, over the last 60 days. Only scored items a scout decided
 * count; a reject that happened because the event already existed says nothing about fit and is left out.
 */
async function accuracy(): Promise<IngestAccuracyRow[]> {
  const decidedIn = (verdict: 'fit' | 'no', ...status: ('accepted' | 'rejected')[]) =>
    sql<number>`count(*) filter (where ${ingestItems.fitVerdict} = ${verdict} and ${inArray(ingestItems.status, status)})`.mapWith(Number)
  const rows = await db
    .select({
      slug: ingestSources.slug,
      name: ingestSources.name,
      fit_decided: decidedIn('fit', 'accepted', 'rejected'),
      fit_accepted: decidedIn('fit', 'accepted'),
      no_decided: decidedIn('no', 'accepted', 'rejected'),
      no_rejected: decidedIn('no', 'rejected'),
      rescued: decidedIn('no', 'accepted'),
    })
    .from(ingestItems)
    .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
    .where(
      and(
        sql`${ingestItems.decidedAt} >= now() - interval '60 days'`,
        isNotNull(ingestItems.fitVerdict),
        sql`not (${ingestItems.status} = 'rejected' and ${ingestItems.hadDuplicates})`,
      ),
    )
    .groupBy(ingestSources.id)
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** Existing events that a draft may duplicate: what the inbox shows next to an item, and what a reject records. */
const duplicatesFor = (draft: IngestDraft) =>
  findDuplicateCandidates({
    venueId: draft.venue_id,
    locationText: draft.location_text,
    startsAt: new Date(draft.starts_at),
    endsAt: draft.ends_at ? new Date(draft.ends_at) : null,
    title: draft.title,
  })

/** The API view of a stored item; duplicates are looked up for items that still wait for a decision (new or filtered). */
async function toView(
  item: IngestItem,
  source: { slug: string; name: string },
  venueName: string | null,
  draft: IngestDraft,
  withDuplicates: boolean,
): Promise<IngestItemView> {
  const duplicates = withDuplicates ? await duplicatesFor(draft) : []
  return {
    id: item.id,
    status: item.status,
    source,
    draft,
    venue_name: venueName,
    gone_at: item.goneAt?.toISOString() ?? null,
    event_id: item.eventId,
    fit: item.fitVerdict && item.fitReason ? { verdict: item.fitVerdict, reason: item.fitReason } : null,
    duplicates,
  }
}

/** One item with its state, judged by the same conditions as the inbox views. Null if unknown or broken. */
async function getItem(id: string, log: FastifyBaseLogger): Promise<IngestItemDetail | null> {
  const [row] = await db
    .select({
      item: ingestItems,
      source: { slug: ingestSources.slug, name: ingestSources.name },
      venue: venues,
      // A filtered item is still new here: it keeps its actions, whichever tab it sits in
      isNew: sql<boolean>`coalesce(${isOpen()}, false)`,
      isGone: sql<boolean>`coalesce(${isGone}, false)`,
      isOver: sql<boolean>`not coalesce(${notOver()}, true)`,
    })
    .from(ingestItems)
    .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
    .leftJoin(venues, sql`${venues.id}::text = ${ingestItems.draft}->>'venue_id'`)
    .leftJoin(events, eq(events.id, ingestItems.eventId))
    .where(eq(ingestItems.id, id))
  if (!row) return null
  const parsed = ingestDraftSchema.safeParse(row.item.draft)
  if (!parsed.success) {
    log.warn({ itemId: id, issues: parsed.error.issues }, 'ingest item with an invalid draft')
    return null
  }

  let state: IngestItemState
  if (row.isNew) state = 'new'
  else if (row.isGone) state = 'gone'
  else if (row.item.status !== 'pending') state = row.item.status
  else state = row.isOver ? 'over' : 'removed'

  const { venue } = row
  return {
    ...(await toView(row.item, row.source, venue?.name ?? null, parsed.data, state === 'new')),
    state,
    venue: venue
      ? { id: venue.id, name: venue.name, address: venue.address, city: venue.city, coordinates: serializeCoordinates(venue.coordinates) }
      : null,
  }
}

/**
 * Where a page of a view ends: the rank, the draft start as an ISO instant, then the id (the list order).
 * A cursor without a rank (from before fit scoring) does not parse and starts from the top.
 */
const itemCursorSchema = z.object({
  rank: z.number().int().min(0).max(2),
  starts_at: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
})

/** Fits first, then maybes, then the rest, in New; the other views have no rank. One expression for select, keyset and order. */
const rankOf = (view: IngestView) =>
  view === 'new'
    ? sql<number>`(case ${ingestItems.fitVerdict} when 'fit' then 0 when 'maybe' then 1 else 2 end)::int`
    : sql<number>`0::int` // cast: a bare 0 in ORDER BY would be a column position

interface ListQuery {
  view: IngestView
  source?: string
  limit: number
  cursor?: string
}

async function listItems(
  { view, source, limit, cursor }: ListQuery,
  log: FastifyBaseLogger,
): Promise<{ items: IngestItemView[]; cursor: string | null; hasMore: boolean }> {
  const conditions: (SQL | undefined)[] = [view === 'new' ? isNew() : view === 'filtered' ? isFiltered() : isGone]
  if (source) conditions.push(eq(ingestSources.slug, source))
  const rank = rankOf(view)
  // An unreadable cursor starts from the top, as on GET /events
  const after = itemCursorSchema.safeParse(cursor ? decodeCursor(cursor) : null)
  if (after.success) {
    conditions.push(
      sql`(${rank}, ${draftStartsAt}, ${ingestItems.id}) > (${after.data.rank}::int, ${after.data.starts_at}::timestamptz, ${after.data.id}::uuid)`,
    )
  }

  const base = db
    .select({
      item: ingestItems,
      source: { slug: ingestSources.slug, name: ingestSources.name },
      venueName: venues.name,
      rank: sql<number>`${rank}`.as('rank'),
      // Read from the row, not the parsed draft: a page may end on a broken one
      startsAt: sql<string>`to_json(${draftStartsAt}) #>> '{}'`,
    })
    .from(ingestItems)
    .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
    // Compared as text: a broken stored venue_id must not make the uuid cast fail the whole list
    .leftJoin(venues, sql`${venues.id}::text = ${ingestItems.draft}->>'venue_id'`)
  const query = view === 'gone' ? base.innerJoin(events, eq(events.id, ingestItems.eventId)) : base
  const rows = await query
    .where(and(...conditions))
    .orderBy(asc(rank), asc(draftStartsAt), asc(ingestItems.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]
  const nextCursor = hasMore && last ? encodeCursor({ rank: last.rank, starts_at: last.startsAt, id: last.item.id }) : null

  // A broken stored draft must not take the inbox down for every scout: skip it and log it
  const valid = page.flatMap(({ item, source, venueName }) => {
    const parsed = ingestDraftSchema.safeParse(item.draft)
    if (parsed.success) return [{ item, source, venueName, draft: parsed.data }]
    log.warn({ itemId: item.id, issues: parsed.error.issues }, 'skipping ingest item with an invalid draft')
    return []
  })

  const items = await Promise.all(
    valid.map(({ item, source, venueName, draft }) => toView(item, source, venueName, draft, view !== 'gone')),
  )
  return { items, cursor: nextCursor, hasMore }
}

export async function ingestRoutes(app: FastifyInstance) {
  app.get('/ingest/items', read, async (req) => {
    requireScout(req)
    const query = ingestListQuerySchema.parse(req.query)
    const [page, itemCounts, sources] = await Promise.all([
      listItems(query, req.log),
      counts(query.source),
      sourceCounts(query.view),
    ])
    return { data: page.items, meta: { cursor: page.cursor, has_more: page.hasMore, counts: itemCounts, sources } }
  })

  app.get<{ Params: { id: string } }>('/ingest/items/:id', read, async (req) => {
    requireScout(req)
    const item = await getItem(req.params.id, req.log)
    if (!item) throw notFound('Inbox item not found')
    return { data: item }
  })

  app.get('/ingest/count', read, async (req) => {
    requireScout(req)
    return { data: await counts() }
  })

  app.get('/ingest/accuracy', read, async (req) => {
    requireScout(req)
    return { data: await accuracy() }
  })

  app.post<{ Params: { id: string } }>('/ingest/items/:id/accept', write, async (req) => {
    const me = requireScout(req)

    const accepted = await db.transaction(async (tx) => {
      // The status guard is the lock: of two concurrent accepts the second waits, then matches no row.
      const [item] = await tx
        .update(ingestItems)
        .set({ status: 'accepted', decidedBy: me.id, decidedAt: new Date() })
        .where(and(eq(ingestItems.id, req.params.id), eq(ingestItems.status, 'pending'), notOver()))
        .returning()
      if (!item) {
        const [exists] = await tx
          .select({ status: ingestItems.status })
          .from(ingestItems)
          .where(eq(ingestItems.id, req.params.id))
        if (!exists) throw notFound('Inbox item not found')
        throw conflict(exists.status === 'pending' ? 'Item is already over' : 'Item has already been decided')
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
          lineup: draft.lineup,
          startsAt: new Date(draft.starts_at),
          endsAt: draft.ends_at ? new Date(draft.ends_at) : null,
          venueId,
          locationText,
          city,
          categories: draft.categories,
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
      const [linked] = await tx.update(ingestItems).set({ eventId: event.id }).where(eq(ingestItems.id, item.id)).returning()
      return { item: linked!, draft }
    })

    // After the commit: the event is live even if the feed image cannot be fetched
    await syncItemImage(accepted.item, accepted.draft, me.id)
    return { data: { event_id: accepted.item.eventId! } }
  })

  // Static path: registered next to '/ingest/items/:id/*'; find-my-way prefers the static segment
  app.post('/ingest/items/reject', write, async (req) => {
    const me = requireScout(req)
    const { ids } = ingestRejectSchema.parse(req.body)
    // Record whether the scout saw duplicate candidates: the fit scoring reads it as a decision signal
    const pending = await db
      .select({ id: ingestItems.id, draft: ingestItems.draft })
      .from(ingestItems)
      .where(and(inArray(ingestItems.id, ids), eq(ingestItems.status, 'pending')))
    const withDuplicates: string[] = []
    const withoutDuplicates: string[] = []
    for (const item of pending) {
      const parsed = ingestDraftSchema.safeParse(item.draft)
      const hadDuplicates = parsed.success && (await duplicatesFor(parsed.data)).length > 0
      ;(hadDuplicates ? withDuplicates : withoutDuplicates).push(item.id)
    }
    const decidedAt = new Date()
    let rejected = 0
    for (const [group, hadDuplicates] of [[withDuplicates, true], [withoutDuplicates, false]] as const) {
      if (!group.length) continue
      const done = await db
        .update(ingestItems)
        .set({ status: 'rejected', decidedBy: me.id, decidedAt, hadDuplicates })
        .where(and(inArray(ingestItems.id, group), eq(ingestItems.status, 'pending')))
        .returning({ id: ingestItems.id })
      rejected += done.length
    }
    return { data: { rejected } }
  })

  app.post<{ Params: { id: string } }>('/ingest/items/:id/link', write, async (req) => {
    const me = requireScout(req)
    const { event_id, links, sync, ...take } = ingestLinkSchema.parse(req.body)
    const fields = sync ? INGEST_SYNCED_FIELDS : take.fields
    const linkKeys = sync ? [...new Set([...links, SYNCED_LINK])] : links
    const merging = sync || fields.length > 0 || linkKeys.length > 0

    const linked = await db.transaction(async (tx) => {
      // Event first, then items: the lock order of PUT/DELETE /events/:id and the sync run
      const [target] = await tx.select().from(events).where(eq(events.id, event_id)).for('update')
      if (!target) throw notFound('Event not found')
      // Taking the feed's fields is an edit: a claimed event is its owners' (a plain link changes nothing)
      if (merging && !canEdit({ owners: await getOwners(event_id) }, { id: me.id, is_scout: me.isScout })) {
        throw forbidden('Only event owners can edit this event')
      }
      // An item the event was synced from (re-posted under a new id) must not later offer it as gone
      await detachIngest(tx, event_id)
      // Detached unless the scout hands the event to the feed: otherwise it stays a human's, never overwritten
      const [item] = await tx
        .update(ingestItems)
        .set({ status: 'accepted', eventId: event_id, detachedAt: sync ? null : new Date(), decidedBy: me.id, decidedAt: new Date() })
        .where(and(eq(ingestItems.id, req.params.id), eq(ingestItems.status, 'pending')))
        .returning()
      if (!item) {
        const [exists] = await tx.select({ id: ingestItems.id }).from(ingestItems).where(eq(ingestItems.id, req.params.id))
        if (!exists) throw notFound('Inbox item not found')
        throw conflict('Item has already been decided')
      }
      const draft = ingestDraftSchema.parse(item.draft)
      if (!merging) return { item, draft }

      const [source] = await tx.select({ name: ingestSources.name }).from(ingestSources).where(eq(ingestSources.id, item.sourceId))
      const patch = await mergePatch(tx, target, draft, source?.name ?? draft.city, { fields, links: linkKeys })
      const endsAt = patch.endsAt === undefined ? target.endsAt : patch.endsAt
      if (endsAt && endsAt <= (patch.startsAt ?? target.startsAt)) throw badRequest('ends_at must be after starts_at')
      if (Object.keys(patch).length) {
        const [updated] = await tx
          .update(events)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(events.id, event_id))
          .returning()
        if (!updated) throw new Error('update returned no row')
        await logEdit(tx, {
          entityType: 'event',
          entityId: event_id,
          publisherId: me.id,
          action: 'updated',
          diff: { ...diff(eventSnapshot(target), eventSnapshot(updated)), via: 'ingest-link' },
        })
      }
      return { item, draft }
    })

    // After the commit, as on accept: the merge stands even if the feed image cannot be fetched
    if (sync) await syncItemImage(linked.item, linked.draft, me.id)
    else if (fields.includes('image')) await copyItemImage(event_id, linked.draft, me.id)
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
