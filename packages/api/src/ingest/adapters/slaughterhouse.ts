import { createHash } from 'node:crypto'
import { parse, serializeOuter } from 'parse5'
import type { IngestSourceConfig } from '@open-event-db/shared'
import { berlinToday, fmtDay, parseTime, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { attr, berlinMoment, elements, hasClass, isElement, richText, squash, textOf, webUrl, type Element } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** The club is one place in the Kulturfabrik Moabit; map it with `venues: { Slaughterhouse: … }`. */
const LOCATION = 'Slaughterhouse'
/** "30.10.2026" alone on the first line of an event's heading paragraph. */
const DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/
/** "Konzert+Party: Capper: Rockin And Clubbin": the kind of night before the title. */
const KIND = /^((?:Konzert|Konzerte|Party|Lesung|Film|Kino|Workshop|Festival|Flohmarkt|Theater|Ausstellung|Quiz|Karaoke|Comedy)(?:\s*\+\s*[A-Za-zÄÖÜäöüß]+)*)\s*:\s+/i
/** "Beginn: 19:00", "Beginn: 23 Uhr", "Doors: 22:00 (…)", "doors open 21:00 Uhr". */
const START = /^(?:beginn|start)\s*:?\s*(\d{1,2}(?:[:.]\d{2})?)(?:\s*uhr)?\b/i
const DOORS = /^(?:doors(?:\s+open)?|einlass)\s*:?\s*(\d{1,2}(?:[:.]\d{2})?)(?:\s*uhr)?\b/i
/** The "– – – – –" rules some texts are drawn with. */
const RULE = /^[-–—⸻\s]+$/

export interface SlaughterhouseOptions {
  /** The programme page, e.g. https://slaughterhouse-berlin.de/konzerte/: the events link back to it. */
  pageUrl: string
  now: Date
}

/** One event as the page writes it: a heading paragraph, then its blocks until the next rule or heading. */
interface Entry {
  day: CalendarDay
  heading: string
  blocks: Element[]
  raw: string[]
}

/** "30.10.2026<br><strong>Party: Factory</strong>" → the day and the heading; null for any other paragraph. */
function headingOf(p: Element): { day: CalendarDay; heading: string } | null {
  if (p.tagName !== 'p') return null
  const [first, ...rest] = textOf(p).split('\n')
  const m = squash(first ?? '').match(DATE)
  const heading = squash(rest.join(' '))
  if (!m || !heading) return null
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  return { day: { year, month: Number(m[2]), day: Number(m[1]) }, heading }
}

/** The page's entries in the order listed. The home page and /konzerte/ show the same list. */
function entriesOf(html: string): { entries: Entry[]; isProgramme: boolean } {
  const all = [...elements(parse(html))]
  const contents = all.filter((el) => el.tagName === 'div' && hasClass(el, 'entry-content'))
  const entries: Entry[] = []
  for (const content of contents) {
    let current: Entry | null = null
    for (const child of content.childNodes) {
      if (!isElement(child)) continue
      const heading = headingOf(child)
      if (heading) {
        current = { ...heading, blocks: [], raw: [serializeOuter(child)] }
        entries.push(current)
      } else if (child.tagName === 'hr') {
        current = null
      } else if (current) {
        current.blocks.push(child)
        current.raw.push(serializeOuter(child))
      }
    }
  }
  const isProgramme = all.some((el) => el.tagName === 'h1' && squash(textOf(el)) === 'Veranstaltungen')
  return { entries, isProgramme }
}

/** The text's lines, for the times and the ticket line. */
const linesOf = (blocks: Element[]) =>
  blocks
    .filter((el) => el.tagName !== 'figure')
    .flatMap((el) => textOf(el).split('\n'))
    .map(squash)
    .filter(Boolean)

/** The first link of a paragraph that starts with "Ticket" ("Tickets:", "Ticket Link:"). */
function ticketLink(blocks: Element[]): string | null {
  for (const block of blocks) {
    const lines = textOf(block).split('\n').map(squash)
    if (!lines.some((line) => /^tickets?\b/i.test(line))) continue
    for (const a of [...elements(block)].filter((el) => el.tagName === 'a')) {
      const url = webUrl(attr(a, 'href'))
      if (url) return url
    }
  }
  return null
}

/** The first flyer; the page mixes http:// and https:// links to its own uploads. */
function imageOf(blocks: Element[], pageUrl: string): string | null {
  const img = blocks.filter((el) => el.tagName === 'figure').flatMap((el) => [...elements(el)]).find((el) => el.tagName === 'img')
  const src = img ? attr(img, 'src') : null
  if (!src) return null
  try {
    const url = new URL(src, pageUrl)
    if (url.protocol === 'http:' && url.host === new URL(pageUrl).host) url.protocol = 'https:'
    return url.href
  } catch {
    return null // an unreadable src leaves the event without an image
  }
}

function descriptionOf(kind: string | null, blocks: Element[]): string {
  const texts = blocks
    .filter((el) => el.tagName !== 'figure')
    .map((el) =>
      richText(el)
        .split('\n')
        .filter((line) => !RULE.test(line))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
    .filter(Boolean)
  return [kind ?? '', ...texts].filter(Boolean).join('\n\n')
}

/**
 * The programme on slaughterhouse-berlin.de (/konzerte/ or the home page) -> plain events, from tonight on.
 * Pure. The page has no event pages or ids, so the date is the id, as the club has one night a day; a second
 * event on the same day gets "-2".
 */
export function parseSlaughterhouse(html: string, config: IngestSourceConfig, opts: SlaughterhouseOptions): FeedEvent[] {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  const { entries, isProgramme } = entriesOf(html)
  // An empty programme is no error, a page without the programme is
  if (entries.length === 0 && !isProgramme) throw new FeedParseError('No programme ("DD.MM.YYYY" + title paragraphs) on the page')

  const today = fmtDay(berlinToday(opts.now))
  const events = new Map<string, FeedEvent>()
  for (const entry of entries) {
    const date = fmtDay(entry.day)
    if (date < today) continue
    const kind = entry.heading.match(KIND)
    const summary = kind ? entry.heading.slice(kind[0].length) : entry.heading
    if (!summary) continue

    let externalId = date
    for (let n = 2; events.has(externalId); n++) externalId = `${date}-${n}`

    const lines = linesOf(entry.blocks)
    const startText = lines.map((l) => l.match(START)?.[1]).find(Boolean) ?? lines.map((l) => l.match(DOORS)?.[1]).find(Boolean)
    const start = parseTime(startText?.replace('.', ':') ?? null)
    const tickets = ticketLink(entry.blocks)
    const raw = entry.raw.join('\n')

    events.set(externalId, {
      externalId,
      uid: externalId,
      summary,
      description: descriptionOf(kind ? kind[1]!.replace(/\s*\+\s*/g, ' + ') : null, entry.blocks),
      start: berlinMoment(entry.day, start),
      end: null,
      url: opts.pageUrl,
      imageUrl: imageOf(entry.blocks, opts.pageUrl),
      locationRoom: LOCATION,
      locationText: LOCATION,
      timesStated: start !== null,
      ...(tickets ? { links: { tickets } } : {}),
      raw,
      hash: createHash('sha256').update(raw).digest('hex'),
    })
  }
  return [...events.values()]
}
