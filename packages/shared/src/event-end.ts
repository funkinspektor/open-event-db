import type { EventCategory } from './events.js'

/**
 * When an event is over. Lists keep an event until then, not just until it starts.
 *
 * Without an end we assume one: six hours after the start, but never before the end of the start's
 * Berlin day. A concert at 20:00 stays until midnight, an event without a known start time (stored as
 * 00:00 Berlin) for its whole day.
 *
 * Parties run through the night, so one also stays at least until the next 06:00 Berlin: a party at
 * 20:00 or 23:00 until 06:00, one without a known start time until 06:00 the morning after its day.
 *
 * The API filters with the same rule in SQL (`effectiveEndSql` in the api package): keep both in step.
 */
export const ASSUMED_DURATION_HOURS = 6
/** Berlin hour a party without an end is kept until at least. */
export const PARTY_MORNING_HOUR = 6
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

function berlinParts(date: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]))
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour! }
}

/** `hour`:00 Berlin wall-clock time, `days` days after the Berlin day that `date` falls on. */
function berlinTime(date: Date, days: number, hour: number): Date {
  const p = berlinParts(date)
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day + days, hour)
  // The offset at the result can differ from the one at `date` (DST): settle it there.
  const guess = wallAsUtc - berlinOffsetMs(new Date(wallAsUtc))
  return new Date(wallAsUtc - berlinOffsetMs(new Date(guess)))
}

/** Midnight in Berlin at the end of the Berlin day that `date` falls on. */
export function endOfBerlinDay(date: Date): Date {
  return berlinTime(date, 1, 0)
}

/**
 * The next 06:00 Berlin after a party's start. A start without a known time (00:00) counts as the
 * evening of its day, so the party runs into the next morning.
 */
export function partyMorning(startsAt: Date, startTimeKnown = true): Date {
  const sameMorning = startTimeKnown && berlinParts(startsAt).hour < PARTY_MORNING_HOUR
  return berlinTime(startsAt, sameMorning ? 0 : 1, PARTY_MORNING_HOUR)
}

export interface AssumedEndOptions {
  categories?: readonly EventCategory[]
  /** False for an event stored as 00:00 Berlin because only its day is known. */
  startTimeKnown?: boolean
}

/** The end we assume for an event that has none. */
export function assumedEnd(startsAt: Date, { categories = [], startTimeKnown = true }: AssumedEndOptions = {}): Date {
  const byDuration = startsAt.getTime() + ASSUMED_DURATION_HOURS * HOUR_MS
  let end = Math.max(byDuration, endOfBerlinDay(startsAt).getTime())
  if (categories.includes('party')) end = Math.max(end, partyMorning(startsAt, startTimeKnown).getTime())
  return new Date(end)
}

/** The event's end, or the assumed one. */
export function effectiveEnd(e: {
  starts_at: string
  ends_at: string | null
  start_time_known: boolean
  categories: readonly EventCategory[]
}): Date {
  if (e.ends_at) return new Date(e.ends_at)
  return assumedEnd(new Date(e.starts_at), { categories: e.categories, startTimeKnown: e.start_time_known })
}
