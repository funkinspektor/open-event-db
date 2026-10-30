import { normalizeCategories, sanitizeLineup, type Extraction, type IngestDraft, type IngestSourceConfig } from '@open-event-db/shared'
import {
  berlinInstant,
  berlinIso,
  fmtDay,
  nextDay,
  normalizeLinks,
  parseTime,
  resolveDate,
  type CalendarDay,
} from '../extract/normalize.js'
import type { FeedEvent } from './adapters/ical.js'

const DAY_MS = 24 * 60 * 60 * 1000

export function calendarDay(date: string): CalendarDay {
  const [year, month, day] = date.split('-').map(Number)
  return { year: year!, month: month!, day: day! }
}

/** http(s) URLs only: the inbox renders these as links and images. */
function httpUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/** The limits POST /events enforces, so an accepted draft is a valid event. */
const MAX_TITLE = 200
const MAX_DESCRIPTION = 10_000
const MAX_LOCATION_TEXT = 300

/** At most `max` UTF-16 units, ending in "…" when cut, without leaving half a surrogate pair. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  let cut = text.slice(0, max - 1)
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1)
  return `${cut}…`
}

/** Single newlines become Markdown hard breaks; blank lines stay paragraph breaks. */
const markdownBreaks = (text: string) => text.replace(/(?<!\n)\n(?!\n)/g, '  \n')

/**
 * The end, in order of preference: an explicit later end date from the text; an end time from the text
 * (the next day for nights past midnight); the feed's own end if it is a plausible one; otherwise none.
 */
function endOf(ev: FeedEvent, extraction: Extraction | null, startDay: CalendarDay, startsAt: Date): Date | null {
  const extractedEnd = parseTime(extraction?.end_time ?? null)
  const feedEndTime = parseTime(ev.end?.time ?? null)

  // A missing year is filled so the end date is on or after the feed start date.
  const endDay = resolveDate(extraction?.end_date ?? null, startDay)
  const endMinutes = extractedEnd ?? feedEndTime
  if (endDay && fmtDay(endDay) > fmtDay(startDay) && endMinutes !== null) {
    return berlinInstant(endDay, endMinutes)
  }

  if (extractedEnd !== null) {
    const sameDay = berlinInstant(startDay, extractedEnd)
    // Next calendar day, not +24 h, so the wall-clock time survives a DST switch.
    return sameDay > startsAt ? sameDay : berlinInstant(nextDay(startDay), extractedEnd)
  }

  if (ev.end) {
    const feedEnd = new Date(ev.end.iso)
    const length = feedEnd.getTime() - startsAt.getTime()
    if (length > 0 && length <= DAY_MS) return feedEnd
  }
  return null
}

/**
 * Feed event (+ what the text extractor read from its description) → the draft a scout reviews.
 * The feed decides the day. The extraction corrects the times of feeds that don't state them reliably
 * (iCal times are often wrong); times a page states are kept, so there it only adds categories and links.
 */
export function normalizeFeedEvent(ev: FeedEvent, config: IngestSourceConfig, extraction: Extraction | null): IngestDraft {
  const startDay = calendarDay(ev.start.date)
  // A text time like "live from 22:00" must not replace the door time a page states
  const timesFrom = ev.timesStated ? null : extraction
  const extractedStart = parseTime(timesFrom?.start_time ?? null)
  const startMinutes = extractedStart ?? parseTime(ev.start.time) ?? 0
  const startsAt = berlinInstant(startDay, startMinutes)
  const endsAt = endOf(ev, timesFrom, startDay, startsAt)

  const website = httpUrl(ev.url)
  const room = ev.locationRoom
  const venueId = room && Object.hasOwn(config.venues, room) ? (config.venues[room] ?? null) : null

  return {
    title: truncate(ev.summary.trim(), MAX_TITLE),
    description: truncate(markdownBreaks(ev.description), MAX_DESCRIPTION),
    lineup: sanitizeLineup(ev.lineup ?? []),
    starts_at: berlinIso(startsAt),
    ends_at: endsAt ? berlinIso(endsAt) : null,
    venue_id: venueId,
    location_text: venueId || ev.locationText === null ? null : truncate(ev.locationText, MAX_LOCATION_TEXT),
    city: config.city,
    // What the text says wins; the source's default only fills in when it says nothing.
    categories: normalizeCategories(extraction?.categories.length ? extraction.categories : config.default_categories),
    links: normalizeLinks(extraction?.links ?? [], { ...(website ? { website } : {}), ...ev.links }),
    image_url: httpUrl(ev.imageUrl),
    source_url: website,
    // An unreadable start time counts as missing: the feed time was used.
    times_unverified: extractedStart === null && !ev.timesStated,
  }
}
