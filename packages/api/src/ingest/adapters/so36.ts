import { createHash } from 'node:crypto'
import { parse, parseFragment } from 'parse5'
import type { IngestSourceConfig } from '@open-event-db/shared'
import { berlinToday, fmtDay, parseTime, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { attr, berlinMoment, elements, hasClass, richText, squash, textOf, type Element, type Node } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** Club nights whose start the shop does not know get this instead. */
const PLACEHOLDER_TIMES = new Set(['23:59'])
/** "Di 10.11.2026" in the listing's date column. */
const LISTED_DAY = /(\d{1,2})\.(\d{1,2})\.(\d{4})/
/** An event the shop calls off in its title or subtitle; JSON-LD's eventStatus says so too. */
const CANCELLED = /\b(?:abgesagt|cancell?ed|entfällt)\b/i
const GONE_STATUSES = new Set(['https://schema.org/EventCancelled', 'https://schema.org/EventPostponed'])
/** The category label above the title; "Event" says nothing. */
const NO_KIND = new Set(['', 'Event'])

export interface So36Options {
  /** The listing's JSON (the location page's table, `?pagesize=…&table_id=…`), to resolve the event links. */
  pageUrl: string
  now: Date
  /** Fetches an event's page: only there are its text, doors, category and full image. */
  fetchText: (url: string) => Promise<string>
}

/** One row of the shop's listing table, as the JSON gives it (each cell is a piece of HTML). */
export interface So36Row {
  /** The shop's product id ("99538"). */
  externalId: string
  url: string
  title: string
  subtitle: string
  day: CalendarDay
  /** "HH:MM", the start ("Beginn"). */
  start: string | null
  /** The room, "SO36" as the location column's subtitle says. */
  room: string | null
  soldOut: boolean
}

interface ListingJson {
  data: Record<string, unknown>[]
  meta?: { total?: number }
}

const fragment = (html: unknown): Node => parseFragment(typeof html === 'string' ? html : '') as Node
const find = (root: Node, test: (el: Element) => boolean) => [...elements(root)].find(test) ?? null
/** A cell's two parts: `<strong>WALLS OF JERICHO</strong> <small class="subtitle">Special Guest: …</small>`. */
function cellParts(html: unknown): { main: string; sub: string } {
  const root = fragment(html)
  const strong = find(root, (el) => el.tagName === 'strong')
  const sub = find(root, (el) => el.tagName === 'small' && hasClass(el, 'subtitle'))
  return { main: strong ? squash(textOf(strong)) : '', sub: sub ? squash(textOf(sub)) : '' }
}

function rowOf(row: Record<string, unknown>, pageUrl: string): So36Row {
  const link = find(fragment(row['articles:image']), (el) => el.tagName === 'a')
    ?? find(fragment(row['articles:_actions']), (el) => el.tagName === 'a')
  const href = link ? attr(link, 'href') : null
  const id = row.id
  const title = cellParts(row['articles:title'])
  const date = cellParts(row['articles:valid_start_on'])
  const day = date.main.match(LISTED_DAY)
  if (!href || (typeof id !== 'number' && typeof id !== 'string') || !title.main || !day) {
    throw new FeedParseError('A listing row without its link, id, title or date')
  }
  const classes = (row._row_config as { class?: unknown } | undefined)?.class
  return {
    externalId: String(id),
    url: new URL(href, pageUrl).href,
    title: title.main,
    subtitle: title.sub,
    day: { year: Number(day[3]), month: Number(day[2]), day: Number(day[1]) },
    start: /^\d{1,2}:\d{2}$/.test(date.sub) ? date.sub : null,
    room: cellParts(row['location:title']).sub || null,
    soldOut: typeof classes === 'string' && classes.split(/\s+/).includes('sold_out_status_sold_out'),
  }
}

/** The listing JSON's rows; a listing cut short by its page size is an error, its missing events would go. */
export function parseSo36Listing(text: string, pageUrl: string): So36Row[] {
  let json: ListingJson
  try {
    json = JSON.parse(text) as ListingJson
  } catch {
    throw new FeedParseError('The listing is not JSON (is the source URL the table\'s JSON, with table_id=…?)')
  }
  if (!json || !Array.isArray(json.data)) throw new FeedParseError('No listing (data: […]) in the JSON')
  const total = json.meta?.total
  if (typeof total === 'number' && total > json.data.length) {
    throw new FeedParseError(`The listing shows ${json.data.length} of ${total} events: raise pagesize= in the source URL`)
  }
  return json.data.map((row) => rowOf(row, pageUrl))
}

/** The page's schema.org Event, as its JSON-LD gives it. */
interface LdEvent {
  eventStatus?: string
  image?: string | string[]
  description?: string
  offers?: { price?: string | number }[] | { price?: string | number }
}

function ldEventOf(all: Element[]): LdEvent | null {
  for (const script of all.filter((el) => el.tagName === 'script' && attr(el, 'type') === 'application/ld+json')) {
    try {
      const json: unknown = JSON.parse(textOf(script))
      const found = (Array.isArray(json) ? json : [json]).find((item) => (item as { '@type'?: unknown })?.['@type'] === 'Event')
      if (found) return found as LdEvent
    } catch {
      // another script's broken JSON is not the event's
    }
  }
  return null
}

/** "33,10 €" for each distinct price above zero, lowest first. */
function pricesOf(ld: LdEvent | null): string[] {
  const offers = ld?.offers ? (Array.isArray(ld.offers) ? ld.offers : [ld.offers]) : []
  const prices = [...new Set(offers.map((o) => Number(o.price)).filter((p) => Number.isFinite(p) && p > 0))].sort((a, b) => a - b)
  return prices.map((p) => `${p.toFixed(2).replace('.', ',')} €`)
}

/**
 * "WALLS OF JERICHO" as the text writes it ("Walls Of Jericho"), if it does: a whole-word match that is not
 * all caps and starts with a capital, so "die wallerts" in a sentence is no spelling. Mixed case stays as listed.
 */
export function readableTitle(title: string, text: string): string {
  if (title !== title.toUpperCase() || !/\p{L}/u.test(title)) return title
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  for (const m of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'))) {
    const first = m[0].match(/\p{L}/u)?.[0] ?? ''
    if (m[0] !== m[0].toUpperCase() && first === first.toUpperCase()) return squash(m[0])
  }
  return title
}

/**
 * The listing row and its event page → the event, or null when the page calls it cancelled or postponed.
 * Prices and the sold-out mark are read; the offers' stock is not.
 */
export function parseSo36Detail(html: string, row: So36Row): FeedEvent | null {
  const all = [...elements(parse(html))]
  const ld = ldEventOf(all)
  if (ld?.eventStatus && GONE_STATUSES.has(ld.eventStatus)) return null
  const meta = all.find((el) => el.tagName === 'div' && hasClass(el, 'meta'))
  const metaText = meta ? squash(textOf(meta)) : ''
  const doors = metaText.match(/Einlass:\s*(\d{1,2}:\d{2})/)?.[1] ?? null
  const start = row.start ?? metaText.match(/Beginn:\s*(\d{1,2}:\d{2})/)?.[1] ?? doors
  const label = all.find((el) => el.tagName === 'small' && hasClass(el, 'supertitle') && !hasClass(el, 'ticketsfor'))
  const kind = label ? squash(textOf(label)) : ''
  // richText walks elements only: the editor's HTML goes into a <div> of its own
  const body = ld?.description ? find(fragment(`<div>${ld.description}</div>`), (el) => el.tagName === 'div') : null
  const text = body ? richText(body) : ''
  const prices = pricesOf(ld)
  const image = Array.isArray(ld?.image) ? ld.image[0] : ld?.image
  let imageUrl: string | null = null
  try {
    imageUrl = image ? new URL(image, row.url).href : null
  } catch {
    // an unreadable image leaves the event without one
  }

  const description = [
    NO_KIND.has(kind) ? '' : kind,
    row.subtitle,
    row.soldOut ? 'Ausverkauft' : '',
    doors && doors !== start && !PLACEHOLDER_TIMES.has(doors) ? `Einlass ${doors}` : '',
    prices.length ? `Tickets: ${prices.join(' · ')}` : '',
    text,
  ]
    .filter(Boolean)
    .join('\n\n')

  // What an editor wrote, not the page around it: the cart, the session token and the stock change by the hour
  const raw = JSON.stringify({ ...row, kind, doors, prices, imageUrl, text: ld?.description ?? '' })
  return {
    externalId: row.externalId,
    uid: row.url,
    summary: readableTitle(row.title, text),
    description,
    start: berlinMoment(row.day, parseTime(start)),
    end: null,
    url: row.url,
    imageUrl,
    locationRoom: row.room,
    locationText: row.room,
    timesStated: start !== null && !PLACEHOLDER_TIMES.has(start),
    raw,
    hash: createHash('sha256').update(raw).digest('hex'),
  }
}

/**
 * The SO36's ticket shop (so36.com, a tickettoaster shop): the location page's table as JSON, every upcoming
 * event in one request, then each event's page, one after another. Cancelled and postponed events are left
 * out, so they turn up as gone. A page that cannot be fetched fails the run: leaving its event out would mark
 * it gone.
 */
export async function readSo36(text: string, config: IngestSourceConfig, opts: So36Options): Promise<FeedEvent[]> {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  const today = fmtDay(berlinToday(opts.now))
  const events = new Map<string, FeedEvent>()
  for (const row of parseSo36Listing(text, opts.pageUrl)) {
    if (fmtDay(row.day) < today || events.has(row.externalId)) continue
    if (CANCELLED.test(`${row.title} ${row.subtitle}`)) continue
    let page: string
    try {
      page = await opts.fetchText(row.url)
    } catch (err) {
      throw new Error(`Event page ${row.url}: ${err instanceof Error ? err.message : String(err)}`)
    }
    const event = parseSo36Detail(page, row)
    if (event) events.set(row.externalId, event)
  }
  return [...events.values()]
}
