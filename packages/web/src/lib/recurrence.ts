// The simple recurrence patterns the event form can build, and their RRULE strings.
// Anything else is kept as a raw "custom" RRULE.

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** 1–4 = first–fourth, -1 = last */
export const ORDINALS = [1, 2, 3, 4, -1] as const
export type Ordinal = (typeof ORDINALS)[number]

export type Recurrence =
  | { kind: 'none' }
  | { kind: 'weekly'; days: Weekday[] }
  | { kind: 'monthly'; ordinal: Ordinal; day: Weekday }
  | { kind: 'custom'; rrule: string }

export const DAY_NAMES: Record<Weekday, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
}

export const ORDINAL_NAMES: Record<Ordinal, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [-1]: 'last',
}

const isWeekday = (d: string): d is Weekday => (WEEKDAYS as readonly string[]).includes(d)

function parts(rrule: string): Record<string, string> {
  return Object.fromEntries(
    rrule
      .replace(/^RRULE:/i, '')
      .split(';')
      .filter(Boolean)
      .map((kv) => {
        const [k = '', v = ''] = kv.split('=')
        return [k.trim().toUpperCase(), v.trim().toUpperCase()]
      }),
  )
}

export function parseRecurrence(rrule: string | null | undefined): Recurrence {
  const raw = rrule?.trim()
  if (!raw) return { kind: 'none' }
  const p = parts(raw)
  const keys = Object.keys(p).sort().join(',')

  if (keys === 'BYDAY,FREQ' && p.FREQ === 'WEEKLY') {
    const days = p.BYDAY!.split(',')
    if (days.length > 0 && days.every(isWeekday)) {
      return { kind: 'weekly', days: WEEKDAYS.filter((d) => days.includes(d)) }
    }
  }
  if (keys === 'BYDAY,FREQ' && p.FREQ === 'MONTHLY') {
    const m = /^(-1|[1-4])([A-Z]{2})$/.exec(p.BYDAY!)
    if (m && isWeekday(m[2]!)) return { kind: 'monthly', ordinal: Number(m[1]) as Ordinal, day: m[2] }
  }
  return { kind: 'custom', rrule: raw }
}

export function buildRecurrence(r: Recurrence): string | null {
  switch (r.kind) {
    case 'none':
      return null
    case 'weekly':
      return r.days.length ? `FREQ=WEEKLY;BYDAY=${WEEKDAYS.filter((d) => r.days.includes(d)).join(',')}` : null
    case 'monthly':
      return `FREQ=MONTHLY;BYDAY=${r.ordinal}${r.day}`
    case 'custom':
      return r.rrule.trim() || null
  }
}

/** Weekday and "nth weekday of the month" of a date, in the given time zone — used as builder defaults. */
export function weekdayOf(date: Date, timeZone = 'Europe/Berlin'): { day: Weekday; ordinal: Ordinal } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', day: 'numeric' })
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]))
  const day = p.weekday!.slice(0, 2).toUpperCase() as Weekday
  const n = Math.ceil(Number(p.day) / 7)
  return { day, ordinal: (n > 4 ? -1 : n) as Ordinal }
}

export function describeRecurrence(rrule: string): string {
  const r = parseRecurrence(rrule)
  if (r.kind === 'weekly') return `Repeats every ${r.days.map((d) => DAY_NAMES[d]).join(', ')}`
  if (r.kind === 'monthly') return `Repeats every ${ORDINAL_NAMES[r.ordinal]} ${DAY_NAMES[r.day]} of the month`

  const p = parts(rrule)
  if (p.FREQ === 'DAILY') return 'Repeats daily'
  if (p.FREQ === 'WEEKLY') return 'Repeats weekly'
  if (p.FREQ === 'MONTHLY') return 'Repeats monthly'
  if (p.FREQ === 'YEARLY') return 'Repeats yearly'
  return `Recurring (${rrule})`
}
