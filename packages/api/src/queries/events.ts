import { eq, sql } from 'drizzle-orm'
import { eventOwners, events, publishers, venues, type Event, type Venue } from '@open-event-db/db'
import type { EventAddedBy, EventDetail, EventOwnerRole, EventSlim } from '@open-event-db/shared'
import { db } from '../db.js'
import { serializeCoordinates } from '../serializers.js'

export function eventSnapshot(e: Event): Record<string, unknown> {
  return {
    title: e.title,
    description: e.description,
    starts_at: e.startsAt.toISOString(),
    ends_at: e.endsAt?.toISOString() ?? null,
    venue_id: e.venueId,
    location_text: e.locationText,
    city: e.city,
    tags: e.tags,
    links: e.links,
    status: e.status,
    recurrence: e.recurrence,
  }
}

/** Columns for slim event rows; use with `.from(events).leftJoin(venues, …)`. */
export const slimEventColumns = {
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
  // Unclaimed (scout-added) events have no owner rows
  claimed: sql<boolean>`exists (select 1 from ${eventOwners} where ${eventOwners.eventId} = ${events.id})`,
}

interface SlimEventRow {
  id: string
  title: string
  description: string
  startsAt: Date
  endsAt: Date | null
  status: Event['status']
  tags: string[]
  city: string
  locationText: string | null
  recurrence: string | null
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
    ends_at: r.endsAt?.toISOString() ?? null,
    status: r.status,
    tags: r.tags,
    city: r.city,
    location_text: r.locationText,
    recurrence: r.recurrence,
    venue: r.venueId ? { id: r.venueId, name: r.venueName!, city: r.venueCity! } : null,
    claimed: r.claimed,
  }
}

function serializeEventDetail(
  e: Event,
  v: Venue | null,
  addedBy: EventAddedBy,
  owners: { publisherId: string; slug: string; name: string; role: EventOwnerRole }[],
): EventDetail {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    starts_at: e.startsAt.toISOString(),
    ends_at: e.endsAt?.toISOString() ?? null,
    status: e.status,
    tags: e.tags,
    links: e.links,
    recurrence: e.recurrence,
    location_text: e.locationText,
    city: e.city,
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
    synced_from: null,
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
    })
    .from(events)
    .leftJoin(venues, eq(events.venueId, venues.id))
    .innerJoin(publishers, eq(publishers.id, events.createdBy))
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

  return serializeEventDetail(row.event, row.venue, row.addedBy, owners)
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
