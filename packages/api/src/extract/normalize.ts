import {
  normalizeTags,
  type EventDraft,
  type ExtractedLinkKind,
  type Extraction,
  type Weekday,
  type WrittenDate,
} from '@open-event-db/shared'

const TZ = 'Europe/Berlin'
const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export interface CalendarDay {
  year: number
  month: number
  day: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const fmtDay = (d: CalendarDay) => `${d.year}-${pad(d.month)}-${pad(d.day)}`

export function berlinParts(instant: Date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, Number(x.value)]))
  return p as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>
}

/** The Berlin calendar day an instant falls on. */
export function berlinToday(now: Date): CalendarDay {
  const { year, month, day } = berlinParts(now)
  return { year, month, day }
}

function exists({ year, month, day }: CalendarDay): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

const weekdayOf = ({ year, month, day }: CalendarDay): Weekday =>
  WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!

const before = (a: CalendarDay, b: CalendarDay) => fmtDay(a) < fmtDay(b)

function nextDay({ year, month, day }: CalendarDay): CalendarDay {
  const d = new Date(Date.UTC(year, month - 1, day + 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/**
 * A written date → calendar day, or null when it can't be pinned down without guessing.
 * Without a year: the next occurrence on or after `notBefore`. A written weekday must match, otherwise null.
 */
export function resolveDate(written: WrittenDate | null, notBefore: CalendarDay): CalendarDay | null {
  if (!written) return null
  const { day, month, weekday } = written
  let candidate: CalendarDay
  if (written.year !== null) {
    candidate = { year: written.year < 100 ? 2000 + written.year : written.year, month, day }
  } else {
    candidate = { year: notBefore.year, month, day }
    if (before(candidate, notBefore)) candidate = { ...candidate, year: notBefore.year + 1 }
  }
  if (!exists(candidate)) return null
  if (weekday && weekdayOf(candidate) !== weekday) return null
  return candidate
}

/** "23:00", "9:30", "23h", "23.00" → minutes after midnight; anything else → null. */
export function parseTime(value: string | null): number | null {
  const m = value?.trim().match(/^(\d{1,2})(?:[:.h](\d{2})?)?h?$/i)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Wall-clock time in Berlin → instant. Handles DST by correcting the offset once. */
export function berlinInstant(day: CalendarDay, minutes: number): Date {
  const wallAsUtc = Date.UTC(day.year, day.month - 1, day.day, Math.floor(minutes / 60), minutes % 60)
  const offsetAt = (instant: number) => {
    const p = berlinParts(new Date(instant))
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant
  }
  const guess = wallAsUtc - offsetAt(wallAsUtc)
  return new Date(wallAsUtc - offsetAt(guess))
}

/** ISO 8601 with the Berlin offset, e.g. 2026-10-17T23:00:00+02:00. */
export function berlinIso(instant: Date): string {
  const p = berlinParts(instant)
  const offsetMin = Math.round(
    (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime()) / 60_000,
  )
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

const LINK_KEYS: Record<ExtractedLinkKind, string> = {
  tickets: 'tickets',
  instagram: 'instagram',
  facebook: 'facebook',
  resident_advisor: 'ra',
  telegram: 'telegram',
  soundcloud: 'soundcloud',
  bandcamp: 'bandcamp',
  website: 'website',
}

function normalizeUrl(kind: ExtractedLinkKind, raw: string): string | null {
  let value = raw.trim()
  if (kind === 'instagram' && /^@[\w.]+$/.test(value)) value = `https://www.instagram.com/${value.slice(1)}`
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

function normalizeLinks(links: Extraction['links']): Record<string, string> {
  const out: Record<string, string> = {}
  const seen = new Set<string>()
  for (const { kind, url: raw } of links) {
    const url = normalizeUrl(kind, raw)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const base = LINK_KEYS[kind]
    let key = base
    for (let i = 2; key in out; i++) key = `${base}-${i}`
    out[key] = url
  }
  return out
}

const text = (value: string | null, max: number): string | null => {
  const t = value?.trim()
  return t ? t.slice(0, max) : null
}

const COUNTRY_SUFFIX = /(?:,\s*|\s+)(?:deutschland|germany|de)$/i

/** "10439 Berlin, Deutschland" → "Berlin" */
export function cleanCity(value: string | null): string | null {
  const city = text(value, 100)
    ?.replace(COUNTRY_SUFFIX, '')
    .replace(/^\d{5}\s+/, '')
    .trim()
  return city || null
}

/** Street, number and postal code; a trailing city or country is dropped ("…, 10439 Berlin" → "…, 10439"). */
export function cleanAddress(value: string | null, city: string | null): string | null {
  let address = text(value, 300)?.replace(COUNTRY_SUFFIX, '').trim()
  if (address && city) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    address = address.replace(new RegExp(`(,\\s*|\\s+)${escaped}$`, 'i'), '').trim()
  }
  return address || null
}

/** "DJs: Hanzel" → "Hanzel"; section labels the model sometimes keeps. */
const LINEUP_LABEL = /^(djs?|live|line-?up|support|special guests?|b2b)\s*:\s*/i

/** Model output → form draft, applying the PRD's input-handling rules. `now` decides "next occurrence". */
export function normalizeExtraction(x: Extraction, now: Date): EventDraft {
  const today = berlinToday(now)
  const startDay = resolveDate(x.date, today)
  const startMin = parseTime(x.start_time)

  let startsAt: Date | null = null
  let endsAt: Date | null = null
  if (startDay && startMin !== null) {
    startsAt = berlinInstant(startDay, startMin)
    const endMin = parseTime(x.end_time)
    if (endMin !== null) {
      const endDay = x.end_date ? resolveDate(x.end_date, startDay) : startDay
      if (endDay) {
        endsAt = berlinInstant(endDay, endMin)
        // "23:00–06:00": a night that ends after midnight, unless an explicit end date says otherwise.
        // Next calendar day, not +24h, so the wall-clock time survives a DST switch.
        if (!x.end_date && endsAt <= startsAt) endsAt = berlinInstant(nextDay(endDay), endMin)
        if (endsAt <= startsAt) endsAt = null
      }
    }
  }

  const lineup = [...new Set(x.lineup.map((n) => n.trim().replace(LINEUP_LABEL, '').trim()).filter(Boolean))].slice(0, 50)
  const city = cleanCity(x.city) ?? 'Berlin'
  const tags = normalizeTags(x.tags)
    .filter((t) => t.length <= 50)
    .slice(0, 20)

  return {
    title: text(x.title, 200),
    start_date: startDay ? fmtDay(startDay) : null,
    starts_at: startsAt ? berlinIso(startsAt) : null,
    ends_at: endsAt ? berlinIso(endsAt) : null,
    venue_name: text(x.venue_name, 200),
    address: cleanAddress(x.address, city),
    city,
    description: text(x.description, 10_000),
    lineup,
    tags,
    links: normalizeLinks(x.links),
  }
}

/** True when the draft holds nothing worth pre-filling. */
export const isEmptyDraft = (d: EventDraft) =>
  !d.title && !d.start_date && !d.venue_name && !d.address && !d.description && d.lineup.length === 0
