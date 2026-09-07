import { and, eq } from 'drizzle-orm'
import { eventOwners, events, publishers, venues, type Event, type Venue } from '@open-event-db/db'
import type { EventDetail, EventOwnerRole } from '@open-event-db/shared'
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

function serializeEventDetail(
  e: Event,
  v: Venue | null,
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
    created_by: e.createdBy,
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
  }
}

export async function getEventDetail(id: string): Promise<EventDetail | null> {
  const [row] = await db
    .select({ event: events, venue: venues })
    .from(events)
    .leftJoin(venues, eq(events.venueId, venues.id))
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

  return serializeEventDetail(row.event, row.venue, owners)
}

export async function getOwnerRole(
  eventId: string,
  publisherId: string,
): Promise<EventOwnerRole | null> {
  const [r] = await db
    .select({ role: eventOwners.role })
    .from(eventOwners)
    .where(and(eq(eventOwners.eventId, eventId), eq(eventOwners.publisherId, publisherId)))
    .limit(1)
  return r?.role ?? null
}

export async function getOwnerIds(eventId: string): Promise<string[]> {
  const rows = await db
    .select({ publisherId: eventOwners.publisherId })
    .from(eventOwners)
    .where(eq(eventOwners.eventId, eventId))
  return rows.map((r) => r.publisherId)
}
