import { createHash } from 'node:crypto'
import { parse, serializeOuter } from 'parse5'
import type { IngestSourceConfig } from '@open-event-db/shared'
import { berlinToday, fmtDay, parseTime, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { attr, berlinMoment, elements, hasClass, richText, squash, textOf, webUrl, type Element } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** Concert room, Biergarten and Galerie share one address; map it with `venues: { 'Urban Spree': … }`. */
const LOCATION = 'Urban Spree'
/** Club nights whose start the site does not know get one of these instead. */
const PLACEHOLDER_TIMES = new Set(['00:00', '23:59'])

export interface UrbanSpreeOptions {
  /** The listing URL, e.g. https://www.urbanspree.com/program/?limit=100 (newest first). */
  pageUrl: string
  now: Date
  /** Fetches an event's detail page: only there are its description and ticket link. */
  fetchText: (url: string) => Promise<string>
}

/** One card of the programme listing. */
export interface UrbanSpreeCard {
  kind: 'concert' | 'event' | 'exhibit'
  /** The detail page's path below program/, without ".html": the site has no other id for concerts. */
  externalId: string
  url: string
  /** As shown on the card, cut with "…" when long. */
  title: string
  day: CalendarDay
  /** "HH:MM"; null for exhibitions, which have dates only. */
  time: string | null
  /** An exhibition's last day. */
  endDay: CalendarDay | null
  imageUrl: string | null
  raw: string
}

const CANCELLED = /^(?:cancell?ed|abgesagt|postponed|verschoben)\b/i
const SOLD_OUT = /^(?:sold[\s-]*out|ausverkauft)\b[\s!:|–—-]*/i
const SEPARATOR = /\s+[-–—]\s+|\s*[|•@,]\s*/g
const VENUE_WORDS = new Set(['urban', 'spree', 'berlin', 'live', 'in', 'at', 'show', 'germany'])
const SHORT_DATE = /^\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})?$/
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "Urban Spree, Berlin", "Berlin Show", "29.10.2026": the place and day, which the event's own fields hold. */
function isVenueSegment(segment: string): boolean {
  const words = segment.toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (words.length === 1 && SHORT_DATE.test(words[0]!)) return true
  return words.every((w) => VENUE_WORDS.has(w)) && (words.length === 0 || words.some((w) => w === 'berlin' || w === 'spree'))
}

/**
 * "SOLD OUT - Tigercub - NETS TO CATCH THE WIND - Berlin" → "Tigercub - NETS TO CATCH THE WIND", sold out.
 * Only trailing segments that name nothing but the venue, the city or the date are dropped.
 */
export function cleanTitle(heading: string): { title: string; soldOut: boolean } {
  const full = squash(heading)
  const soldOut = SOLD_OUT.test(full)
  let title = full.replace(SOLD_OUT, '')
  for (;;) {
    const last = [...title.matchAll(SEPARATOR)].at(-1)
    if (!last || last.index === 0 || !isVenueSegment(title.slice(last.index + last[0].length))) break
    title = title.slice(0, last.index)
  }
  return { title: title || full, soldOut }
}

/** "2026-10-29 20:00:00" or "2026-11-06" from a card's data attribute. */
function dataDate(value: string | null): { day: CalendarDay; time: string | null } | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/)
  if (!m) return null
  return { day: { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }, time: m[4] ?? null }
}

/** "Nov 06, 2026 18:00" as the detail pages write it. */
function siteDate(text: string): { day: CalendarDay; minutes: number | null } | null {
  const m = squash(text).match(/^([a-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})(?: (\d{1,2}:\d{2}))?$/i)
  const month = m ? MONTHS.indexOf(m[1]!.toLowerCase()) + 1 : 0
  if (!m || month === 0) return null
  return { day: { year: Number(m[3]), month, day: Number(m[2]) }, minutes: parseTime(m[4] ?? null) }
}

const fmtDe = ({ year, month, day }: CalendarDay) =>
  `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`

/** The bare event link, without the `acontext` blob the site copies along. */
function facebookEvent(href: string | null): string | null {
  const m = href?.match(/^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/events\/(\d+)/)
  return m ? `https://www.facebook.com/events/${m[1]}` : null
}

/** The cards of the programme listing, as listed (newest first). Pure. */
export function parseUrbanSpreeListing(html: string, pageUrl: string): UrbanSpreeCard[] {
  const all = [...elements(parse(html))]
  // Card links are relative to <base href>, not to the listing's own /program/ path
  const baseHref = all.find((el) => el.tagName === 'base')
  const base = new URL((baseHref && attr(baseHref, 'href')) ?? '', pageUrl).href

  const cards: UrbanSpreeCard[] = []
  for (const a of all) {
    if (a.tagName !== 'a' || attr(a, 'data-slidertype') === null) continue
    const start = dataDate(attr(a, 'data-datestart')) // parse5 lowercases data-dateStart
    const href = attr(a, 'href')
    if (!start || !href) continue

    const chunk = attr(a, 'data-chunk') ?? ''
    const kind = chunk.endsWith('_exhibit') ? 'exhibit' : chunk.endsWith('_concert') ? 'concert' : 'event'
    const url = new URL(href, base)
    let imageUrl: string | null = null
    const image = attr(a, 'data-imgfeat')
    if (image) imageUrl = new URL(image, base).href
    const titleEl = [...elements(a)].find((el) => el.tagName === 'p' && hasClass(el, 'title'))

    // data-getdate is the day the page was served: it would make every run look like a change
    a.attrs = a.attrs.filter((x) => x.name !== 'data-getdate')
    cards.push({
      kind,
      externalId: decodeURIComponent(url.pathname)
        .replace(/^\/(?:program\/)?/, '')
        .replace(/\.html$/, ''),
      url: url.href,
      title: titleEl ? squash(textOf(titleEl)) : '',
      day: start.day,
      time: kind === 'exhibit' ? null : start.time,
      endDay: kind === 'exhibit' ? (dataDate(attr(a, 'data-dateend'))?.day ?? null) : null,
      imageUrl,
      raw: serializeOuter(a),
    })
  }
  return cards
}

/**
 * A detail page and its card → the feed event, or null when there is none to import: cancelled, or an
 * exhibition whose opening is over, unknown, or listed as an event of its own. Pure.
 */
export function parseUrbanSpreeDetail(
  html: string,
  card: UrbanSpreeCard,
  ctx: { today: CalendarDay; cards: UrbanSpreeCard[] },
): FeedEvent | null {
  const all = [...elements(parse(html))]
  const h1 = all.find((el) => el.tagName === 'h1' && hasClass(el, 'title'))
  if (!h1) throw new FeedParseError(`No event title (h1.title) on ${card.url}`)
  const heading = textOf(h1)
  if (CANCELLED.test(squash(heading))) return null

  const infoEls = all.filter((el) => el.tagName === 'div' && hasClass(el, 'ct-info'))
  const info = new Map<string, Element>()
  for (const el of infoEls) {
    const label = [...elements(el)].find((c) => hasClass(c, 'info-label'))
    const data = [...elements(el)].find((c) => hasClass(c, 'info-data'))
    if (label && data) info.set(squash(textOf(label)).toLowerCase(), data)
  }
  const pseudoCard = all.find((el) => attr(el, 'id') === 'pseudo-card')
  const body = all.find((el) => hasClass(el, 'rte') && hasClass(el, 'tv-content'))
  const price = all.find((el) => el.tagName === 'li' && hasClass(el, 'price'))
  const ticket = pseudoCard && [...elements(pseudoCard)].find((el) => el.tagName === 'a' && /ticket/i.test(textOf(el)))
  const fb = info.get('fb event')
  const fbLink = fb && [...elements(fb)].find((el) => el.tagName === 'a')

  const header: string[] = []
  let summary: string
  let start: { day: CalendarDay; minutes: number | null }
  let timesStated: boolean
  if (card.kind === 'exhibit') {
    // The heading is "ARTISTS:\n TITLE"; the event is the opening night
    const m = heading.match(/^\s*([^\n]*?)\s*:\s*\n([\s\S]+)$/)
    const title = squash(m ? m[2]! : heading)
    const vernissage = info.get('vernissage')
    const opening = vernissage ? siteDate(textOf(vernissage)) : null
    if (!opening || fmtDay(opening.day) < fmtDay(ctx.today)) return null
    const listedOpening = ctx.cards.some(
      (c) =>
        c.kind !== 'exhibit' &&
        fmtDay(c.day) === fmtDay(opening.day) &&
        c.title.toLowerCase().includes(title.toLowerCase()),
    )
    if (listedOpening) return null
    summary = `Vernissage: ${title}`
    start = opening
    timesStated = opening.minutes !== null
    const artists = m ? squash(m[1]!) : ''
    if (artists) header.push(`Mit ${artists}`)
    if (card.endDay) header.push(`Ausstellung ${fmtDe(card.day)}–${fmtDe(card.endDay)}`)
    const hours = info.get('opening hours')
    if (hours && squash(textOf(hours))) header.push(`Öffnungszeiten: ${squash(textOf(hours))}`)
  } else {
    const { title, soldOut } = cleanTitle(heading)
    summary = title
    start = { day: card.day, minutes: parseTime(card.time) }
    timesStated = card.time !== null && !PLACEHOLDER_TIMES.has(card.time)
    if (soldOut) header.push('Ausverkauft')
  }

  const priceText = price ? squash(textOf(price)) : ''
  const entry = /^(?:free(?: entry)?|(?:eintritt )?frei|kostenlos)$/i.test(priceText) ? 'Eintritt frei' : priceText ? `Eintritt: ${priceText}` : ''
  const description = [header.join('\n'), body ? richText(body) : '', entry].filter(Boolean).join('\n\n')

  const links: Record<string, string> = {}
  const tickets = webUrl(ticket ? attr(ticket, 'href') : null)
  if (tickets) links.tickets = tickets
  const facebook = facebookEvent(fbLink ? attr(fbLink, 'href') : null)
  if (facebook) links.facebook = facebook

  // The page around these parts lists other events, which must not count as a change of this one
  const parts = [pseudoCard, ...infoEls, body].filter((el) => el !== undefined)
  const raw = [card.raw, ...parts.map((el) => serializeOuter(el))].join('\n')
  return {
    externalId: card.externalId,
    uid: card.url,
    summary,
    description,
    start: berlinMoment(start.day, start.minutes),
    end: null,
    url: card.url,
    imageUrl: card.imageUrl,
    locationRoom: LOCATION,
    locationText: LOCATION,
    timesStated,
    links,
    raw,
    hash: createHash('sha256').update(raw).digest('hex'),
  }
}

/**
 * The urbanspree.com programme: the listing for dates and images, then each upcoming event's detail page,
 * one after another. A detail page that cannot be fetched fails the run: leaving its event out would mark
 * it gone.
 */
export async function readUrbanSpree(html: string, config: IngestSourceConfig, opts: UrbanSpreeOptions): Promise<FeedEvent[]> {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  const cards = parseUrbanSpreeListing(html, opts.pageUrl)
  if (cards.length === 0) throw new FeedParseError('No programme cards (a[data-dateStart]) on the listing')
  const today = berlinToday(opts.now)
  // The listing is newest first and cut at ?limit=: without a past card, upcoming ones may be cut off
  if (!cards.some((c) => fmtDay(c.day) < fmtDay(today))) {
    throw new FeedParseError('The listing has no past event, so it may stop before today: raise ?limit= in the source URL')
  }

  const events = new Map<string, FeedEvent>()
  for (const card of cards) {
    if (fmtDay(card.endDay ?? card.day) < fmtDay(today) || CANCELLED.test(card.title) || events.has(card.externalId)) continue
    let page: string
    try {
      page = await opts.fetchText(card.url)
    } catch (err) {
      throw new Error(`Detail page ${card.url}: ${err instanceof Error ? err.message : String(err)}`)
    }
    const ev = parseUrbanSpreeDetail(page, card, { today, cards })
    if (ev) events.set(ev.externalId, ev)
  }
  return [...events.values()]
}
