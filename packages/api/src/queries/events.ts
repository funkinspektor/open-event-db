import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import {
  eventOwners,
  events,
  ingestItems,
  ingestSources,
  publishers,
  venues,
  type Event,
  type Venue,
} from '@open-event-db/db'
import {
  canonicalLineup,
  type EventAddedBy,
  type EventDetail,
  type EventOwnerRole,
  type EventProvenance,
  type EventSlim,
} from '@open-event-db/shared'
import { db } from '../db.js'
import { diff, logEdit, type DbOrTx } from '../history.js'
import { detachIngest } from '../ingest/detach.js'
import { serializeCoordinates } from '../serializers.js'
import { imageStore } from '../images/store.js'

/** The public URL of a stored image; null without a key or while images are off. */
export function imageUrlOf(key: string | null): string | null {
  const store = imageStore.store
  return key && store ? store.url(key) : null
}

export function eventSnapshot(e: Event): Record<string, unknown> {
  return {
    title: e.title,
    description: e.description,
    // jsonb reorders keys: canonical, so an unchanged lineup diffs as unchanged
    lineup: canonicalLineup(e.lineup),
    starts_at: e.startsAt.toISOString(),
    start_time_known: e.startTimeKnown,
    ends_at: e.endsAt?.toISOString() ?? null,
    venue_id: e.venueId,
    location_text: e.locationText,
    city: e.city,
    categories: e.categories,
    tags: e.tags,
    links: e.links,
    status: e.status,
    recurrence: e.recurrence,
    image_key: e.imageKey,
  }
}

const hasOwners = sql`exists (select 1 from ${eventOwners} where ${eventOwners.eventId} = ${events.id})`

/** An official source lists the event right now: accepted (synced or not) and not gone from the site. */
const listedByVenue = and(
  eq(ingestItems.eventId, events.id),
  eq(ingestItems.status, 'accepted'),
  isNull(ingestItems.goneAt),
  eq(ingestSources.official, true),
)

/** The event's provenance; correlated on `events`, usable in a select or a where. */
export const provenanceSql = sql<EventProvenance>`case
  when ${hasOwners} then 'organizer'
  when exists (select 1 from ${ingestItems} inner join ${ingestSources} on ${ingestSources.id} = ${ingestItems.sourceId} where ${listedByVenue}) then 'venue_site'
  else 'scout' end`

/** Columns for slim event rows; use with `.from(events).leftJoin(venues, …)`. */
export const slimEventColumns = {
  id: events.id,
  title: events.title,
  description: events.description,
  startsAt: events.startsAt,
  startTimeKnown: events.startTimeKnown,
  endsAt: events.endsAt,
  status: events.status,
  categories: events.categories,
  tags: events.tags,
  city: events.city,
  locationText: events.locationText,
  recurrence: events.recurrence,
  imageKey: events.imageKey,
  venueId: venues.id,
  venueName: venues.name,
  venueCity: venues.city,
  // Unclaimed (scout-added) events have no owner rows
  claimed: sql<boolean>`${hasOwners}`,
  provenance: provenanceSql,
}

interface SlimEventRow {
  id: string
  title: string
  description: string
  startsAt: Date
  startTimeKnown: boolean
  endsAt: Date | null
  status: Event['status']
  categories: Event['categories']
  tags: string[]
  city: string
  locationText: string | null
  recurrence: string | null
  imageKey: string | null
  venueId: string | null
  venueName: string | null
  venueCity: string | null
  claimed: boolean
  provenance: EventProvenance
}

export function serializeSlimEvent(r: SlimEventRow): EventSlim {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    starts_at: r.startsAt.toISOString(),
    start_time_known: r.startTimeKnown,
    ends_at: r.endsAt?.toISOString() ?? null,
    status: r.status,
    categories: r.categories,
    tags: r.tags,
    city: r.city,
    location_text: r.locationText,
    recurrence: r.recurrence,
    venue: r.venueId ? { id: r.venueId, name: r.venueName!, city: r.venueCity! } : null,
    image_url: imageUrlOf(r.imageKey),
    claimed: r.claimed,
    provenance: r.provenance,
  }
}

function serializeEventDetail(
  e: Event,
  v: Venue | null,
  addedBy: EventAddedBy,
  owners: { publisherId: string; slug: string; name: string; role: EventOwnerRole }[],
  syncedFrom: EventDetail['synced_from'],
  venueListing: EventDetail['venue_listing'],
): EventDetail {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    starts_at: e.startsAt.toISOString(),
    start_time_known: e.startTimeKnown,
    ends_at: e.endsAt?.toISOString() ?? null,
    status: e.status,
    categories: e.categories,
    tags: e.tags,
    links: e.links,
    lineup: e.lineup,
    recurrence: e.recurrence,
    location_text: e.locationText,
    city: e.city,
    image_url: imageUrlOf(e.imageKey),
    added_by: addedBy,
    claimed: owners.length > 0,
    provenance: owners.length > 0 ? 'organizer' : venueListing ? 'venue_site' : 'scout',
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
    synced_from: syncedFrom,
    venue_listing: venueListing,
  }
}

export async function getEventDetail(id: string): Promise<EventDetail | null> {
  const [row] = await db
    .select({
      event: events,
      venue: venues,
      addedBy: {
        id: publishers.id,
        slug: publishers.slug,
        name: publishers.name,
        is_scout: publishers.isScout,
      },
      sourceName: ingestSources.name,
      itemDraft: ingestItems.draft,
    })
    .from(events)
    .leftJoin(venues, eq(events.venueId, venues.id))
    .innerJoin(publishers, eq(publishers.id, events.createdBy))
    // Still synced from a feed: an item points here and no human edit has detached it
    .leftJoin(ingestItems, and(eq(ingestItems.eventId, events.id), isNull(ingestItems.detachedAt)))
    .leftJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
    .where(eq(events.id, id))
    .limit(1)
  if (!row) return null

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

  const [listing] = await db
    .select({ sourceName: ingestSources.name, itemDraft: ingestItems.draft, lastSeenAt: ingestItems.lastSeenAt })
    .from(ingestItems)
    .innerJoin(ingestSources, eq(ingestSources.id, ingestItems.sourceId))
    .innerJoin(events, eq(events.id, ingestItems.eventId))
    .where(and(eq(events.id, id), listedByVenue))
    .orderBy(desc(ingestItems.lastSeenAt))
    .limit(1)

  const sourceUrl = (draft: Record<string, unknown> | null) => (draft?.source_url as string | null | undefined) ?? null
  const syncedFrom =
    row.sourceName === null ? null : { source_name: row.sourceName, source_url: sourceUrl(row.itemDraft) }
  const venueListing = listing
    ? { source_name: listing.sourceName, source_url: sourceUrl(listing.itemDraft), last_seen_at: listing.lastSeenAt.toISOString() }
    : null
  return serializeEventDetail(row.event, row.venue, row.addedBy, owners, syncedFrom, venueListing)
}

/** Cancels an event, logs it and stops feed sync. No-op for an already cancelled event. */
export async function cancelEvent(tx: DbOrTx, current: Event, publisherId: string): Promise<void> {
  if (current.status === 'cancelled') return
  const [updated] = await tx
    .update(events)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(events.id, current.id))
    .returning()
  if (!updated) throw new Error('update returned no row')
  await logEdit(tx, {
    entityType: 'event',
    entityId: current.id,
    publisherId,
    action: 'cancelled',
    diff: diff(eventSnapshot(current), eventSnapshot(updated)),
  })
  await detachIngest(tx, current.id)
}

/** Owner rows in the shape the shared permission helpers expect. Empty = unclaimed. */
export async function getOwners(
  eventId: string,
): Promise<{ publisher_id: string; role: EventOwnerRole }[]> {
  return db
    .select({ publisher_id: eventOwners.publisherId, role: eventOwners.role })
    .from(eventOwners)
    .where(eq(eventOwners.eventId, eventId))
}
