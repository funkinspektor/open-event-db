import { ALL_STATUSES } from './api'
import { TZ } from './format'

export type Range = 'upcoming' | 'today' | 'weekend' | 'week'
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
}

type SP = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export function parseFilters(sp: SP): Filters {
  const rangeRaw = first(sp.range)
  const range = RANGES.some((r) => r.key === rangeRaw) ? (rangeRaw as Range) : 'upcoming'
  const tags = (first(sp.tags) ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const city = first(sp.city) ?? 'Berlin'
  return { range, tags, city }
}

export function filtersToHref(f: Filters): string {
  const qs = new URLSearchParams()
  if (f.range !== 'upcoming') qs.set('range', f.range)
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

export function rangeToDates(range: Range, now = new Date()): { from?: Date; to?: Date } {
  const today = startOfDayInBerlin(now)
  switch (range) {
    case 'today':
      return { from: now, to: new Date(today.getTime() + DAY) }
    case 'week':
      return { from: now, to: new Date(today.getTime() + 7 * DAY) }
    case 'weekend': {
      const wd = berlinWeekday(now)
      const daysToFriday = wd <= 5 ? 5 - wd : 6
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
  const { from, to } = rangeToDates(f.range)
  if (from) qs.set('from', from.toISOString())
  if (to) qs.set('to', to.toISOString())
  return qs
}
