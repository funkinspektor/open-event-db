export const TZ = 'Europe/Berlin'

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

const longDateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const shortDateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'long' })

/** The event page's date line: "Fri, 30 October". */
export function formatShortDate(iso: string): string {
  const p = Object.fromEntries(shortDateFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.weekday}, ${p.day} ${p.month}`
}

export function formatDate(iso: string, long = false): string {
  return (long ? longDateFmt : dateFmt).format(new Date(iso))
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso))
}

interface EventTimes {
  starts_at: string
  start_time_known: boolean
  ends_at: string | null
}

/** The start for formatTimeRange: null when only the day is known. */
export const knownStart = (e: EventTimes): string | null => (e.start_time_known ? e.starts_at : null)

/** "23:59–10:00" in lists; pass " – " for the spaced form on the event page. A null start has no known time. */
export function formatTimeRange(startsAt: string | null, endsAt: string | null, sep = '–'): string {
  if (!startsAt) return endsAt ? `until ${formatTime(endsAt)}` : 'Time TBA'
  const start = formatTime(startsAt)
  return endsAt ? `${start}${sep}${formatTime(endsAt)}` : start
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_MS = 24 * 60 * 60 * 1000

function berlinDay(date: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]))
  return {
    key: `${p.year}-${p.month}-${p.day}`,
    label: `${p.weekday} ${p.day}.${p.month}`,
    // days since epoch for the Berlin calendar date, and Monday-based weekday index
    n: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY_MS,
    wd: WEEKDAYS.indexOf(p.weekday ?? ''),
  }
}

/** "Sat" when the event ends on a later Berlin day than it starts, for "19:00 – 11:30 (Sat)". */
export function formatEndDayMark(startsAt: string, endsAt: string | null): string | null {
  if (!endsAt) return null
  const end = berlinDay(new Date(endsAt))
  return end.n > berlinDay(new Date(startsAt)).n ? WEEKDAYS[end.wd]! : null
}

/** Berlin calendar day, e.g. "2026-10-10" — used to group events by day. */
export function dayKey(iso: string): string {
  return berlinDay(new Date(iso)).key
}

/** Day heading / row date in the flyer style: "Sat 10.10". */
export function formatDay(iso: string): string {
  return berlinDay(new Date(iso)).label
}

/** Label next to a day heading: Today, Tomorrow or Next week. */
export function relativeDayLabel(iso: string, now = new Date()): 'Today' | 'Tomorrow' | 'Next week' | null {
  const d = berlinDay(new Date(iso))
  const t = berlinDay(now)
  const diff = d.n - t.n
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  const nextMonday = t.n - t.wd + 7
  if (d.n >= nextMonday && d.n < nextMonday + 7) return 'Next week'
  return null
}

/** Date in a list row outside the home page: "Today" or "Fri 16.10". */
export function formatRowDate(iso: string, now = new Date()): string {
  return berlinDay(new Date(iso)).n === berlinDay(now).n ? 'Today' : formatDay(iso)
}

/** Not started yet; an event without a known time counts as upcoming for its whole day. */
export function isUpcoming(e: EventTimes, now = new Date()): boolean {
  if (!e.start_time_known) return dayKey(e.starts_at) >= berlinDay(now).key
  return new Date(e.starts_at) > now
}

/**
 * Running right now; events without an end count as running for the rest of their day. Without a known
 * start time we can't tell, so it's never "now", only "today".
 */
export function isHappeningNow(e: EventTimes, now = new Date()): boolean {
  if (!e.start_time_known || new Date(e.starts_at) > now) return false
  return e.ends_at ? new Date(e.ends_at) > now : dayKey(e.starts_at) === berlinDay(now).key
}

export function formatDateTime(e: EventTimes, long = false): string {
  return `${formatDate(e.starts_at, long)} · ${formatTimeRange(knownStart(e), e.ends_at)}`
}

const LINK_LABELS: Record<string, string> = {
  ra: 'Resident Advisor',
  tickets: 'Tickets',
  website: 'Website',
  instagram: 'Instagram',
  telegram: 'Telegram',
  facebook: 'Facebook',
  maps: 'Map',
  soundcloud: 'SoundCloud',
  bandcamp: 'Bandcamp',
}

export function linkLabel(key: string): string {
  return LINK_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}
