import { createHash } from 'node:crypto'
import { parse, serializeOuter } from 'parse5'
import type { IngestSourceConfig } from '@open-event-db/shared'
import { berlinToday, fmtDay, parseTime, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { attr, berlinMoment, elements, hasClass, isElement, richText, squash, textOf, webUrl, type Element } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** The club is one room; map it with `venues: { Schokoladen: … }`. */
const LOCATION = 'Schokoladen'
/** The listing is paged by tens; a runaway pager stops here. */
const MAX_PAGES = 30
/** "19:00 Uhr" in the event's heading: the doors. */
const LISTED_TIME = /^(\d{1,2}[:.]\d{2})(?:\s*uhr)?$/i
/** "show 20:00", "Show 20h", "Beginn 20h", "starts 20:30" in the "Time" facts. */
const SHOW = /\b(?:show|beginn|starts?)\b\s*:?\s*(\d{1,2})(?:[:.](\d{2})|\s*(?:h|uhr)\b)/i
/** "19:00 Einlass 20:00 Konzert": the time before the word. */
const SHOW_BEFORE = /\b(\d{1,2})[:.](\d{2})\s*(?:uhr\s*)?(?:konzert|show|beginn)\b/i
const SOLD_OUT = /\s*\((?:ausverkauft|sold[\s-]*out)\)\s*/i
const CANCELLED = /\b(?:abgesagt|cancell?ed|verschoben|postponed)\b/i

export interface SchokoladenOptions {
  /** The programme, https://www.schokoladen-mitte.de/: its further pages are ?page=2 and on. */
  pageUrl: string
  now: Date
  /** Fetches the further listing pages and the calendar, which alone has the events' ids. */
  fetchText: (url: string) => Promise<string>
}

/** One event as the listing shows it: the heading row, then the collapsed facts, text and flyers. */
export interface SchokoladenCard {
  day: CalendarDay
  /** "19:00" from the heading, the doors. */
  listedTime: string | null
  category: string
  promoter: string
  title: string
  subtitle: string
  /** The "Time" facts, e.g. "doors 19:00 - show 20:00". */
  times: string
  tickets: string | null
  imageUrl: string | null
  body: Element | null
  raw: string
}

/** An event of the site's calendar JSON (/calendar): every upcoming event, with its id. */
interface CalendarEntry {
  id: number | string
  date: string
  title: string
}

const firstOf = (root: Element, test: (el: Element) => boolean) => [...elements(root)].find(test) ?? null
const textIn = (root: Element, test: (el: Element) => boolean) => {
  const el = firstOf(root, test)
  return el ? squash(textOf(el)) : ''
}

/** "2026-10-31" → the day; null for anything else. */
function dayOf(date: string | null): CalendarDay | null {
  const m = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null
}

/**
 * A listing page → its events in order. Each event is a div.event holding two containers: the heading row
 * (date, category, promoter, title, subtitle) and the facts and text, in a div.event-info with the date.
 */
export function parseSchokoladenListing(html: string, pageUrl: string): { cards: SchokoladenCard[]; isProgramme: boolean } {
  const all = [...elements(parse(html))]
  const cards: SchokoladenCard[] = []
  for (const event of all.filter((el) => el.tagName === 'div' && hasClass(el, 'event'))) {
    const info = firstOf(event, (el) => hasClass(el, 'event-info'))
    const day = info ? dayOf(attr(info, 'data-event-date')) : null
    const title = textIn(event, (el) => el.tagName === 'h2')
    if (!info || !day || !title) continue

    const heading = firstOf(event, (el) => hasClass(el, 'event-date'))
    const listed = heading ? [...elements(heading)].filter((el) => el.tagName === 'span').map((el) => squash(textOf(el))) : []
    const listedTime = listed.map((text) => text.match(LISTED_TIME)?.[1]).find(Boolean) ?? null

    // "Time" is a <strong> in an unclosed <p>: the facts are the span after it
    const facts = firstOf(info, (el) => hasClass(el, 'event-facts'))
    const timeLabel = facts ? firstOf(facts, (el) => el.tagName === 'strong' && squash(textOf(el)) === 'Time') : null
    const timeSpan = timeLabel?.parentNode ? timeLabel.parentNode.childNodes.filter(isElement).find((el) => el.tagName === 'span') : undefined
    const ticket = firstOf(info, (el) => el.tagName === 'a' && hasClass(el, 'ticket-btn'))
    // Several flyers are a carousel, a single one sits in an .imageWrapper
    const slide = firstOf(info, (el) => hasClass(el, 'carousel-item') || hasClass(el, 'imageWrapper'))
    const img = slide ? firstOf(slide, (el) => el.tagName === 'img') : null

    cards.push({
      day,
      listedTime,
      category: textIn(event, (el) => el.tagName === 'h6' && hasClass(el, 'category')),
      promoter: textIn(event, (el) => el.tagName === 'span' && hasClass(el, 'promoter')),
      title,
      subtitle: textIn(event, (el) => el.tagName === 'h6' && hasClass(el, 'subtitle')),
      times: timeSpan ? squash(textOf(timeSpan)) : '',
      tickets: webUrl(ticket ? attr(ticket, 'href') : null),
      imageUrl: imageUrl(img ? attr(img, 'src') : null, pageUrl),
      body: firstOf(info, (el) => hasClass(el, 'event-description')),
      raw: serializeOuter(event),
    })
  }
  const isProgramme = all.some((el) => attr(el, 'id') === 'calendar')
  return { cards, isProgramme }
}

function imageUrl(src: string | null, pageUrl: string): string | null {
  if (!src) return null
  try {
    return webUrl(new URL(src, pageUrl).href)
  } catch {
    return null // an unreadable src leaves the event without an image
  }
}

/** The last page the first one links to ("?page=8"); Laravel's pager always shows the last pages. */
const lastPage = (html: string) => Math.max(1, ...[...html.matchAll(/href="\?page=(\d+)"/g)].map((m) => Number(m[1])))

function calendarOf(text: string): CalendarEntry[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new FeedParseError('The calendar (/calendar) is not JSON')
  }
  if (!Array.isArray(data)) throw new FeedParseError('The calendar (/calendar) is no list of events')
  return data as CalendarEntry[]
}

/**
 * The calendar's id for a card: the event that day with the same title, else the day's only event. A series
 * (the monthly karaoke) has one id for all its dates, so its id carries the date. Without a match the day is
 * the id, as with the Slaughterhouse; the calendar has held every listed event so far.
 */
function idFor(card: SchokoladenCard, calendar: CalendarEntry[]): string | null {
  const date = fmtDay(card.day)
  const sameDay = calendar.filter((entry) => entry.date === date)
  const match = sameDay.find((entry) => squash(entry.title ?? '') === card.title) ?? (sameDay.length === 1 ? sameDay[0] : undefined)
  if (!match) return null
  const series = calendar.filter((entry) => String(entry.id) === String(match.id)).length > 1
  return series ? `${match.id}-${date}` : String(match.id)
}

/** The start: a show time in the facts ("doors 19:00 - show 20:00"), else the heading's time, the doors. */
function startOf(card: SchokoladenCard): number | null {
  const show = card.times.match(SHOW) ?? card.times.match(SHOW_BEFORE)
  const showMinutes = show ? parseTime(`${show[1]}:${show[2] ?? '00'}`) : null
  return showMinutes ?? parseTime(card.listedTime?.replace('.', ':') ?? null)
}

function descriptionOf(card: SchokoladenCard, soldOut: boolean): string {
  const header = [card.category, card.promoter, card.subtitle, soldOut ? 'Ausverkauft' : '', card.times].filter(Boolean)
  return [header.join('\n'), card.body ? richText(card.body) : ''].filter(Boolean).join('\n\n')
}

/** A card as a feed event under the given id. Pure. */
export function schokoladenEvent(card: SchokoladenCard, externalId: string, pageUrl: string): FeedEvent {
  const soldOut = SOLD_OUT.test(card.title)
  const summary = squash(card.title.replace(SOLD_OUT, ' ')) || card.title
  const start = startOf(card)
  return {
    externalId,
    uid: externalId,
    summary,
    description: descriptionOf(card, soldOut),
    start: berlinMoment(card.day, start),
    end: null,
    url: pageUrl,
    imageUrl: card.imageUrl,
    locationRoom: LOCATION,
    locationText: LOCATION,
    timesStated: start !== null,
    ...(card.tickets ? { links: { tickets: card.tickets } } : {}),
    raw: card.raw,
    hash: createHash('sha256').update(card.raw).digest('hex'),
  }
}

/**
 * The programme on schokoladen-mitte.de → plain events, from today on. The listing (?page=2 and on) has
 * everything but ids; the calendar JSON has every upcoming event's id. A page or the calendar that cannot
 * be fetched fails the run: leaving its events out would mark them gone, other ids would replace them.
 */
export async function readSchokoladen(html: string, config: IngestSourceConfig, opts: SchokoladenOptions): Promise<FeedEvent[]> {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  const first = parseSchokoladenListing(html, opts.pageUrl)
  // An empty programme is no error, a page without the programme is
  if (first.cards.length === 0 && !first.isProgramme) throw new FeedParseError('No programme (div.event with div.event-info) on the page')

  const fetchOrFail = async (url: string, what: string) => {
    try {
      return await opts.fetchText(url)
    } catch (err) {
      throw new Error(`${what} ${url}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const cards = [...first.cards]
  const pages = lastPage(html)
  if (pages > MAX_PAGES) throw new FeedParseError(`The listing has ${pages} pages, more than the ${MAX_PAGES} read`)
  for (let n = 2; n <= pages; n++) {
    const url = new URL(`?page=${n}`, opts.pageUrl).href
    cards.push(...parseSchokoladenListing(await fetchOrFail(url, 'Listing page'), opts.pageUrl).cards)
  }
  if (cards.length === 0) return []

  const calendarUrl = new URL('/calendar', opts.pageUrl).href
  const calendar = calendarOf(await fetchOrFail(calendarUrl, 'Calendar'))

  const today = fmtDay(berlinToday(opts.now))
  const events = new Map<string, FeedEvent>()
  for (const card of cards) {
    const date = fmtDay(card.day)
    if (date < today || CANCELLED.test(card.title)) continue
    let externalId = idFor(card, calendar) ?? date
    for (let n = 2; events.has(externalId); n++) externalId = `${date}-${n}`
    events.set(externalId, schokoladenEvent(card, externalId, opts.pageUrl))
  }
  return [...events.values()]
}
