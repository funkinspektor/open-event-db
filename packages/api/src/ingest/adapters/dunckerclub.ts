import { createHash } from 'node:crypto'
import { parse, serializeOuter } from 'parse5'
import type { IngestSourceConfig } from '@open-event-db/shared'
import { berlinToday, fmtDay, nextDay, parseTime, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { attr, berlinMoment, elements, hasClass, isElement, squash, textOf, type Element, type Node } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** The club has one floor, so every event is at the same place; map it with `venues: { Dunckerclub: … }`. */
const LOCATION = 'Dunckerclub'
const DAY_MS = 24 * 60 * 60 * 1000

export interface DunckerclubOptions {
  /** The page URL, to resolve relative image paths and to link back to the programme. */
  pageUrl: string
  /** The page gives no year: dates are read as the nearest one to this day. */
  now: Date
}

const cell = (row: Element, name: string) => [...elements(row)].find((el) => el.tagName === 'td' && hasClass(el, name)) ?? null

/** "Dark Mønday<br>SAMHAIN Celebration 2026 (*)" → "Dark Mønday – SAMHAIN Celebration 2026". */
function titleOf(name: Element): string {
  return textOf(name)
    .split('\n')
    .map((part) => squash(part.replaceAll('(*)', '')).replace(/^[-–\s]+|[-–\s]+$/g, ''))
    .filter(Boolean)
    .join(' – ')
}

/**
 * The event cell after the title: genres, then a flyer, then the lineup. Genres wrap with <br> mid-list,
 * so they become one line; lineup lines stay separate. The Facebook event, if linked, goes last.
 */
function detailsOf(cellEl: Element, pageUrl: string): { description: string; imageUrl: string | null } {
  const genres: string[] = []
  const lineup: string[] = []
  let imageUrl: string | null = null
  let facebook: string | null = null

  const walk = (node: Node) => {
    if (isElement(node)) {
      if (node.tagName === 'span' && hasClass(node, 'eventname')) return
      if (node.tagName === 'img') {
        const src = attr(node, 'src')
        if (!imageUrl && src) {
          try {
            imageUrl = new URL(src, pageUrl).href
          } catch {
            // an unreadable src leaves the event without an image
          }
        }
        lineup.push('\n') // everything after the flyer is lineup
        return
      }
      const href = node.tagName === 'a' ? attr(node, 'href') : null
      if (!facebook && href && /^https:\/\/(?:www\.)?facebook\.com\/events\/\d+/.test(href)) facebook = href
    }
    if (node.nodeName === '#text' || (isElement(node) && node.tagName === 'br')) {
      ;(lineup.length === 0 ? genres : lineup).push(textOf(node))
      return
    }
    if ('childNodes' in node) node.childNodes.forEach(walk)
  }
  walk(cellEl)

  const parts = [
    squash(genres.join(' ')),
    lineup
      .join('')
      .split('\n')
      .map((line) => squash(line).replace(/\s*\/+$/, ''))
      .filter(Boolean)
      .join('\n'),
    facebook ? `[Facebook-Event](${facebook})` : '',
  ]
  return { description: parts.filter(Boolean).join('\n\n'), imageUrl }
}

function exists({ year, month, day }: CalendarDay): boolean {
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

const dayNumber = ({ year, month, day }: CalendarDay) => Date.UTC(year, month - 1, day) / DAY_MS

/** "30.10." in the year that puts it nearest to `today`: in December, "05.01." is next January. */
function dayOf(text: string, today: CalendarDay): CalendarDay | null {
  const m = squash(text).match(/^(\d{1,2})\.(\d{1,2})\.?$/)
  if (!m) return null
  const [day, month] = [Number(m[1]), Number(m[2])]
  const candidates = [today.year - 1, today.year, today.year + 1]
    .map((year) => ({ year, month, day }))
    .filter(exists)
  candidates.sort((a, b) => Math.abs(dayNumber(a) - dayNumber(today)) - Math.abs(dayNumber(b) - dayNumber(today)))
  return candidates[0] ?? null
}

/** "21h-05h" → start and end minutes; an end not after the start is on the next day. */
function timesOf(text: string): { start: number | null; end: number | null } {
  const [from, to] = squash(text).split(/\s*[-–]\s*/)
  const start = parseTime(from ?? null)
  return { start, end: start === null ? null : parseTime(to ?? null) }
}

/**
 * The programme table on dunckerclub.de/start.html -> plain events, one per night, from tonight on.
 * Pure; the caller decides what to do with them. The date is the stable id: the club has one event a night.
 */
export function parseDunckerclub(html: string, config: IngestSourceConfig, opts: DunckerclubOptions): FeedEvent[] {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  // Rows are found by their date cell, not by `tr.tablereihe`: the page has stray `<tr class="tablereihe"></tr>`,
  // and the cells after one land in a row the parser opens itself, as a browser does.
  const rows = [...elements(parse(html))].filter(
    (el) => el.tagName === 'tr' && el.childNodes.some((c) => isElement(c) && c.tagName === 'td' && hasClass(c, 'tabledate')),
  )
  if (rows.length === 0) throw new FeedParseError('No programme table (td.tabledate) on the page')

  const today = berlinToday(opts.now)
  const events = new Map<string, FeedEvent>()
  for (const row of rows) {
    const dateCell = cell(row, 'tabledate')
    const eventCell = cell(row, 'tableevent')
    const name = eventCell && [...elements(eventCell)].find((el) => el.tagName === 'span' && hasClass(el, 'eventname'))
    if (!dateCell || !eventCell || !name) continue // spacer row

    const day = dayOf(textOf(dateCell), today)
    if (!day || dayNumber(day) < dayNumber(today)) continue // unreadable or over
    const summary = titleOf(name)
    if (!summary) continue // an event needs a title

    const externalId = fmtDay(day)
    if (events.has(externalId)) {
      throw new FeedParseError(`Two events on ${externalId}; the date is the id, so one night can hold only one`)
    }

    const timeCell = cell(row, 'tabletime')
    const times = timesOf(timeCell ? textOf(timeCell) : '')
    const endDay = times.start !== null && times.end !== null && times.end <= times.start ? nextDay(day) : day
    const { description, imageUrl } = detailsOf(eventCell, opts.pageUrl)
    const raw = serializeOuter(row)

    events.set(externalId, {
      externalId,
      uid: externalId,
      summary,
      description,
      start: berlinMoment(day, times.start),
      end: times.end === null ? null : berlinMoment(endDay, times.end),
      url: opts.pageUrl,
      imageUrl,
      locationRoom: LOCATION,
      locationText: LOCATION,
      timesStated: times.start !== null,
      raw,
      hash: createHash('sha256').update(raw).digest('hex'),
    })
  }
  return [...events.values()]
}
