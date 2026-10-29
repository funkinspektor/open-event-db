import { and, eq, isNull, sql } from 'drizzle-orm'
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
import type { EventAddedBy, EventDetail, EventOwnerRole, EventSlim } from '@open-event-db/shared'
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
  claimed: sql<boolean>`exists (select 1 from ${eventOwners} where ${eventOwners.eventId} = ${events.id})`,
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
  }
}

function serializeEventDetail(
  e: Event,
  v: Venue | null,
  addedBy: EventAddedBy,
  owners: { publisherId: string; slug: string; name: string; role: EventOwnerRole }[],
  syncedFrom: EventDetail['synced_from'],
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
    recurrence: e.recurrence,
    location_text: e.locationText,
    city: e.city,
    image_url: imageUrlOf(e.imageKey),
    added_by: addedBy,
    claimed: owners.length > 0,
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

  const syncedFrom =
    row.sourceName === null
      ? null
      : { source_name: row.sourceName, source_url: (row.itemDraft?.source_url as string | null | undefined) ?? null }
  return serializeEventDetail(row.event, row.venue, row.addedBy, owners, syncedFrom)
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
