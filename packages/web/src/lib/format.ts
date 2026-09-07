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

export function formatTimeRange(startsAt: string, endsAt: string | null): string {
  const start = formatTime(startsAt)
  return endsAt ? `${start} – ${formatTime(endsAt)}` : start
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

export function describeRecurrence(rrule: string): string {
  const parts = Object.fromEntries(
    rrule.split(';').map((kv) => kv.split('=') as [string, string]),
  )
  const days: Record<string, string> = {
    MO: 'Monday',
    TU: 'Tuesday',
    WE: 'Wednesday',
    TH: 'Thursday',
    FR: 'Friday',
    SA: 'Saturday',
    SU: 'Sunday',
  }
  if (parts.FREQ === 'WEEKLY' && parts.BYDAY) {
    const names = parts.BYDAY.split(',').map((d) => days[d] ?? d)
    return `Repeats every ${names.join(', ')}`
  }
  if (parts.FREQ === 'DAILY') return 'Repeats daily'
  if (parts.FREQ === 'MONTHLY') return 'Repeats monthly'
  if (parts.FREQ === 'WEEKLY') return 'Repeats weekly'
  return `Recurring (${rrule})`
}
