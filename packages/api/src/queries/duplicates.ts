import { and, asc, desc, eq, ne, or, sql, type SQL } from 'drizzle-orm'
import { events, publishers, venues } from '@open-event-db/db'
import type { DuplicateCandidate } from '@open-event-db/shared'
import { db } from '../db.js'
import { berlinInstant, berlinParts, nextDay } from '../extract/normalize.js'

/** Title similarity (pg_trgm) from which a candidate counts as "likely the same event". */
const LIKELY_THRESHOLD = 0.4
const DAY_MS = 24 * 60 * 60 * 1000

export interface DuplicateInput {
  venueId?: string | null
  locationText?: string | null
  startsAt: Date
  endsAt?: Date | null
  title?: string | null
  excludeId?: string | null
}

/** The Berlin calendar day of `startsAt`, or `[startsAt, endsAt]` when the input spans more than a day. */
function matchWindow({ startsAt, endsAt }: Pick<DuplicateInput, 'startsAt' | 'endsAt'>): [Date, Date] {
  if (endsAt && endsAt.getTime() - startsAt.getTime() > DAY_MS) return [startsAt, endsAt]
  const { year, month, day } = berlinParts(startsAt)
  return [berlinInstant({ year, month, day }, 0), berlinInstant(nextDay({ year, month, day }), 0)]
}

/**
 * Existing events that may be the same as the candidate: overlapping in time and at the same place,
 * not cancelled. Best title match first.
 */
export async function findDuplicateCandidates(
  input: DuplicateInput,
  limit = 5,
): Promise<DuplicateCandidate[]> {
  const locationText = input.locationText?.trim() || null
  if (!input.venueId && !locationText) return []

  const [from, to] = matchWindow(input)

  const placeConditions: SQL[] = []
  if (input.venueId) {
    placeConditions.push(eq(events.venueId, input.venueId))
    const [venue] = await db
      .select({ name: venues.name })
      .from(venues)
      .where(eq(venues.id, input.venueId))
      .limit(1)
    if (venue?.name) {
      placeConditions.push(sql`strpos(lower(${events.locationText}), lower(${venue.name})) > 0`)
    }
  } else if (locationText) {
    placeConditions.push(sql`lower(${events.locationText}) = lower(${locationText})`)
    placeConditions.push(
      sql`${venues.name} <> '' and strpos(lower(${locationText}), lower(${venues.name})) > 0`,
    )
  }

  const title = input.title?.trim()
  const similarity = title
    ? sql<number>`similarity(${events.title}, ${title})`
    : sql<number>`0`

  const conditions: (SQL | undefined)[] = [
    ne(events.status, 'cancelled'),
    sql`${events.startsAt} < ${to.toISOString()}::timestamptz`,
    sql`coalesce(${events.endsAt}, ${events.startsAt}) >= ${from.toISOString()}::timestamptz`,
    or(...placeConditions),
  ]
  if (input.excludeId) conditions.push(ne(events.id, input.excludeId))

  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      startTimeKnown: events.startTimeKnown,
      endsAt: events.endsAt,
      venueName: venues.name,
      addedByName: publishers.name,
      similarity,
    })
    .from(events)
    .leftJoin(venues, eq(events.venueId, venues.id))
    .innerJoin(publishers, eq(events.createdBy, publishers.id))
    .where(and(...conditions))
    .orderBy(...(title ? [desc(similarity)] : []), asc(events.startsAt), asc(events.id))
    .limit(limit)

  return rows.map((r) => {
    const score = Number(r.similarity)
    return {
      id: r.id,
      title: r.title,
      starts_at: r.startsAt.toISOString(),
      start_time_known: r.startTimeKnown,
      ends_at: r.endsAt?.toISOString() ?? null,
      venue_name: r.venueName,
      added_by_name: r.addedByName,
      similarity: Math.round(score * 1000) / 1000,
      likely: score >= LIKELY_THRESHOLD,
    }
  })
}
