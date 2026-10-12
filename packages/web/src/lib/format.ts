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

export function formatDate(iso: string, long = false): string {
  return (long ? longDateFmt : dateFmt).format(new Date(iso))
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso))
}

/** "23:59–10:00" in lists; pass " – " for the spaced form on the event page. */
export function formatTimeRange(startsAt: string, endsAt: string | null, sep = '–'): string {
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

/** Running right now; events without an end count as running for the rest of their day. */
export function isHappeningNow(e: { starts_at: string; ends_at: string | null }, now = new Date()): boolean {
  if (new Date(e.starts_at) > now) return false
  return e.ends_at ? new Date(e.ends_at) > now : dayKey(e.starts_at) === berlinDay(now).key
}

export function formatDateTime(startsAt: string, endsAt: string | null, long = false): string {
  return `${formatDate(startsAt, long)} · ${formatTimeRange(startsAt, endsAt)}`
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
