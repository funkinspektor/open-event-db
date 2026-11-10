import { createHash } from 'node:crypto'
import { parse, serializeOuter } from 'parse5'
import type { IngestSourceConfig } from '@open-event-db/shared'
import { berlinToday, fmtDay, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { attr, berlinMoment, elements, hasClass, isElement, richText, squash, textOf, webUrl, type Element } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** The club's rooms (Club, Lounge, Salon, Biergarten) are one venue; map it with `venues: { "Frannz Club": … }`. */
const LOCATION = 'Frannz Club'
const MAIN_ROOM = 'Club'
const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']
const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag']
const TIME = /^(\d{1,2}):(\d{2})$/

/** "Messa -ausverkauft-": a note between hyphens closes the title; "Schwarz-Rot" is no note. */
const DASHED_NOTE = /\s+-(\S(?:(?!\s-\S).)*?)-$/
/** "SingAlong (ausverkauft)": a bracket closes the title only with a status in it; "(Bauhaus / …)" stays. */
const BRACKETED_NOTE = /\s*\(((?:ausverkauft|sold out|abgesagt|entfällt|verlegt|nachholtermin)\b[^)]*)\)$/i
/** "Iggi Kelly Nachholtermin vom 28.04.26-": the opening hyphen forgotten. */
const LOOSE_NOTE = /\s+-?(Nachholtermin\b.*?)-?$/i
const CANCELLED = /\b(?:abgesagt|entfällt|cancel(?:l?ed)?)\b/i
/** "ins Lido verlegt", "verlegt in den Festsaal": the concert takes place there. */
const MOVED = [/^(?:ins|in die|in den|in das|nach)\s+(.+?)\s+verlegt$/i, /^verlegt\s+(?:ins|in die|in den|in das|nach)\s+(.+)$/i]
/** The text's links that Markdown pasted into WordPress turned into "[<a>…</a>](<a>…</a>)". */
const DOUBLED_LINK = /\[\s*(<a\s[^>]*>[^<]*<\/a>)\s*\]\(\s*<a\s[^>]*>[^<]*<\/a>\s*\)/g
/** "-Tickets im VVK gibt es bei … -": the club sets its notes between hyphens. */
const DASHED_LINE = /^-\s*(.+?)\s*-$/
const TICKET_LINE = /\b(?:tickets?|vvk)\b/i
const MARKDOWN_LINK = /\[(?:\\.|[^\]\\])*\]\((https?:\/\/[^)\s]+)\)/
/** What a line below a ticket line may hold beside its link to count as the ticket link ("Dice link -"). */
const SHORT_REST = 30

export interface FrannzOptions {
  /** The home page, which lists the programme; the event links are made from it. */
  pageUrl: string
  now: Date
}

const firstOf = (root: Element, test: (el: Element) => boolean) => [...elements(root)].find(test) ?? null
const textIn = (root: Element, cls: string) => {
  const el = firstOf(root, (e) => hasClass(e, cls))
  return el ? squash(textOf(el)) : ''
}

/** The sidebar's "Ort:", "Einlass:", "Beginn:", "Abendkasse:" with their values, each key once. */
function sidebarOf(sidebar: Element | null): Map<string, string> {
  const values = new Map<string, string>()
  if (!sidebar) return values
  let key: string | null = null
  for (const el of elements(sidebar)) {
    if (hasClass(el, 'sidebar-key')) key = squash(textOf(el)).replace(/:$/, '')
    else if (hasClass(el, 'sidebar-val') && key) {
      if (!values.has(key)) values.set(key, squash(textOf(el)))
      key = null
    }
  }
  return values
}

/** "19:25 Uhr" → minutes after midnight; null when there is no time. */
function minutesOf(value: string | undefined): number | null {
  const m = value?.replace(/\s*Uhr$/, '').match(TIME)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return Number(m[1]) * 60 + Number(m[2])
}

const exists = ({ year, month, day }: CalendarDay) => {
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

/**
 * "Mittwoch 11 November" in the year whose 11 November is a Wednesday, of the year before today's to the
 * one after it: a date falls on the same weekday again only after five years or more. The list gives no
 * year and runs eleven months ahead, so "nearest to today" would put next October into this one. A weekday
 * that matches no year (a typo) falls back to the running order: the year of the event before, one more
 * when the month goes back.
 */
function dayOf(dayname: string, dayText: string, monthText: string, today: CalendarDay, before: CalendarDay | null): CalendarDay | null {
  const month = MONTHS.indexOf(monthText.toLowerCase()) + 1
  const day = Number(dayText)
  if (month === 0 || !Number.isInteger(day) || day < 1) return null
  const weekday = WEEKDAYS.indexOf(dayname.toLowerCase())
  const matching = [today.year - 1, today.year, today.year + 1]
    .map((year) => ({ year, month, day }))
    .filter((d) => exists(d) && new Date(Date.UTC(d.year, month - 1, day)).getUTCDay() === weekday)
  if (matching.length === 1) return matching[0]!
  const ref = before ?? today
  const guess = { year: month < ref.month ? ref.year + 1 : ref.year, month, day }
  return exists(guess) ? guess : null
}

/** The title without the club's notes on it ("-ausverkauft-", "(abgesagt)", "Nachholtermin vom …"). */
function splitTitle(title: string): { summary: string; notes: string[] } {
  let summary = squash(title)
  const notes: string[] = []
  for (const pattern of [DASHED_NOTE, BRACKETED_NOTE, LOOSE_NOTE]) {
    const m = summary.match(pattern)
    if (!m || m.index === 0) continue
    notes.unshift(squash(m[1]!))
    summary = summary.slice(0, m.index).trim()
  }
  return { summary, notes: notes.map((note) => note.charAt(0).toUpperCase() + note.slice(1)) }
}

const movedTo = (notes: string[]) => {
  for (const note of notes) {
    for (const pattern of MOVED) {
      const m = note.match(pattern)
      if (m) return m[1]!
    }
  }
  return null
}

/** The text beside the sidebar, its notes between hyphens unwrapped. */
function textOfContent(content: Element | null): string {
  if (!content) return ''
  const body = { ...content, childNodes: content.childNodes.filter((c) => !(isElement(c) && hasClass(c, 'sidebar'))) }
  return richText(body)
    .split('\n')
    .map((line) => line.replace(DASHED_LINE, '$1'))
    .join('\n')
}

const linkIn = (line: string) => {
  const m = line.match(MARKDOWN_LINK)
  const url = m ? webUrl(m[1]!.replaceAll('%28', '(').replaceAll('%29', ')')) : null
  return url && m ? { url, rest: line.replace(m[0], '').trim() } : null
}

/**
 * The first link on a line that speaks of tickets ("Tickets im VVK gibt es bei …"), or on the next line
 * when that one is little more than the link ("Tickets unter:", then "Dice link -[link.dice.fm](…)").
 */
function ticketsOf(text: string): string | null {
  const lines = text.split('\n')
  for (const [i, line] of lines.entries()) {
    if (!TICKET_LINE.test(line)) continue
    const own = linkIn(line)
    if (own) return own.url
    const next = lines.slice(i + 1).find((l) => l.trim())
    const below = next ? linkIn(next) : null
    if (below && below.rest.length <= SHORT_REST) return below.url
  }
  return null
}

function imageOf(sidebar: Element | null): string | null {
  const wrap = sidebar ? firstOf(sidebar, (el) => hasClass(el, 'image')) : null
  const img = wrap ? firstOf(wrap, (el) => el.tagName === 'img') : null
  return webUrl(img ? attr(img, 'src') : null)
}

/**
 * The programme on frannz.eu (WordPress, the home page lists the next hundred events) → plain events, from
 * today on. Pure. Each event is an <article id="post-…">, its post id the event's id and its link
 * ("?p=9453" leads to the event page). The slider at the top repeats a few of them without a date; those
 * copies are skipped. The time is "Beginn", the doors and the box office price go to the text. Notes the
 * club writes into the title ("-ausverkauft-", "-ins Lido verlegt-") go to the text too; a cancelled event
 * is left out, a moved one placed where it moved.
 */
export function parseFrannz(html: string, config: IngestSourceConfig, opts: FrannzOptions): FeedEvent[] {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  const main = [...elements(parse(html.replace(DOUBLED_LINK, '$1')))].find((el) => el.tagName === 'main' && attr(el, 'id') === 'main')
  // An empty programme is no error, a page without the programme is
  if (!main) throw new FeedParseError('No programme (main#main) on the page')

  const today = berlinToday(opts.now)
  const events = new Map<string, FeedEvent>()
  let before: CalendarDay | null = null
  for (const article of [...elements(main)].filter((el) => el.tagName === 'article')) {
    const externalId = attr(article, 'id')?.match(/^post-(\d+)$/)?.[1]
    if (!externalId || events.has(externalId)) continue
    const day = dayOf(textIn(article, 'event-dayname'), textIn(article, 'event-day'), textIn(article, 'event-month'), today, before)
    if (!day) continue
    before = day
    const { summary, notes } = splitTitle(textIn(article, 'event-title'))
    if (!summary || fmtDay(day) < fmtDay(today)) continue // an event needs a title; over
    if (notes.some((note) => CANCELLED.test(note))) continue

    const sidebar = firstOf(article, (el) => hasClass(el, 'sidebar'))
    const content = sidebar?.parentNode && isElement(sidebar.parentNode) ? sidebar.parentNode : null
    const info = sidebarOf(sidebar)
    const start = minutesOf(info.get('Beginn'))
    const doors = minutesOf(info.get('Einlass'))
    const rooms = info.get('Ort') ?? ''
    const box = info.get('Abendkasse')?.replace(/\s*€(?:\s*€)*/, ' €')
    const typ = firstOf(article, (el) => el.tagName === 'li' && hasClass(el, 'event-typ'))
    const text = textOfContent(content)
    const tickets = ticketsOf(text)
    const room = movedTo(notes) ?? LOCATION

    const description = [
      typ ? squash(textOf(typ)) : '',
      textIn(article, 'event-otitle'),
      textIn(article, 'event-utitle'),
      ...notes,
      rooms && rooms !== MAIN_ROOM ? `${rooms.includes(',') ? 'Räume' : 'Raum'}: ${rooms}` : '',
      doors !== null && doors !== start ? `Einlass ${info.get('Einlass')!.replace(/\s*Uhr$/, '')}` : '',
      box ? `Abendkasse ${box}` : '',
      text,
    ]
      .filter(Boolean)
      .join('\n\n')

    const raw = serializeOuter(article)
    events.set(externalId, {
      externalId,
      uid: externalId,
      summary,
      description,
      start: berlinMoment(day, start),
      end: null,
      url: new URL(`/?p=${externalId}`, opts.pageUrl).href,
      imageUrl: imageOf(sidebar),
      locationRoom: room,
      locationText: room,
      timesStated: start !== null,
      ...(tickets ? { links: { tickets } } : {}),
      raw,
      hash: createHash('sha256').update(raw).digest('hex'),
    })
  }
  return [...events.values()]
}
