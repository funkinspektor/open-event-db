import { createHash } from 'node:crypto'
import { parseFragment } from 'parse5'
import type { IngestSourceConfig } from '@open-event-db/shared'
import { berlinParts, berlinToday, fmtDay, parseTime, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { berlinMoment, isElement, richText, squash, webUrl } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** Squarespace gives every event an end one hour after its start unless the editor sets another. */
const DEFAULT_LENGTH_MS = 60 * 60 * 1000
/** "Showtime: 20:45", "Showtime:: 20;30", "Show: 20:30", "Shows start 20:00", "Live music starts 20:45". */
const SHOW = /^(?:show\s*time|shows?(?:\s+starts?)?|live\s+music\s+starts?|start|beginn)\s*:*\s*(?:at\s+)?(\d{1,2})[:.;](\d{2})\b/i
/** "Tickets:", "🎟 Tickets", "Ticket Link:". */
const TICKETS = /^\W*tickets?\b/i
/** Shops whose links are tickets even without a "Tickets" line: texts often end in the bare shop link. */
const TICKET_SHOPS = [
  'eventim-light.com',
  'eventim.de',
  'tixforgigs.com',
  'dice.fm',
  'eventbrite.com',
  'eventbrite.de',
  'ticketmaster.de',
  'reservix.de',
  'koka36.de',
  'tickettailor.com',
  'pretix.eu',
]
const MARKDOWN_LINK = /\[(?:\\.|[^\]\\])*\]\((https?:\/\/[^)\s]+)\)/g
const BARE_URL = /https?:\/\/[^\s)\]]+/

export interface SquarespaceOptions {
  /** The events collection as JSON list, e.g. https://www.8mmbar.de/program?format=json&view=list. */
  pageUrl: string
  now: Date
}

/** The fields of a Squarespace event item this adapter reads. */
interface SquarespaceEvent {
  id: string
  title: string
  startDate: number
  endDate: number
  fullUrl: string
  sourceUrl?: string
  assetUrl?: string
  body?: string | null
  excerpt?: string
  location?: { addressTitle?: string; addressLine1?: string; addressLine2?: string }
  tags?: string[]
  categories?: string[]
}

/** The collection's upcoming events, or an error saying what the URL serves instead. */
function upcomingOf(text: string): SquarespaceEvent[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new FeedParseError('Not JSON: the source URL must end in ?format=json&view=list')
  }
  const upcoming = (data as { upcoming?: unknown }).upcoming
  if (!Array.isArray(upcoming)) {
    throw new FeedParseError('No "upcoming" list in the JSON: the source URL must ask for ?format=json&view=list')
  }
  return upcoming as SquarespaceEvent[]
}

/** The Berlin day and minutes after midnight of a Squarespace timestamp (ms, often with stray milliseconds). */
function berlinDayTime(ms: number): { day: CalendarDay; minutes: number } {
  const { year, month, day, hour, minute } = berlinParts(new Date(ms))
  return { day: { year, month, day }, minutes: hour * 60 + minute }
}

/** The body's layout blocks as one text; a fragment is no element, so each top-level node is read. */
const textOfBody = (body: string) =>
  parseFragment(body)
    .childNodes.filter(isElement)
    .map(richText)
    .filter(Boolean)
    .join('\n\n')

/** The text's URLs in order: a link's target, not its (often shortened) text. */
function urlsOf(line: string): string[] {
  const urls: string[] = []
  const rest = line.replace(MARKDOWN_LINK, (_, href: string) => {
    urls.push(href)
    return ' '
  })
  const bare = rest.match(new RegExp(BARE_URL, 'g')) ?? []
  // Order matters only between kinds on one line, which the texts don't mix
  return [...urls, ...bare].map((u) => u.replaceAll('%28', '(').replaceAll('%29', ')'))
}

const isTicketShop = (url: string) => {
  const host = new URL(url).hostname.replace(/^www\./, '')
  return TICKET_SHOPS.some((shop) => host === shop || host.endsWith(`.${shop}`))
}

/** The first link on a "Tickets" line or the line after it, else the first link to a ticket shop. */
function ticketLink(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!TICKETS.test(lines[i]!)) continue
    for (const line of lines.slice(i, i + 2)) {
      const url = urlsOf(line).map(webUrl).find(Boolean)
      if (url) return url
    }
  }
  return (
    lines
      .flatMap(urlsOf)
      .map(webUrl)
      .find((url): url is string => url !== null && isTicketShop(url)) ?? null
  )
}

/** What the hash covers: the event as the venue edits it, without counters and timestamps. */
function rawOf(ev: SquarespaceEvent): string {
  const { id, title, startDate, endDate, fullUrl, sourceUrl, assetUrl, body, excerpt, location, tags, categories } = ev
  const fields = { id, title, startDate, endDate, fullUrl, sourceUrl, assetUrl, body, excerpt, location, tags, categories }
  return JSON.stringify(fields, null, 2)
}

/**
 * A Squarespace events collection as JSON (?format=json&view=list) -> plain events, from today on. Pure.
 * The list view holds every upcoming event (only past ones are paged); the calendar view holds one month.
 * Squarespace makes the editor set a start time, so it counts as stated; a show time in the text ("Showtime:
 * 20:45", after the doors) replaces it, as the 8MM Bar enters the doors as the start.
 */
export function parseSquarespace(text: string, config: IngestSourceConfig, opts: SquarespaceOptions): FeedEvent[] {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  const today = fmtDay(berlinToday(opts.now))
  const events: FeedEvent[] = []
  for (const ev of upcomingOf(text)) {
    const summary = squash(ev.title ?? '')
    if (!ev.id || !summary || typeof ev.startDate !== 'number') continue
    const start = berlinDayTime(ev.startDate)
    if (fmtDay(start.day) < today) continue

    const description = ev.body ? textOfBody(ev.body) : ''
    const lines = description.split('\n').map((line) => line.trim())
    const show = lines.map((line) => line.match(SHOW)).find(Boolean)
    const showMinutes = show ? parseTime(`${show[1]}:${show[2]}`) : null

    const hasEnd = typeof ev.endDate === 'number' && ev.endDate - ev.startDate !== DEFAULT_LENGTH_MS
    const end = hasEnd ? berlinDayTime(ev.endDate) : null

    const place = ev.location ?? {}
    const room = squash(place.addressTitle ?? '') || config.default_location
    const address = [place.addressTitle, place.addressLine1, place.addressLine2].map((part) => squash(part ?? '')).filter(Boolean)
    const tickets = ticketLink(lines)
    const raw = rawOf(ev)

    events.push({
      externalId: ev.id,
      uid: ev.id,
      summary,
      description,
      start: berlinMoment(start.day, showMinutes ?? start.minutes),
      end: end ? berlinMoment(end.day, end.minutes) : null,
      url: webUrl(ev.sourceUrl || null) ?? new URL(ev.fullUrl, opts.pageUrl).href,
      imageUrl: webUrl(ev.assetUrl || null),
      locationRoom: room,
      locationText: address.length ? address.join(', ') : room,
      timesStated: true,
      ...(tickets ? { links: { tickets } } : {}),
      raw,
      hash: createHash('sha256').update(raw).digest('hex'),
    })
  }
  return events
}
