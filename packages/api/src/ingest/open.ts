import { and, eq, isNull, sql } from 'drizzle-orm'
import { ingestItems } from '@open-event-db/db'
import { berlinInstant, berlinToday } from '../extract/normalize.js'

export const draftStartsAt = sql`(${ingestItems.draft}->>'starts_at')::timestamptz`

export const draftEndsAt = sql`coalesce((${ingestItems.draft}->>'ends_at')::timestamptz, ${draftStartsAt})`

/** Midnight in Berlin today: items that ended before it are over and no longer worth a decision. */
const startOfToday = (now = new Date()) => berlinInstant(berlinToday(now), 0)
export const notOver = () => sql`${draftEndsAt} >= ${startOfToday().toISOString()}::timestamptz`

/** `notOver()` for one draft in code: it ended (or, without an end, started) before today in Berlin. */
export function draftIsOver(draft: { starts_at: string; ends_at: string | null }, now = new Date()): boolean {
  return new Date(draft.ends_at ?? draft.starts_at) < startOfToday(now)
}

/** Pending items still in the feed that are not over yet (a running exhibition stays until its end). */
export const isOpen = () => and(eq(ingestItems.status, 'pending'), isNull(ingestItems.goneAt), notOver())
