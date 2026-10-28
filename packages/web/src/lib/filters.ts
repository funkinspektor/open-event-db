import { ALL_STATUSES } from './api'
import { TZ } from './format'

export type Range = 'upcoming' | 'today' | 'weekend' | 'week' | 'custom'
export const RANGES: { key: Range; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'today', label: 'Today' },
  { key: 'weekend', label: 'This weekend' },
  { key: 'week', label: 'This week' },
]

export interface Filters {
  range: Range
  tags: string[]
  city: string
  /** Custom range as Berlin calendar days (YYYY-MM-DD), both inclusive; only used when range is 'custom'. */
  from?: string
  to?: string
}

type SP = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

const isDay = (v: string | undefined): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

export function parseFilters(sp: SP): Filters {
  const rangeRaw = first(sp.range)
  const tags = (first(sp.tags) ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const city = first(sp.city) ?? 'Berlin'

  // A custom range (?from=…&to=…) wins over the preset ranges.
  let from = first(sp.from)
  let to = first(sp.to)
  if (isDay(from) || isDay(to)) {
    from = isDay(from) ? from : undefined
    to = isDay(to) ? to : undefined
    if (from && to && from > to) [from, to] = [to, from]
    return { range: 'custom', tags, city, from, to }
  }

  const range = RANGES.some((r) => r.key === rangeRaw) ? (rangeRaw as Range) : 'upcoming'
  return { range, tags, city }
}

// Same DD.MM style as the day headings in the listing.
const fmtDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

/** Filter button label: "Upcoming", "This weekend", "16.10 – 19.10", "From 16.10", "Until 19.10". */
export function rangeLabel(f: Pick<Filters, 'range' | 'from' | 'to'>): string {
  if (f.range !== 'custom') return RANGES.find((r) => r.key === f.range)?.label ?? 'Upcoming'
  if (f.from && f.to) return f.from === f.to ? fmtDay(f.from) : `${fmtDay(f.from)} – ${fmtDay(f.to)}`
  if (f.from) return `From ${fmtDay(f.from)}`
  if (f.to) return `Until ${fmtDay(f.to)}`
  return 'Dates'
}

export function filtersToHref(f: Filters): string {
  const qs = new URLSearchParams()
  if (f.range === 'custom') {
    if (f.from) qs.set('from', f.from)
    if (f.to) qs.set('to', f.to)
  } else if (f.range !== 'upcoming') {
    qs.set('range', f.range)
  }
  if (f.tags.length) qs.set('tags', f.tags.join(','))
  if (f.city !== 'Berlin') qs.set('city', f.city)
  const s = qs.toString()
  return s ? `/?${s}` : '/'
}

function tzOffsetMs(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  )
  return asUtc - date.getTime()
}

function startOfDayInBerlin(date: Date): Date {
  const shifted = new Date(date.getTime() + tzOffsetMs(date))
  shifted.setUTCHours(0, 0, 0, 0)
  const guess = new Date(shifted.getTime() - tzOffsetMs(date))
  return new Date(shifted.getTime() - tzOffsetMs(guess))
}

function berlinWeekday(date: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(date)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
}

const DAY = 24 * 60 * 60 * 1000

/** Midnight in Berlin at the start of a calendar day given as YYYY-MM-DD. */
export function berlinDayStart(day: string): Date {
  // Noon UTC falls on the same calendar day in Berlin, whatever the DST offset.
  return startOfDayInBerlin(new Date(`${day}T12:00:00Z`))
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + DAY).toISOString().slice(0, 10)

/** Custom range → API bounds: `to` is inclusive for people, exclusive for the API. Open start means "from now". */
export function customRangeToDates(from: string | undefined, to: string | undefined, now = new Date()) {
  return {
    from: from ? berlinDayStart(from) : now,
    to: to ? berlinDayStart(nextDay(to)) : undefined,
  }
}

export function rangeToDates(range: Range, now = new Date()): { from?: Date; to?: Date } {
  const today = startOfDayInBerlin(now)
  switch (range) {
    case 'today':
      return { from: now, to: new Date(today.getTime() + DAY) }
    case 'week':
      return { from: now, to: new Date(today.getTime() + 7 * DAY) }
    case 'weekend': {
      const wd = berlinWeekday(now)
      // Sat/Sun belong to the weekend that started on the previous Friday.
      const daysToFriday = wd === 6 ? -1 : wd === 0 ? -2 : 5 - wd
      const friday = new Date(today.getTime() + daysToFriday * DAY)
      const from = friday.getTime() < now.getTime() ? now : friday
      return { from, to: new Date(friday.getTime() + 3 * DAY) }
    }
    default:
      return {}
  }
}

export function buildApiQuery(f: Filters, limit = 20): URLSearchParams {
  const qs = new URLSearchParams()
  qs.set('status', ALL_STATUSES)
  qs.set('limit', String(limit))
  if (f.city) qs.set('city', f.city)
  if (f.tags.length) qs.set('tags', f.tags.join(','))
  const { from, to } = f.range === 'custom' ? customRangeToDates(f.from, f.to) : rangeToDates(f.range)
  if (from) qs.set('from', from.toISOString())
  if (to) qs.set('to', to.toISOString())
  return qs
}
