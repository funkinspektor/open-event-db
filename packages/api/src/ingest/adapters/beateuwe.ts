import { createHash } from 'node:crypto'
import { parse, serializeOuter } from 'parse5'
import type { IngestSourceConfig, LineupAct } from '@open-event-db/shared'
import { berlinToday, fmtDay, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { attr, berlinMoment, elements, richText, squash, textOf, webUrl, type Element } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** The club is one room; map it with `venues: { "Beate Uwe": … }`. */
const LOCATION = 'Beate Uwe'
/** "FR, 04.12.26 DEZ": the date of an entry, the year written with two digits. */
const DATE = /\b(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\b/
const TIME = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/
/** "w/ Miss Kitchen, Silsan, NasNan b2b Naked": the lineup line under the title. */
const LINEUP_LINE = /^w\/\s*/i
/** A bracket at the end of an act: "(live)" or "(Live Set)" marks it live, anything else is its note. */
const TRAILING_BRACKET = /\s*\(([^()]*)\)\s*$/
const LIVE = /^live(?:\s*set)?$/i
const RA_HOST = /^(?:[a-z]{2}\.|www\.)?ra\.co$|(?:^|\.)residentadvisor\.net$/

export interface BeateUweOptions {
  /** The home page, which carries the programme; the events link back to it. */
  pageUrl: string
  now: Date
}

const widgetType = (el: Element) => attr(el, 'data-widget_type')

/** "FR, 04.12.26 DEZ" → 4 December 2026; null when no real date is written. */
function dayOf(text: string): CalendarDay | null {
  const m = text.match(DATE)
  if (!m) return null
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const day: CalendarDay = { year, month: Number(m[2]), day: Number(m[1]) }
  const check = new Date(Date.UTC(day.year, day.month - 1, day.day))
  return check.getUTCMonth() === day.month - 1 && check.getUTCDate() === day.day ? day : null
}

/** Splits at the commas outside brackets: "Crew (A, B), C" → "Crew (A, B)", "C". */
function splitActs(line: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of line) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)
  return parts.map(squash).filter(Boolean)
}

function actOf(text: string): LineupAct | null {
  let name = text
  let live = false
  const notes: string[] = []
  for (let m = name.match(TRAILING_BRACKET); m; m = name.match(TRAILING_BRACKET)) {
    const inner = squash(m[1]!)
    if (LIVE.test(inner)) live = true
    else if (inner) notes.unshift(inner)
    name = name.slice(0, m.index).trim()
  }
  name = name.slice(0, 200)
  return name ? { name, time: null, live, note: notes.join(' · ').slice(0, 200) || null } : null
}

/** The paragraphs of an entry's text, or its lines when the editor wrote none. */
function blocksOf(body: Element): Element[] | string[] {
  const paragraphs = [...elements(body)].filter((el) => el.tagName === 'p')
  return paragraphs.length > 0 ? paragraphs : textOf(body).split('\n')
}

interface EntryText {
  title: string
  link: string | null
  acts: LineupAct[]
  description: string
}

/** The first paragraph is the title (linked to RA, mostly), a "w/" paragraph the lineup, the rest text. */
function readBody(body: Element): EntryText {
  const blocks = blocksOf(body)
  const texts = blocks.map((b) => squash(typeof b === 'string' ? b : textOf(b)))
  const first = texts.findIndex(Boolean)
  const acts: LineupAct[] = []
  const description: string[] = []
  let link: string | null = null
  if (first >= 0 && typeof blocks[first] !== 'string') {
    const a = [...elements(blocks[first] as Element)].find((el) => el.tagName === 'a')
    link = webUrl(a ? attr(a, 'href') : null)
  }
  blocks.forEach((block, i) => {
    if (i <= first || !texts[i]) return
    if (LINEUP_LINE.test(texts[i]!)) {
      for (const part of splitActs(texts[i]!.replace(LINEUP_LINE, ''))) {
        const act = actOf(part)
        if (act) acts.push(act)
      }
    } else description.push(typeof block === 'string' ? texts[i]! : richText(block))
  })
  return { title: first >= 0 ? texts[first]!.slice(0, 200) : '', link, acts, description: description.join('\n\n') }
}

/**
 * The programme on beate-uwe.de's home page → plain events, from today on. Pure. The page is built with
 * Elementor by hand: each night is an icon list with the date ("FR, 04.12.26 DEZ") and the start ("23:00"),
 * followed by a text editor with the title (linked to the RA event, mostly) and a "w/ …" line, the lineup.
 * Past nights stay listed for a while, so a page without any date is a broken page, not an empty programme.
 * The club has one room and one night a day, so the day is the event's id.
 */
export function parseBeateUwe(html: string, config: IngestSourceConfig, opts: BeateUweOptions): FeedEvent[] {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  const widgets = [...elements(parse(html))].filter((el) => {
    const type = widgetType(el)
    return type === 'text-editor.default' || (type === 'icon-list.default' && DATE.test(textOf(el)))
  })
  if (!widgets.some((el) => widgetType(el) === 'icon-list.default')) {
    throw new FeedParseError('No programme dates (Elementor icon lists with a date) on the page')
  }

  const today = fmtDay(berlinToday(opts.now))
  const events = new Map<string, FeedEvent>()
  widgets.forEach((head, i) => {
    const body = widgets[i + 1]
    if (widgetType(head) !== 'icon-list.default' || !body || widgetType(body) !== 'text-editor.default') return
    const headText = squash(textOf(head))
    const day = dayOf(headText)
    if (!day || fmtDay(day) < today) return // no date, or over
    const time = headText.replace(DATE, '').match(TIME)
    const minutes = time ? Number(time[1]) * 60 + Number(time[2]) : null

    const entry = readBody(body)
    if (!entry.title) return // an event needs a title
    let externalId = fmtDay(day)
    for (let n = 2; events.has(externalId); n++) externalId = `${fmtDay(day)}-${n}`

    const links: Record<string, string> = {}
    const linkHost = entry.link ? new URL(entry.link).hostname : null
    if (entry.link && linkHost && RA_HOST.test(linkHost)) links.resident_advisor = entry.link
    const raw = [serializeOuter(head), serializeOuter(body)].join('\n')
    events.set(externalId, {
      externalId,
      uid: externalId,
      summary: entry.title,
      description: entry.description,
      lineup: entry.acts.length > 0 ? [{ name: null, acts: entry.acts }] : [],
      start: berlinMoment(day, minutes),
      end: null,
      url: entry.link && !links.resident_advisor ? entry.link : opts.pageUrl,
      imageUrl: null,
      locationRoom: LOCATION,
      locationText: LOCATION,
      timesStated: minutes !== null,
      links,
      raw,
      hash: createHash('sha256').update(raw).digest('hex'),
    })
  })
  return [...events.values()]
}
