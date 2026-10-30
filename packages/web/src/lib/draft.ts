import type { EventCategory, EventDraft, Lineup } from '@open-event-db/shared'

/** What the create form starts with after an image import. Empty strings mean "not read from the image". */
export interface EventPrefill {
  title: string
  /** YYYY-MM-DD, for <input type="date">. */
  startDate: string
  /** HH:MM, for <input type="time">; empty when the image had a date but no time — never pre-filled as 00:00. */
  startTime: string
  endsAt: string
  description: string
  lineup: Lineup
  city: string
  /** Address without a venue name: goes into the free-text location. */
  locationText: string
  categories: EventCategory[]
  tags: string[]
  /** Tags from the image that don't exist yet: offered, not added. */
  suggestedTags: string[]
  links: { key: string; url: string }[]
}

export interface VenueMatchable {
  id: string
  name: string
  city: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO timestamp → value for <input type="datetime-local"> in the browser's time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function draftToPrefill(draft: EventDraft, knownTags: string[]): EventPrefill {
  const known = new Set(knownTags)
  const [startDate, startTime] = toLocalInput(draft.starts_at).split('T')
  return {
    title: draft.title ?? '',
    startDate: startDate || (draft.start_date ?? ''),
    startTime: startTime ?? '',
    endsAt: toLocalInput(draft.ends_at),
    description: draft.description?.trim() ?? '',
    // The image names the acts, never their order across floors: one unnamed group
    lineup: draft.lineup.length
      ? [{ name: null, acts: draft.lineup.map((name) => ({ name, time: null, live: false, note: null })) }]
      : [],
    city: draft.city,
    locationText: draft.venue_name ? '' : (draft.address ?? ''),
    categories: draft.categories,
    tags: draft.tags.filter((t) => known.has(t)),
    suggestedTags: draft.tags.filter((t) => !known.has(t)),
    links: Object.entries(draft.links).map(([key, url]) => ({ key, url })),
  }
}

const compact = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Search terms for a venue name read from an image, most specific first. Pages often glue the city
 * onto the name ("ModusBerlin", "RSO.BERLIN"), so a second try leaves it off.
 */
export function venueQueries(name: string): string[] {
  const full = name.trim()
  const bare = full.replace(/[\s.\-_]*berlin$/i, '').trim()
  return [...new Set([full, bare].filter((q) => q.length >= 2))]
}

/**
 * One venue only when the match is unambiguous (PRD Event Capture, Decision 13): a single search result,
 * or exactly one result whose name equals the read name. Everything else is offered, not chosen.
 */
export function pickVenue<V extends VenueMatchable>(name: string, results: V[]): { venue: V | null; candidates: V[] } {
  if (results.length === 1) return { venue: results[0]!, candidates: [] }
  const wanted = venueQueries(name).map(compact)
  const exact = results.filter((v) => wanted.includes(compact(v.name)))
  if (exact.length === 1) return { venue: exact[0]!, candidates: [] }
  return { venue: null, candidates: results }
}

/** Everything the create form needs after an import. */
export interface ImportResult {
  prefill: EventPrefill
  /** Unambiguous venue match, pre-selected. */
  venue: VenueMatchable | null
  /** Several possible matches: listed, nothing selected. */
  candidates: VenueMatchable[]
  /** Read venue name: shown with the candidates and used to pre-fill a new venue. */
  venueName: string | null
  /** No match at all: inline venue creation starts pre-filled. */
  newVenue: { name: string; address: string; city: string } | null
}
