import { berlinToday } from './extract/normalize.js'

export interface CalendarEvent {
  id: string
  title: string
  descriptionPlain: string
  startsAt: Date
  startTimeKnown: boolean
  endsAt: Date | null
  status: 'scheduled' | 'cancelled' | 'postponed'
  location: string | null
  createdAt: Date
  updatedAt: Date
}

const DEFAULT_DURATION_MS = 4 * 60 * 60 * 1000
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Markdown to plain text, just enough for a calendar description (no markdown parser in the API). */
export function stripMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^ {0,3}#{1,6} +/gm, '')
    .replace(/^ {0,3}> ?/gm, '')
    .replace(/`/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/\*/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+|_+(?=$|[^\p{L}\p{N}])/gu, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const utcStamp = (d: Date) =>
  `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`

const dateStamp = (y: number, m: number, d: number) => `${pad(y, 4)}${pad(m)}${pad(d)}`

function allDayRange(startsAt: Date): { start: string; end: string } {
  const { year, month, day } = berlinToday(startsAt)
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  return {
    start: dateStamp(year, month, day),
    end: dateStamp(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  }
}

const escapeText = (s: string) =>
  s.replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

/** Folds a content line at 75 octets with CRLF + space, never inside a UTF-8 sequence. */
export function foldLine(line: string): string {
  const out: string[] = []
  let cur = ''
  let curBytes = 0
  let limit = 75
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8')
    if (curBytes + n > limit) {
      out.push(cur)
      cur = ''
      curBytes = 0
      limit = 74 // continuation lines start with a space
    }
    cur += ch
    curBytes += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

export function toICalendar(events: CalendarEvent[], opts: { now: Date; webUrl: string }): string {
  const stamp = utcStamp(opts.now)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kellerkompass//Marked events//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Kellerkompass',
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ]
  for (const e of events) {
    const url = `${opts.webUrl}/events/${e.id}`
    const description = e.descriptionPlain ? `${e.descriptionPlain}\n\n${url}` : url
    const seq = Math.max(0, Math.floor((e.updatedAt.getTime() - e.createdAt.getTime()) / 1000))
    lines.push('BEGIN:VEVENT', `UID:${e.id}@kellerkompass.de`, `DTSTAMP:${stamp}`)
    if (e.startTimeKnown) {
      const end = e.endsAt && e.endsAt > e.startsAt ? e.endsAt : new Date(e.startsAt.getTime() + DEFAULT_DURATION_MS)
      lines.push(`DTSTART:${utcStamp(e.startsAt)}`, `DTEND:${utcStamp(end)}`)
    } else {
      const r = allDayRange(e.startsAt)
      lines.push(`DTSTART;VALUE=DATE:${r.start}`, `DTEND;VALUE=DATE:${r.end}`)
    }
    lines.push(`SUMMARY:${escapeText(e.status === 'postponed' ? `Postponed: ${e.title}` : e.title)}`)
    lines.push(`DESCRIPTION:${escapeText(description)}`)
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    lines.push(`URL:${url}`)
    lines.push(`STATUS:${e.status === 'cancelled' ? 'CANCELLED' : e.status === 'postponed' ? 'TENTATIVE' : 'CONFIRMED'}`)
    lines.push(`SEQUENCE:${seq}`, `LAST-MODIFIED:${utcStamp(e.updatedAt)}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
