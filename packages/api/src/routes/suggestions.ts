import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { and, count, desc, eq, gt, ne, sql } from 'drizzle-orm'
import {
  EVENT_IMAGE_MAX_BYTES,
  EXTRACT_IMAGE_TYPES,
  suggestionCreateSchema,
  type EventDetail,
  type IngestDraft,
  type MySuggestion,
  type SuggestionPreview,
} from '@open-event-db/shared'
import { ensureSuggestionsSource, ingestItems, venues, type IngestItem } from '@open-event-db/db'
import { db } from '../db.js'
import { currentAccount, requireAuth, requireOnboarded, writeRateLimit } from '../auth.js'
import { ApiError, badRequest, conflict, notFound } from '../errors.js'
import { markPrivate } from '../headers.js'
import { serializeCoordinates } from '../serializers.js'
import { sniffImageType } from '../images/sniff.js'
import { imageStore, suggestionImageKey } from '../images/store.js'
import { suggestionStart, toSuggestionDraft } from '../suggestions/draft.js'
import { deleteSuggestionImage } from '../ingest/image.js'
import { draftIsOver } from '../ingest/open.js'

const guard = { onRequest: [requireAuth, requireOnboarded], config: { rateLimit: writeRateLimit } }
/** Reading the own list falls under the global read limit, not the write limit. */
const readGuard = { onRequest: [requireAuth, requireOnboarded] }

const DEFAULT_PER_DAY = 5
const DAY_MS = 24 * 60 * 60 * 1000

/** Suggestions one account may send within 24 hours, withdrawn ones included. */
function perDay(): number {
  const n = Number.parseInt(process.env.SUGGESTIONS_PER_DAY ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PER_DAY
}

let sourceId: string | null = null
async function suggestionsSourceId(): Promise<string> {
  sourceId ??= await ensureSuggestionsSource(db)
  return sourceId
}

const imagesUnavailable = () => new ApiError(503, 'images_unavailable', 'Event images are not available right now')

function myStatus(item: IngestItem, draft: { starts_at?: string; ends_at?: string | null }): MySuggestion['status'] {
  if (item.status === 'rejected') return 'not_accepted'
  if (item.status === 'accepted') return 'live'
  // Undecided and over: it left the inbox (the same rule), so nobody will review it any more
  return draft.starts_at && draftIsOver({ starts_at: draft.starts_at, ends_at: draft.ends_at ?? null }) ? 'expired' : 'in_review'
}

function toMySuggestion(item: IngestItem): MySuggestion {
  const draft = item.draft as { title?: string; starts_at?: string; ends_at?: string | null }
  const store = imageStore.store
  return {
    id: item.id,
    title: draft.title ?? '',
    starts_at: draft.starts_at ?? item.firstSeenAt.toISOString(),
    status: myStatus(item, draft),
    event_id: item.status === 'accepted' ? item.eventId : null,
    reason: item.status === 'rejected' ? item.rejectReason : null,
    image_url: item.imageKey && store ? store.url(item.imageKey) : null,
    created_at: item.firstSeenAt.toISOString(),
  }
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000'
const uuidOrNil = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : NIL_UUID

/** The account's own live item of the suggestions source; anyone else's id (or a withdrawn one) is not found. */
async function ownItem(id: string, accountId: string): Promise<IngestItem> {
  const [item] = await db
    .select()
    .from(ingestItems)
    .where(and(eq(ingestItems.id, uuidOrNil(id)), eq(ingestItems.submittedBy, accountId), ne(ingestItems.status, 'withdrawn')))
    .limit(1)
  if (!item) throw notFound('Suggestion not found')
  return item
}

async function deleteQuietly(key: string | null) {
  const store = imageStore.store
  if (!key || !store) return
  try {
    await store.delete(key)
  } catch (err) {
    console.warn(`Could not delete image ${key}:`, err instanceof Error ? err.message : err)
  }
}

export async function suggestionRoutes(app: FastifyInstance) {
  // Image uploads arrive as the raw body; the signature, not this header, decides what they are
  app.addContentTypeParser(
    [...EXTRACT_IMAGE_TYPES],
    { parseAs: 'buffer', bodyLimit: EVENT_IMAGE_MAX_BYTES },
    (_req, body, done) => done(null, body),
  )

  app.post('/suggestions', guard, async (req, reply) => {
    const me = currentAccount(req)
    const input = suggestionCreateSchema.parse(req.body)

    let venueCity: string | null = null
    if (input.venue_id) {
      const [venue] = await db.select({ city: venues.city }).from(venues).where(eq(venues.id, input.venue_id)).limit(1)
      if (!venue) throw new ApiError(404, 'venue_not_found', 'Venue not found')
      venueCity = venue.city
    } else if (!input.city) {
      throw badRequest('Send a city, or pick a venue', 'city_required')
    }

    const { startsAt } = suggestionStart(input.starts_at)
    const endsAt = input.ends_at ? new Date(input.ends_at) : null
    if (endsAt && endsAt <= startsAt) throw badRequest('ends_at must be after starts_at')
    const draft = toSuggestionDraft(input, venueCity)
    // Exactly what the inbox hides as over: a suggestion is never taken in and then invisible to the team
    if (draftIsOver(draft)) throw badRequest('This event is already over', 'event_over')

    const source = await suggestionsSourceId()
    const limit = perDay()
    const id = randomUUID()
    const item = await db.transaction(async (tx) => {
      // Counting is only safe one request at a time per account
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'suggestion-limit:' + me.id}))`)
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(ingestItems)
        .where(and(eq(ingestItems.submittedBy, me.id), gt(ingestItems.firstSeenAt, new Date(Date.now() - DAY_MS))))
      if (n >= limit) {
        throw new ApiError(
          429,
          'suggestion_limit',
          `You've sent ${limit} suggestions today. Try again tomorrow.`,
        )
      }
      const [row] = await tx
        .insert(ingestItems)
        .values({
          id,
          sourceId: source,
          externalId: id,
          status: 'pending',
          draft,
          raw: JSON.stringify(input),
          submittedBy: me.id,
        })
        .returning()
      if (!row) throw new Error('insert returned no row')
      return row
    })

    markPrivate(reply)
    return reply.code(201).send({ data: toMySuggestion(item) })
  })

  app.put<{ Params: { id: string } }>(
    '/suggestions/:id/image',
    { ...guard, bodyLimit: EVENT_IMAGE_MAX_BYTES },
    async (req, reply) => {
      const me = currentAccount(req)
      await ownItem(req.params.id, me.id)
      const store = imageStore.store
      if (!store) throw imagesUnavailable()
      const type = Buffer.isBuffer(req.body) ? sniffImageType(req.body) : null
      if (!type) throw new ApiError(415, 'unsupported_media_type', 'Send one PNG, JPEG or WEBP image as the request body')

      const key = suggestionImageKey(req.params.id, type)
      await store.put(key, req.body as Buffer, type)
      let previous: string | null
      try {
        previous = await setImage(req.params.id, me.id, key, store.url(key))
      } catch (err) {
        await deleteQuietly(key)
        throw err
      }
      await deleteQuietly(previous)
      markPrivate(reply)
      return { data: toMySuggestion(await ownItem(req.params.id, me.id)) }
    },
  )

  app.delete<{ Params: { id: string } }>('/suggestions/:id/image', guard, async (req, reply) => {
    const me = currentAccount(req)
    await ownItem(req.params.id, me.id)
    const previous = await setImage(req.params.id, me.id, null, null)
    await deleteQuietly(previous)
    markPrivate(reply)
    return { data: toMySuggestion(await ownItem(req.params.id, me.id)) }
  })

  app.delete<{ Params: { id: string } }>('/suggestions/:id', guard, async (req, reply) => {
    const me = currentAccount(req)
    const item = await db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(ingestItems)
        .where(and(eq(ingestItems.id, uuidOrNil(req.params.id)), eq(ingestItems.submittedBy, me.id), ne(ingestItems.status, 'withdrawn')))
        .for('update')
      if (!found) throw notFound('Suggestion not found')
      if (found.status !== 'pending') throw conflict('Only a suggestion that is still in review can be withdrawn')
      // The image key stays until its object is deleted: if that fails, the cleanup deletes withdrawn images at once
      await tx.update(ingestItems).set({ status: 'withdrawn' }).where(eq(ingestItems.id, found.id))
      return found
    })
    if (item.imageKey) await deleteSuggestionImage(item.id, item.imageKey)
    return reply.code(204).send()
  })

  app.get<{ Params: { id: string } }>('/suggestions/:id', readGuard, async (req, reply) => {
    markPrivate(reply)
    const me = currentAccount(req)
    const item = await ownItem(req.params.id, me.id)
    const draft = item.draft as IngestDraft
    const venue = draft.venue_id
      ? ((await db.select().from(venues).where(eq(venues.id, draft.venue_id)).limit(1))[0] ?? null)
      : null
    // Ids and timestamps are the suggestion's own: the preview is never stored as an event
    const preview: EventDetail = {
      id: item.id,
      title: draft.title,
      description: draft.description,
      starts_at: draft.starts_at,
      start_time_known: !draft.times_unverified,
      ends_at: draft.ends_at,
      status: 'scheduled',
      categories: draft.categories,
      tags: [],
      links: draft.links,
      lineup: draft.lineup,
      recurrence: null,
      location_text: draft.location_text,
      city: venue?.city ?? draft.city,
      image_url: draft.image_url,
      added_by: {
        id: me.id,
        handle: me.handle,
        display_name: me.displayName,
        is_scout: me.isScout,
        is_organizer_member: false,
      },
      claimed: false,
      provenance: 'scout',
      created_at: item.firstSeenAt.toISOString(),
      updated_at: item.firstSeenAt.toISOString(),
      venue: venue
        ? {
            id: venue.id,
            name: venue.name,
            address: venue.address,
            city: venue.city,
            coordinates: serializeCoordinates(venue.coordinates),
          }
        : null,
      organizers: [],
      synced_from: null,
      venue_listing: null,
    }
    const data: SuggestionPreview = { suggestion: toMySuggestion(item), preview }
    return { data }
  })

  app.get('/accounts/me/suggestions', readGuard, async (req, reply) => {
    markPrivate(reply)
    const me = currentAccount(req)
    const rows = await db
      .select()
      .from(ingestItems)
      .where(and(eq(ingestItems.submittedBy, me.id), ne(ingestItems.status, 'withdrawn')))
      .orderBy(desc(ingestItems.firstSeenAt), desc(ingestItems.id))
    return { data: rows.map(toMySuggestion) }
  })
}

/** Points a pending item at a new image (or none); returns the previous key. 409 when the item is decided. */
async function setImage(id: string, accountId: string, key: string | null, url: string | null): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(ingestItems)
      .where(and(eq(ingestItems.id, uuidOrNil(id)), eq(ingestItems.submittedBy, accountId), ne(ingestItems.status, 'withdrawn')))
      .for('update')
    if (!item) throw notFound('Suggestion not found')
    if (item.status !== 'pending') throw conflict('Only a suggestion that is still in review can be changed')
    await tx
      .update(ingestItems)
      .set({ imageKey: key, draft: { ...item.draft, image_url: url } })
      .where(eq(ingestItems.id, id))
    return item.imageKey
  })
}
