/**
 * When an event is over. Lists keep an event until then, not just until it starts.
 *
 * Without an end we assume one: six hours after the start, but never before the end of the start's
 * Berlin day. A concert at 20:00 stays until midnight, a party at 23:00 until 05:00, and an event
 * without a known start time (stored as 00:00 Berlin) for its whole day.
 *
 * The API filters with the same rule in SQL (`effectiveEndSql` in the api package): keep both in step.
 */
export const ASSUMED_DURATION_HOURS = 6
export const EVENT_TZ = 'Europe/Berlin'

const HOUR_MS = 60 * 60 * 1000

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: EVENT_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** How far Berlin wall-clock time is ahead of UTC at this instant, in ms. */
function berlinOffsetMs(date: Date): number {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]))
  const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!)
  return wall - Math.floor(date.getTime() / 1000) * 1000
}

/** Midnight in Berlin at the end of the Berlin day that `date` falls on. */
export function endOfBerlinDay(date: Date): Date {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]))
  const midnightAsUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day! + 1)
  // The offset at midnight can differ from the one at `date` (DST): settle it at the result.
  const guess = midnightAsUtc - berlinOffsetMs(new Date(midnightAsUtc))
  return new Date(midnightAsUtc - berlinOffsetMs(new Date(guess)))
}

/** The end we assume for an event that has none. */
export function assumedEnd(startsAt: Date): Date {
  const byDuration = startsAt.getTime() + ASSUMED_DURATION_HOURS * HOUR_MS
  return new Date(Math.max(byDuration, endOfBerlinDay(startsAt).getTime()))
}

/** The event's end, or the assumed one. */
export function effectiveEnd(e: { starts_at: string; ends_at: string | null }): Date {
  return e.ends_at ? new Date(e.ends_at) : assumedEnd(new Date(e.starts_at))
}
