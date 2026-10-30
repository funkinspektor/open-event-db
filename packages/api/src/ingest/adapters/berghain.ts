import { createHash } from 'node:crypto'
import { parse, serializeOuter } from 'parse5'
import type { IngestSourceConfig, Lineup, LineupAct } from '@open-event-db/shared'
import { berlinToday, fmtDay, parseTime, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent, type FeedMoment } from './ical.js'
import { attr, berlinMoment, elements, hasClass, isElement, richText, squash, textOf, webUrl, type Element, type Node } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** "Gast - Abgesagt!", "Yosho - Verschoben!", "Zoh Amba - Verlegt ins Bi Nuu": such cards stay listed. */
const CANCELLED = /\s[-–]\s*(?:abgesagt|verschoben|verlegt)\b/i
const EVENT_PATH = /^\/de\/event\/(\d+)\/$/
/** "2026-10-29T23:30:00+01:00": set times are Berlin wall-clock times with their offset. */
const SET_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/
const FALLBACK_IMAGE = /\/media\/images\/[^/]*-Fallback-/i

export interface BerghainOptions {
  /** A German programme listing, e.g. https://www.berghain.berlin/de/program/ or …/de/program/kantine-am-berghain/. */
  pageUrl: string
  now: Date
  /** Fetches an event's page: only there are its running order, tickets, text and flyer. */
  fetchText: (url: string) => Promise<string>
}

/** One card of a programme listing. */
export interface BerghainCard {
  /** The number in /de/event/<id>/. */
  externalId: string
  url: string
  title: string
  day: CalendarDay
  /** "HH:MM" as listed ("tür 19:30 beginn 21:00"); either may be missing. */
  doors: string | null
  start: string | null
  /** The floors (Berghain, Panorama Bar, Säule) or the house (Kantine am Berghain), as listed. */
  rooms: string[]
  raw: string
}

const isGerman = (doc: Node) => [...elements(doc)].some((el) => el.tagName === 'html' && attr(el, 'lang') === 'de')

/** The cards of a listing, as listed (soonest first). An empty listing ("Aktuell keine Veranstaltungen") is no error. Pure. */
export function parseBerghainListing(html: string, pageUrl: string): BerghainCard[] {
  const doc = parse(html)
  // The cancelled markers and the description's words are German: the English pages would need their own
  if (!isGerman(doc)) throw new FeedParseError('Not a German page: the source URL must be a /de/program/ listing')
  const all = [...elements(doc)]

  const cards: BerghainCard[] = []
  for (const a of all) {
    const id = a.tagName === 'a' ? attr(a, 'href')?.match(EVENT_PATH)?.[1] : undefined
    if (!id) continue
    const inside = [...elements(a)]
    const when = inside.find((el) => el.tagName === 'p')
    const whenText = when ? squash(textOf(when)) : ''
    const date = whenText.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/)
    const title = inside.find((el) => el.tagName === 'h2')
    if (!date || !title) continue
    cards.push({
      externalId: id,
      url: new URL(attr(a, 'href')!, pageUrl).href,
      title: squash(textOf(title)),
      day: { year: Number(date[3]), month: Number(date[2]), day: Number(date[1]) },
      doors: whenText.match(/\btür (\d{1,2}:\d{2})\b/i)?.[1] ?? null,
      start: whenText.match(/\bbeginn (\d{1,2}:\d{2})\b/i)?.[1] ?? null,
      rooms: inside.filter((el) => el.tagName === 'h3').map((el) => squash(textOf(el))),
      raw: serializeOuter(a),
    })
  }
  if (cards.length === 0 && !all.some((el) => el.tagName === 'h1' && squash(textOf(el)).startsWith('Programm'))) {
    throw new FeedParseError('No programme (a[href^="/de/event/"]) on the page')
  }
  return cards
}

/** One entry of the running order: "20:30 Jonathan Fitoussi (Live) – Transversales Disques". */
function setOf(li: Element): { act: LineupAct; end: string | null } | null {
  const info = [...elements(li)].find((el) => hasClass(el, 'running-order-set__info'))
  const actEl = info?.childNodes.find((c): c is Element => isElement(c) && c.tagName === 'span')
  if (!actEl) return null
  let live = false
  let label = ''
  const name: string[] = []
  for (const child of actEl.childNodes) {
    if (isElement(child) && attr(child, 'data-set-item-live') !== null) live = true
    else if (isElement(child) && hasClass(child, 'font-normal')) label = squash(textOf(child))
    else name.push(textOf(child)) // "Spekki Webu<br>b2b<br>Lilian Stark" is one act
  }
  const act = squash(name.join(' '))
  if (!act) return null
  const time = [...elements(li)].find((el) => el.tagName === 'time')
  return {
    act: { name: act, time: (time && squash(textOf(time))) || null, live, note: label || null },
    end: attr(li, 'data-set-item-end') || null,
  }
}

/** The latest end of any set, if the running order has times. */
function endOf(ends: string[]): FeedMoment | null {
  const latest = ends
    .map((end) => end.match(SET_TIME))
    .filter((m) => m !== null)
    .map((m) => ({ key: `${m[1]}-${m[2]}-${m[3]}T${m[4]}`, day: { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }, time: m[4]! }))
    .sort((a, b) => (a.key < b.key ? 1 : -1))[0]
  return latest ? berlinMoment(latest.day, parseTime(latest.time)) : null
}

/** Drops the page's inline scripts, which are code, not event. */
function withoutScripts(node: Node): void {
  if (!('childNodes' in node)) return
  node.childNodes = node.childNodes.filter((c) => !(isElement(c) && c.tagName === 'script'))
  node.childNodes.forEach(withoutScripts)
}

/** An event page and its card → the feed event. Pure. */
export function parseBerghainDetail(html: string, card: BerghainCard): FeedEvent {
  const main = [...elements(parse(html))].find((el) => el.tagName === 'main')
  if (!main) throw new FeedParseError(`No event (main) on ${card.url}`)
  withoutScripts(main)
  const all = [...elements(main)]

  const lineup: Lineup = []
  const ends: string[] = []
  for (const floor of all.filter((el) => attr(el, 'data-set-floor') !== null)) {
    const sets = [...elements(floor)]
      .filter((el) => el.tagName === 'li' && attr(el, 'data-set-item') !== null)
      .map(setOf)
      .filter((set) => set !== null)
    if (sets.length === 0) continue
    // The Kantine's single floor has no heading of its own
    const heading = [...elements(floor)].find((el) => el.tagName === 'h2')
    lineup.push({ name: (heading && squash(textOf(heading))) || null, acts: sets.map((s) => s.act) })
    ends.push(...sets.flatMap((s) => (s.end ? [s.end] : [])))
  }

  const tickets = all.find(
    (el) => el.tagName === 'div' && el.childNodes.some((c) => isElement(c) && c.tagName === 'h2' && squash(textOf(c)) === 'Tickets'),
  )
  const ticketLines = tickets
    ? [...elements(tickets)].filter((el) => el.tagName === 'p').map((p) => squash(textOf(p))).filter(Boolean)
    : []
  const ticketLink = tickets && [...elements(tickets)].find((el) => el.tagName === 'a')
  const texts = all.filter((el) => hasClass(el, 'rich-text')).map(richText).filter(Boolean)

  const description = [
    card.doors ? `Einlass ${card.doors}` : '',
    ticketLines.length > 0 ? `Tickets: ${ticketLines.join(' · ')}` : '',
    ...texts,
  ]
    .filter(Boolean)
    .join('\n\n')

  const links: Record<string, string> = {}
  const ticketUrl = webUrl(ticketLink ? attr(ticketLink, 'href') : null)
  if (ticketUrl) links.tickets = ticketUrl

  const figure = all.find((el) => el.tagName === 'figure')
  const img = figure && [...elements(figure)].find((el) => el.tagName === 'img')
  const src = img ? attr(img, 'src') : null
  let imageUrl: string | null = null
  try {
    imageUrl = src ? new URL(src, card.url).href : null
  } catch {
    // an unreadable src leaves the event without an image
  }
  // Nights without a flyer show the month's stand-in artwork, the same on every one of them
  if (imageUrl && FALLBACK_IMAGE.test(imageUrl)) imageUrl = null

  const raw = [card.raw, serializeOuter(main)].join('\n')
  return {
    externalId: card.externalId,
    uid: card.url,
    summary: card.title,
    description,
    lineup,
    start: berlinMoment(card.day, parseTime(card.start)),
    end: endOf(ends),
    url: card.url,
    imageUrl,
    locationRoom: card.rooms[0] ?? null,
    locationText: card.rooms.join(', ') || null,
    timesStated: card.start !== null,
    links,
    raw,
    hash: createHash('sha256').update(raw).digest('hex'),
  }
}

/**
 * A berghain.berlin programme listing (Club, Kantine am Berghain or Halle), then each upcoming event's page,
 * one after another. Cancelled, postponed and moved events are left out. A page that cannot be fetched
 * fails the run: leaving its event out would mark it gone.
 */
export async function readBerghain(html: string, config: IngestSourceConfig, opts: BerghainOptions): Promise<FeedEvent[]> {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  const today = fmtDay(berlinToday(opts.now))
  const events = new Map<string, FeedEvent>()
  for (const card of parseBerghainListing(html, opts.pageUrl)) {
    if (fmtDay(card.day) < today || CANCELLED.test(card.title) || events.has(card.externalId)) continue
    let page: string
    try {
      page = await opts.fetchText(card.url)
    } catch (err) {
      throw new Error(`Detail page ${card.url}: ${err instanceof Error ? err.message : String(err)}`)
    }
    events.set(card.externalId, parseBerghainDetail(page, card))
  }
  return [...events.values()]
}
