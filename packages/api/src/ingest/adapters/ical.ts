import { createHash } from 'node:crypto'
import ICAL from 'ical.js'
import type { IngestSourceConfig } from '@open-event-db/shared'
import { berlinInstant, berlinIso, berlinParts } from '../../extract/normalize.js'

/** The feed could not be read as an iCal calendar (or uses something the adapter does not support). */
export class FeedParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedParseError'
  }
}

export interface FeedMoment {
  /** YYYY-MM-DD in the source timezone. */
  date: string
  /** HH:MM in the source timezone, null for all-day (DATE) values. */
  time: string | null
  /** ISO 8601 with offset. */
  iso: string
}

export interface FeedEvent {
  externalId: string
  uid: string
  summary: string
  description: string
  start: FeedMoment
  end: FeedMoment | null
  url: string | null
  imageUrl: string | null
  locationRoom: string | null
  locationText: string | null
  /** The source states the start time itself, so the draft needs no "times unverified" mark. */
  timesStated: boolean
  /** The source text of the event (VEVENT, table row) as served. */
  raw: string
  /** sha256 of `raw` without DTSTAMP lines, so a re-export alone does not count as a change. */
  hash: string
}

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|avif)$/i
const THUMBNAIL_SUFFIX = /-\d+x\d+(?=\.[a-z0-9]+$)/i

const pad = (n: number) => String(n).padStart(2, '0')

/** Splits the feed into its VEVENT blocks exactly as written. */
function rawEvents(text: string): string[] {
  return text.match(/^BEGIN:VEVENT\r?\n[\s\S]*?^END:VEVENT(?=\r?\n|$)/gm) ?? []
}

/** DTSTAMP changes on every export; drop it (with folded continuation lines) before hashing. */
function withoutDtstamp(raw: string): string {
  return raw.replace(/^DTSTAMP[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*\r?\n/gm, '')
}

function toMoment(prop: ICAL.Property): FeedMoment {
  const value = prop.getFirstValue() as ICAL.Time
  if (value.isDate) {
    const date = `${value.year}-${pad(value.month)}-${pad(value.day)}`
    return { date, time: null, iso: berlinIso(berlinInstant({ year: value.year, month: value.month, day: value.day }, 0)) }
  }
  let instant: Date
  if (value.zone === ICAL.Timezone.localTimezone) {
    // Floating time (also what an empty `TZID=` yields): wall-clock time in the source timezone.
    const tzid = prop.getParameter('tzid')
    if (tzid && tzid !== SUPPORTED_TIMEZONE) {
      throw new FeedParseError(`Feed uses TZID ${tzid} without a VTIMEZONE; only ${SUPPORTED_TIMEZONE} is supported`)
    }
    instant = berlinInstant({ year: value.year, month: value.month, day: value.day }, value.hour * 60 + value.minute)
  } else {
    // Explicit UTC or a defined VTIMEZONE: honour it as given.
    instant = value.toJSDate()
  }
  const p = berlinParts(instant)
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}`, iso: berlinIso(instant) }
}

/**
 * The stable id inside the UID. A pattern that does not match fails the feed: falling back to the full
 * UID would turn every changed event into a new item and mark the old one gone.
 */
function externalIdOf(uid: string, pattern: string | null): string {
  if (!pattern) return uid
  const match = new RegExp(pattern).exec(uid)
  const id = match ? (match[1] ?? match[0]) : ''
  if (!id) throw new FeedParseError(`external_id_pattern ${pattern} yields no id for UID ${uid}`)
  return id
}

/** First ATTACH that points at an image, with WordPress thumbnail suffixes (`-150x150`) removed. */
function imageOf(vevent: ICAL.Component): string | null {
  for (const prop of vevent.getAllProperties('attach')) {
    const value = String(prop.getFirstValue())
    let pathname: string
    try {
      pathname = new URL(value).pathname
    } catch {
      continue
    }
    if (IMAGE_EXTENSION.test(pathname)) return value.replace(THUMBNAIL_SUFFIX, '')
  }
  return null
}

function stringOf(vevent: ICAL.Component, name: string): string | null {
  const value = vevent.getFirstPropertyValue(name)
  return value === null || value === undefined ? null : String(value)
}

/** iCal -> plain events. Pure; the caller decides what to do with them. */
export function parseIcal(text: string, config: IngestSourceConfig): FeedEvent[] {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }

  let calendar: ICAL.Component
  try {
    calendar = new ICAL.Component(ICAL.parse(text))
  } catch (err) {
    throw new FeedParseError(`Not an iCal feed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (calendar.name !== 'vcalendar') throw new FeedParseError('Not an iCal feed: no VCALENDAR')

  const vevents = calendar.getAllSubcomponents('vevent')
  const raws = rawEvents(text)
  if (raws.length !== vevents.length) throw new FeedParseError('Could not match VEVENTs to their source text')

  // Keyed by externalId: if a feed repeats an event (same UID), the last one wins.
  const events = new Map<string, FeedEvent>()
  vevents.forEach((vevent, i) => {
    const uid = stringOf(vevent, 'uid')
    const dtstart = vevent.getFirstProperty('dtstart')
    if (!uid || !dtstart) return // cannot be tracked or placed in time
    const summary = stringOf(vevent, 'summary')
    if (!summary?.trim()) return // an event needs a title

    const dtend = vevent.getFirstProperty('dtend')
    const start = toMoment(dtstart)
    let end = dtend ? toMoment(dtend) : null
    if (end && end.iso <= start.iso) end = null // an end that is not after the start tells us nothing

    const location = stringOf(vevent, 'location')?.trim() || config.default_location
    const raw = raws[i] ?? ''
    const externalId = externalIdOf(uid, config.external_id_pattern)
    const earlier = events.get(externalId)
    if (earlier && earlier.uid !== uid) {
      throw new FeedParseError(
        `external_id_pattern ${config.external_id_pattern} maps UIDs ${earlier.uid} and ${uid} to the same id ${externalId}`,
      )
    }
    events.set(externalId, {
      externalId,
      uid,
      summary,
      description: stringOf(vevent, 'description') ?? '',
      start,
      end,
      url: stringOf(vevent, 'url'),
      imageUrl: imageOf(vevent),
      locationRoom: location ? (location.split(',')[0] ?? '').trim() || null : null,
      locationText: location,
      // Feeds often carry placeholder times; only text extraction confirms them
      timesStated: false,
      raw,
      hash: createHash('sha256').update(withoutDtstamp(raw)).digest('hex'),
    })
  })
  return [...events.values()]
}
