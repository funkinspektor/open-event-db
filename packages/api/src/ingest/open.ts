import { and, eq, isNull, sql } from 'drizzle-orm'
import { ingestItems } from '@open-event-db/db'
import { berlinInstant, berlinToday } from '../extract/normalize.js'

export const draftStartsAt = sql`(${ingestItems.draft}->>'starts_at')::timestamptz`

export const draftEndsAt = sql`coalesce((${ingestItems.draft}->>'ends_at')::timestamptz, ${draftStartsAt})`

/** Midnight in Berlin today: items that ended before it are over and no longer worth a decision. */
const startOfToday = () => berlinInstant(berlinToday(new Date()), 0).toISOString()
export const notOver = () => sql`${draftEndsAt} >= ${startOfToday()}::timestamptz`

/** Pending items still in the feed that are not over yet (a running exhibition stays until its end). */
export const isOpen = () => and(eq(ingestItems.status, 'pending'), isNull(ingestItems.goneAt), notOver())
