import { createHash } from 'node:crypto'
import { parse, serializeOuter } from 'parse5'
import type { IngestSourceConfig, LineupAct } from '@open-event-db/shared'
import { berlinToday, fmtDay, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { attr, berlinMoment, elements, hasClass, squash, textOf, webUrl, type Element } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** The bar is one room; map it with `venues: { Supamolly: … }`. */
const LOCATION = 'Supamolly'
/** A row's id is its start, "202611132100": 13 November 2026, 21:00. */
const ROW_ID = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/
/** "Rites of Hadda (UK)": the country goes to the act's note, before the genre. */
const COUNTRY = /\s*\(([A-Z]{2,3})\)$/

export interface SupamollyOptions {
  /** The programme page, to resolve the flyer paths and to link back to it. */
  pageUrl: string
  now: Date
}

/** One act of a row: name, the genre line under it and the link the whole entry points to. */
interface SupamollyAct {
  name: string
  genre: string
  link: string | null
}

const firstOf = (root: Element, test: (el: Element) => boolean) => [...elements(root)].find(test) ?? null

/** The name in div.tit's <b>, without the empty div.progln inside it. */
function nameOf(tit: Element): string {
  const b = firstOf(tit, (el) => el.tagName === 'b')
  return b ? squash(b.childNodes.map((c) => ('tagName' in c ? '' : textOf(c))).join('')) : ''
}

/** The genre in div.beschr, without the link it repeats in div.lin. */
function genreOf(beschr: Element | null): string {
  return beschr ? squash(beschr.childNodes.map((c) => ('tagName' in c && hasClass(c, 'lin') ? '' : textOf(c))).join('')) : ''
}

function actsOf(row: Element): SupamollyAct[] {
  const acts: SupamollyAct[] = []
  for (const entry of [...elements(row)].filter((el) => el.tagName === 'div' && hasClass(el, 'even'))) {
    const tit = firstOf(entry, (el) => hasClass(el, 'tit'))
    const name = tit ? nameOf(tit) : ''
    if (!name) continue
    const link = firstOf(entry, (el) => el.tagName === 'a')
    acts.push({
      name,
      genre: genreOf(firstOf(entry, (el) => hasClass(el, 'beschr'))),
      link: webUrl(link ? attr(link, 'href') : null),
    })
  }
  return acts
}

function lineupActOf(act: SupamollyAct): LineupAct {
  const country = act.name.match(COUNTRY)
  return {
    name: country ? act.name.replace(COUNTRY, '') : act.name,
    time: null,
    live: false,
    note: [country?.[1], act.genre].filter(Boolean).join(' · ').slice(0, 200) || null,
  }
}

/** The acts' links, one a line: "La Sangre: [la-sangre.bandcamp.com](…)"; the genres are in the lineup. */
function descriptionOf(acts: SupamollyAct[]): string {
  return acts
    .filter((act) => act.link)
    .map((act) => `${act.name}: [${new URL(act.link!).hostname.replace(/^www\./, '')}](${act.link})`)
    .join('\n')
}

/** The full flyer next to the listed thumbnail: "flyer/small/<id>.jpg" → "flyer/<id>.jpg". */
function flyerOf(row: Element, pageUrl: string): string | null {
  const img = firstOf(row, (el) => el.tagName === 'img' && hasClass(el, 'flyer_small'))
  const src = img ? attr(img, 'src') : null
  if (!src) return null
  try {
    return webUrl(new URL(src.replace(/(^|\/)small\//, '$1'), pageUrl).href)
  } catch {
    return null // an unreadable src leaves the event without an image
  }
}

/**
 * The programme on supamolly.de (index.php?p=programm) → plain events, from today on. Pure. Each event is a
 * tr.event whose id is its start ("202611132100"), so the id is stable and the date needs no guessing. The
 * page has no titles: an event is its acts, each with a genre line and a link. The title is their names, as
 * the bar's own RSS feed writes it; the genres go to the lineup, the links to the description.
 */
export function parseSupamolly(html: string, config: IngestSourceConfig, opts: SupamollyOptions): FeedEvent[] {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  const all = [...elements(parse(html))]
  // An empty programme is no error, a page without the programme table is
  if (!all.some((el) => el.tagName === 'table' && hasClass(el, 'progtab'))) {
    throw new FeedParseError('No programme (table.progtab) on the page')
  }

  const today = fmtDay(berlinToday(opts.now))
  const events = new Map<string, FeedEvent>()
  for (const row of all.filter((el) => el.tagName === 'tr' && hasClass(el, 'event'))) {
    const m = attr(row, 'id')?.match(ROW_ID)
    if (!m) continue
    const day: CalendarDay = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
    const minutes = Number(m[4]) * 60 + Number(m[5])
    if (fmtDay(day) < today || Number(m[4]) > 23 || Number(m[5]) > 59) continue // over, or no time

    const acts = actsOf(row)
    if (acts.length === 0) continue // an event needs a title
    const externalId = m[0]
    const raw = serializeOuter(row)
    events.set(externalId, {
      externalId,
      uid: externalId,
      summary: acts.map((act) => act.name).join(', '),
      description: descriptionOf(acts),
      lineup: [{ name: null, acts: acts.map(lineupActOf) }],
      start: berlinMoment(day, minutes),
      end: null,
      url: opts.pageUrl,
      imageUrl: flyerOf(row, opts.pageUrl),
      locationRoom: LOCATION,
      locationText: LOCATION,
      timesStated: true,
      raw,
      hash: createHash('sha256').update(raw).digest('hex'),
    })
  }
  return [...events.values()]
}
