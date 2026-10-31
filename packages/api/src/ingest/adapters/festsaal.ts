import { createHash } from 'node:crypto'
import { parseFragment } from 'parse5'
import { z } from 'zod'
import type { IngestSourceConfig } from '@open-event-db/shared'
import { berlinToday, fmtDay, parseTime, type CalendarDay } from '../../extract/normalize.js'
import { FeedParseError, type FeedEvent } from './ical.js'
import { berlinMoment, richText, squash, webUrl } from './page.js'

const SUPPORTED_TIMEZONE = 'Europe/Berlin'
/** The public site; the API (admin.…) gives page paths only. */
const SITE = 'https://festsaal-kreuzberg.de'
/** The room of events without one; map the rooms with `venues: { Festsaal: …, Kaminzimmer: … }`. */
const HOUSE = 'Festsaal'
/** "Diese Veranstaltung findet im SO36 statt!": a show the Festsaal books into another venue. */
const ELSEWHERE = /findet\s+(?:im|in der|in den|in|auf dem|auf der)\s+(.+?)\s+statt\b/i
/** The statuses the site knows; any other one reads "postponed, new date to be announced" there. */
const KNOWN_STATUSES = new Set(['sold_out', 'moved_date', 'transferred', 'custom', 'cancelled'])

const textBlockSchema = z.object({ type: z.string(), value: z.unknown() })
const layoutSchema = z.object({
  type: z.string(),
  value: z.object({ items: z.array(textBlockSchema).optional() }).passthrough(),
})

const eventPageSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  url: z.string(),
  sub_title: z.string().nullable(),
  /** YYYY-MM-DD; HH:MM:SS. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  doors: z.string().nullable(),
  start: z.string().nullable(),
  changed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  changed_doors: z.string().nullable(),
  changed_start: z.string().nullable(),
  /** Shown only with a status: pages copied from older ones carry stale notes. */
  changed_text: z.string().nullable(),
  status: z.string().nullable(),
  new_location: z.string().nullable(),
  location: z.object({ title: z.string() }).passthrough().nullable(),
  ticket: z.string().nullable(),
  age: z.string().nullable(),
  support: z.string().nullable(),
  layouts: z.array(layoutSchema).nullable(),
  preview_image: z
    .object({ download_url: z.string().nullable().optional(), download_url_medium: z.string().nullable().optional() })
    .passthrough()
    .nullable(),
})
type EventPage = z.infer<typeof eventPageSchema>

const listingSchema = z.object({
  meta: z.object({ total_count: z.number().int() }),
  items: z.array(z.unknown()),
})

export interface FestsaalOptions {
  /** The Wagtail API listing of the event pages, with the fields DEPLOY.md names. */
  pageUrl: string
  now: Date
}

function dayOf(date: string): CalendarDay {
  const [year, month, day] = date.split('-').map(Number)
  return { year: year!, month: month!, day: day! }
}

/** "19:00:00" → "19:00". */
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null)

/** The editor's HTML (or plain text) as text; wrapped, as richText reads one element. */
const plain = (html: string) => richText(parseFragment(`<div>${html}</div>`).childNodes[0]!)

/** The text blocks of the page body, as Markdown-ish text; embeds and the presenters' logos are left out. */
function bodyOf(page: EventPage): string[] {
  return (page.layouts ?? [])
    .flatMap((layout) => layout.value.items ?? [])
    .filter((block) => block.type === 'item_text')
    .map((block) => (block.value as { text?: unknown }).text)
    .filter((text): text is string => typeof text === 'string')
    .map(plain)
    .filter(Boolean)
}

/**
 * Where the show takes place: a transfer's new venue, another venue a custom note names, else the page's room.
 * A note without a status is no evidence: on 2026-10-31 four such "im SO36" notes were stale, as SO36's own
 * programme had other shows on those days.
 */
function roomOf(page: EventPage, note: string): string {
  if (page.status === 'transferred' && page.new_location?.trim()) return squash(page.new_location)
  const elsewhere = page.status === 'custom' && note.match(ELSEWHERE)?.[1]
  if (elsewhere) return squash(elsewhere)
  return page.location?.title.trim() || HOUSE
}

/**
 * The Festsaal Kreuzberg programme from its Wagtail API (one request: /api/v2/pages/?type=home.EventPage) →
 * plain events, from today on. Pure. Statuses are read the way the site shows them: a moved show at its new
 * date, a transferred one at its new venue, cancelled and "new date to be announced" ones left out (so they
 * turn up as gone). Notes on pages without a status are stale copies and are ignored.
 */
export function parseFestsaal(text: string, config: IngestSourceConfig, opts: FestsaalOptions): FeedEvent[] {
  if (config.timezone !== SUPPORTED_TIMEZONE) {
    throw new FeedParseError(`Timezone ${config.timezone} is not supported yet; only ${SUPPORTED_TIMEZONE}`)
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new FeedParseError('The Festsaal API did not answer with JSON')
  }
  const listing = listingSchema.safeParse(json)
  if (!listing.success) throw new FeedParseError('No Wagtail page listing (meta.total_count, items)')
  if (listing.data.items.length < listing.data.meta.total_count) {
    throw new FeedParseError(
      `The listing holds ${listing.data.items.length} of ${listing.data.meta.total_count} pages: raise limit= in the source URL`,
    )
  }

  const today = fmtDay(berlinToday(opts.now))
  const events = new Map<string, FeedEvent>()
  for (const item of listing.data.items) {
    const parsed = eventPageSchema.safeParse(item)
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path.join('.') ?? '?'
      throw new FeedParseError(`Event page without the field "${field}": the source URL must ask for the fields DEPLOY.md lists`)
    }
    const page = parsed.data
    const externalId = String(page.id)
    // A moved show is listed twice, at its old and its new date
    if (events.has(externalId)) continue
    const status = page.status || null
    if (status === 'cancelled' || (status !== null && !KNOWN_STATUSES.has(status))) continue
    const changed = status === 'moved_date' || status === 'transferred'
    if (status === 'moved_date' && !page.changed_date) continue // new date to be announced
    const date = (changed && page.changed_date) || page.date
    if (date < today) continue

    const doors = hhmm((changed && page.changed_doors) || page.doors)
    const start = hhmm((changed && page.changed_start) || page.start) ?? doors
    const note = page.changed_text ? plain(page.changed_text) : ''
    const room = roomOf(page, note)

    const statusLine =
      status === 'sold_out'
        ? ['Ausverkauft', note].filter(Boolean).join('. ')
        : status === 'moved_date'
          ? note || `Verschoben vom ${page.date.split('-').reverse().join('.')}`
          : status === 'transferred'
            ? note || `Verlegt ins ${room}`
            : status === 'custom'
              ? note
              : ''
    const support = page.support?.trim()
    const age = Number(page.age)
    const description = [
      page.sub_title?.trim() ?? '',
      statusLine,
      support ? `Support: ${support}` : '',
      doors && doors !== start ? `Einlass ${doors}` : '',
      age > 0 ? `Ab ${age} Jahren` : '',
      ...bodyOf(page),
    ]
      .filter(Boolean)
      .join('\n\n')

    const url = new URL(page.url, SITE).href
    const tickets = webUrl(page.ticket)
    const image = page.preview_image
    const raw = JSON.stringify(item)
    events.set(externalId, {
      externalId,
      uid: url,
      summary: squash(page.title),
      description,
      start: berlinMoment(dayOf(date), parseTime(start)),
      end: null,
      url,
      imageUrl: image?.download_url_medium ?? image?.download_url ?? null,
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
