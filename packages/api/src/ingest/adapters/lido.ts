import { createHash } from 'node:crypto'
import { parse, serializeOuter } from 'parse5'
import type { IngestSourceConfig } from '@open-event-db/shared'
import { berlinToday, fmtDay, parseTime, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { attr, berlinMoment, elements, hasClass, richText, squash, textOf, webUrl, type Element } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** The club's one room; map it with `venues: { Lido: … }`. */
const LOCATION = 'Lido'
/** Club nights whose start the site does not know get this instead. */
const PLACEHOLDER_TIMES = new Set(['23:59'])
/** The site serves English or German labels, so both are read. */
const DOORS = /^(?:doors|einlass)$/i
const START = /^(?:start|beginn)$/i
const CANCELLED = /\b(?:cancell?ed|abgesagt|postponed|verschoben|entfällt)\b/i
const SOLD_OUT = /\b(?:sold[\s-]*out|ausverkauft)\b/i
const NEW_VENUE = /\b(?:new venue|neue location|neuer ort|verlegt)\b/i
/** "HOCHVERLEGT INS KESSELHAUS.", "Hochverlegt in das Columbia Theater!" */
const MOVED_TO = /verlegt\s+(?:in\s+(?:das|die|den)|ins|in|to(?:\s+the)?)\s+([^.!,;\n]+)/i

export interface LidoOptions {
  /** The programme, https://www.lido-berlin.de/ (all upcoming events on one page). */
  pageUrl: string
  now: Date
  /** Fetches an event's page: only there are its text, ticket link and flyer. */
  fetchText: (url: string) => Promise<string>
}

/** One card of the programme. */
export interface LidoCard {
  /** The event page's path below /events/ ("2026-11-01-hi--spencer"): the site has no other id. */
  externalId: string
  url: string
  title: string
  subtitle: string
  day: CalendarDay
  /** "HH:MM". */
  doors: string | null
  start: string | null
  /** "Konzert", "Party" as the card's type label says. */
  kind: string | null
  presenter: string | null
  /** The card's status labels, read in either language: they are part of `raw`, which must not flip with it. */
  statuses: Status[]
}

type Status = 'cancelled' | 'sold_out' | 'new_venue' | 'other'

function statusOf(label: string): Status {
  if (CANCELLED.test(label)) return 'cancelled'
  if (SOLD_OUT.test(label)) return 'sold_out'
  if (NEW_VENUE.test(label)) return 'new_venue'
  return 'other'
}

const childOf = (root: Element, cls: string) => [...elements(root)].find((el) => hasClass(el, cls))
const textIn = (root: Element, cls: string) => {
  const el = childOf(root, cls)
  return el ? squash(textOf(el)) : ''
}

/** "COLUMBIA THEATER" → "Columbia Theater"; mixed case stays as written. */
function readableCase(text: string): string {
  if (text !== text.toUpperCase()) return text
  return text.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

function kindOf(label: string): string | null {
  if (!label) return null
  if (/^(?:concert|konzert)$/i.test(label)) return 'Konzert'
  return label
}

function cardOf(article: Element, pageUrl: string): LidoCard {
  const link = [...elements(article)].find((el) => el.tagName === 'a' && attr(el, 'href')?.startsWith('/events/'))
  const href = link ? attr(link, 'href') : null
  const date = attr(article, 'data-realdate')?.match(/^(\d{4})-(\d{2})-(\d{2})\b/)
  if (!link || !href || !date) throw new FeedParseError('A programme card without its event link or data-realdate')

  // The desktop and mobile blocks repeat the times: the first one is enough
  const meta = childOf(article, 'event-ticket__meta') ?? article
  const times = [...elements(meta)]
    .filter((el) => hasClass(el, 'event-ticket__meta__times__time'))
    .map((el) => ({
      value: textIn(el, 'event-ticket__meta__times__time__value'),
      label: textIn(el, 'event-ticket__meta__times__time__label'),
    }))
  const time = (label: RegExp, index: number) => {
    const value = (times.find((t) => label.test(t.label)) ?? times[index])?.value ?? ''
    return /^\d{1,2}:\d{2}$/.test(value) ? value : null
  }
  const subtitle = childOf(article, 'event-ticket__content__subtitle')
  const presenter = textIn(meta, 'event-ticket__meta__presenter').replace(/\s*(?:präsentiert|presents)\s*$/i, '')

  return {
    externalId: decodeURIComponent(href.slice('/events/'.length)),
    url: new URL(href, pageUrl).href,
    title: squash(textOf(link)),
    subtitle: subtitle ? richText(subtitle) : '',
    day: { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) },
    doors: time(DOORS, 0),
    start: time(START, 1),
    kind: kindOf(textIn(article, 'event-ticket__type__label')),
    presenter: presenter || null,
    statuses: [...elements(article)]
      .filter((el) => hasClass(el, 'event-ticket__content__status__label'))
      .map((el) => squash(textOf(el)))
      .filter(Boolean)
      .map(statusOf),
  }
}

/** The programme's cards in the order listed; the "next events" teaser above them is left out. */
export function parseLidoListing(html: string, pageUrl: string): { cards: LidoCard[]; hasList: boolean } {
  const all = [...elements(parse(html))]
  const lists = all.filter((el) => el.tagName === 'div' && hasClass(el, 'event-list'))
  const cards = lists
    .flatMap((list) => [...elements(list)])
    .filter((el) => el.tagName === 'article' && hasClass(el, 'event-ticket'))
    .map((article) => cardOf(article, pageUrl))
  return { cards, hasList: lists.length > 0 }
}

/** Where the night takes place: the Lido, or the bigger venue a moved concert's subtitle names. */
function roomOf(card: LidoCard): string | null {
  const moved = card.statuses.includes('new_venue') || /\bverlegt\b/i.test(card.subtitle)
  if (!moved) return LOCATION
  const venue = card.subtitle.match(MOVED_TO)?.[1]
  return venue ? readableCase(squash(venue)) : null
}

/** The event page's flyer: the "Event Flyer" link, else the og:image, else the act's photo. */
function imageOf(all: Element[], pageUrl: string): string | null {
  const flyer = all.find((el) => el.tagName === 'a' && hasClass(el, 'event-content__links__link--event-flyer'))
  const og = all.find((el) => el.tagName === 'meta' && (attr(el, 'name') ?? attr(el, 'property')) === 'og:image')
  const photo = all.find((el) => el.tagName === 'img' && hasClass(el, 'gig__preview'))
  const src = (flyer && attr(flyer, 'href')) || (og && attr(og, 'content')) || (photo && attr(photo, 'src')) || null
  if (!src) return null
  try {
    return new URL(src, pageUrl).href
  } catch {
    return null // an unreadable src leaves the event without an image
  }
}

/** The card and its event page → the event. The page's prev/next links stay out of `raw`: they change daily. */
export function parseLidoDetail(html: string, card: LidoCard): FeedEvent {
  const all = [...elements(parse(html))]
  const gigs = all.filter((el) => el.tagName === 'section' && hasClass(el, 'gig'))

  const gigTexts = gigs.map((gig) => {
    const name = textIn(gig, 'gig__name')
    const body = childOf(gig, 'gig__description')
    const text = body ? richText(body) : ''
    return gigs.length > 1 && name ? [name, text].filter(Boolean).join('\n\n') : text
  })
  // "37.95 €" in English, "37,95 €" in German: always the German way
  const prices = all
    .filter((el) => hasClass(el, 'price'))
    .map((el) => [textIn(el, 'price__value').replace(/(\d)[.,](\d{2})\b/, '$1,$2'), textIn(el, 'price__label')].filter(Boolean).join(' '))
    .filter(Boolean)
  const priceLine = prices.join(' · ')
  const ticketLinks = all
    .filter((el) => el.tagName === 'a' && hasClass(el, 'purchase-option__button'))
    .map((el) => webUrl(attr(el, 'href')))
    .filter((url) => url !== null)
  const tickets = ticketLinks[0] ?? null

  const soldOut = card.statuses.includes('sold_out') && !SOLD_OUT.test(card.subtitle)
  const description = [
    card.kind ?? '',
    card.subtitle,
    soldOut ? 'Ausverkauft' : '',
    card.doors && card.doors !== card.start && !PLACEHOLDER_TIMES.has(card.doors) ? `Einlass ${card.doors}` : '',
    priceLine ? `Tickets: ${priceLine}` : '',
    card.presenter ? `Präsentiert von ${card.presenter}` : '',
    ...gigTexts,
  ]
    .filter(Boolean)
    .join('\n\n')

  // The act's own spelling ("Hi! Spencer") rather than the card's capitals, when it is the same name
  const gigName = gigs.length === 1 ? textIn(gigs[0]!, 'gig__name') : ''
  const summary = gigName && gigName.toLowerCase() === card.title.toLowerCase() ? gigName : card.title
  const start = card.start ?? card.doors
  const room = roomOf(card)

  const imageUrl = imageOf(all, card.url)
  // The site answers in English or German at random (prices too): only what an editor wrote goes into `raw`
  const raw = [JSON.stringify({ ...card, prices, ticketLinks, imageUrl }), ...gigs.map((el) => serializeOuter(el))].join('\n')
  return {
    externalId: card.externalId,
    uid: card.url,
    summary,
    description,
    start: berlinMoment(card.day, parseTime(start)),
    end: null,
    url: card.url,
    imageUrl,
    locationRoom: room,
    locationText: room,
    timesStated: start !== null && !PLACEHOLDER_TIMES.has(start),
    ...(tickets ? { links: { tickets } } : {}),
    raw,
    hash: createHash('sha256').update(raw).digest('hex'),
  }
}

/**
 * The lido-berlin.de programme (every upcoming event on the home page), then each upcoming event's page, one
 * after another. Cancelled and postponed events are left out, so they turn up as gone; a concert moved to a
 * bigger venue is placed there. A page that cannot be fetched fails the run: leaving its event out would mark
 * it gone.
 */
export async function readLido(html: string, config: IngestSourceConfig, opts: LidoOptions): Promise<FeedEvent[]> {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  const { cards, hasList } = parseLidoListing(html, opts.pageUrl)
  // An empty programme is no error, a page without the programme is
  if (!hasList) throw new FeedParseError('No programme (div.event-list) on the page')

  const today = fmtDay(berlinToday(opts.now))
  const events = new Map<string, FeedEvent>()
  for (const card of cards) {
    if (fmtDay(card.day) < today || events.has(card.externalId)) continue
    if (card.statuses.includes('cancelled')) continue
    let page: string
    try {
      page = await opts.fetchText(card.url)
    } catch (err) {
      throw new Error(`Event page ${card.url}: ${err instanceof Error ? err.message : String(err)}`)
    }
    events.set(card.externalId, parseLidoDetail(page, card))
  }
  return [...events.values()]
}
