import { SYNCED_LINK, canonicalLineup, type EventDetail, type IngestDraft, type IngestLinkInput, type IngestMergeField } from '@open-event-db/shared'
import { linkLabel } from './format'

/** A field of the merge, or one link by its key (`link:tickets`). */
export type MergeKey = IngestMergeField | `link:${string}`
export type MergeSide = 'event' | 'feed'

export interface MergeRow {
  key: MergeKey
  label: string
  /** Kept current by the feed while the item stays attached: then it always comes from the feed. */
  synced: boolean
  /** The side picked before the scout chooses: the feed only where the event has nothing yet. */
  initial: MergeSide
}

type MergeEvent = Pick<
  EventDetail,
  | 'title'
  | 'description'
  | 'lineup'
  | 'starts_at'
  | 'start_time_known'
  | 'ends_at'
  | 'location_text'
  | 'categories'
  | 'links'
  | 'image_url'
> & { venue: { id: string } | null }

const sameInstant = (a: string | null, b: string | null) => (a && b ? Date.parse(a) === Date.parse(b) : a === b)
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** The fields where the event and the feed item differ, in the order of the event page. */
export function mergeRows(event: MergeEvent, draft: IngestDraft): MergeRow[] {
  const rows: MergeRow[] = []
  const row = (key: MergeKey, label: string, eventEmpty: boolean) =>
    rows.push({ key, label, synced: !key.startsWith('link:') || key === `link:${SYNCED_LINK}`, initial: eventEmpty ? 'feed' : 'event' })

  if (event.title.trim() !== draft.title.trim()) row('title', 'Title', !event.title.trim())
  if (!sameInstant(event.starts_at, draft.starts_at) || !event.start_time_known || !sameInstant(event.ends_at, draft.ends_at)) {
    // A day without a time is "nothing yet", unless the feed's times are a guess as well
    row('times', 'Date and time', !event.start_time_known && !draft.times_unverified)
  }
  const samePlace = draft.venue_id
    ? event.venue?.id === draft.venue_id
    : !event.venue && (event.location_text ?? '') === (draft.location_text ?? '')
  if (!samePlace) row('place', 'Place', !event.venue && !event.location_text)
  if (!sameSet(event.categories, draft.categories)) row('categories', 'Category', event.categories.length === 0)
  if (event.description.trim() !== draft.description.trim()) row('description', 'Description', !event.description.trim())
  const sameLineup = JSON.stringify(canonicalLineup(event.lineup)) === JSON.stringify(canonicalLineup(draft.lineup))
  if (!sameLineup) row('lineup', 'Lineup', event.lineup.length === 0)
  if (draft.image_url) row('image', 'Image', !event.image_url)
  for (const [key, url] of Object.entries(draft.links)) {
    if (event.links[key] !== url) row(`link:${key}`, linkLabel(key), !event.links[key])
  }
  return rows
}

/** The side a row ends up with: a synced row follows the feed while `sync` is on. */
export const sideOf = (row: MergeRow, choice: Partial<Record<MergeKey, MergeSide>>, sync: boolean): MergeSide =>
  sync && row.synced ? 'feed' : (choice[row.key] ?? row.initial)

/** The body for POST /ingest/items/:id/link. */
export function linkBody(eventId: string, rows: MergeRow[], choice: Partial<Record<MergeKey, MergeSide>>, sync: boolean): Required<IngestLinkInput> {
  const fromFeed = rows.filter((r) => sideOf(r, choice, sync) === 'feed').map((r) => r.key)
  return {
    event_id: eventId,
    fields: fromFeed.filter((k): k is IngestMergeField => !k.startsWith('link:')),
    links: fromFeed.filter((k) => k.startsWith('link:')).map((k) => k.slice('link:'.length)),
    sync,
  }
}
