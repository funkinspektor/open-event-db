import { eq } from 'drizzle-orm'
import { venues, type Event } from '@open-event-db/db'
import type { IngestDraft, IngestMergeField } from '@open-event-db/shared'
import type { DbOrTx } from '../history.js'

/**
 * The event columns a link takes over from the feed's draft: the chosen fields, and the feed URL of each
 * chosen link key (a key the feed does not have is ignored). The image is not a column here; the caller
 * copies it after the commit.
 */
export async function mergePatch(
  tx: DbOrTx,
  current: Event,
  draft: IngestDraft,
  fallbackLocation: string,
  take: { fields: readonly IngestMergeField[]; links: readonly string[] },
): Promise<Partial<Event>> {
  const fields = new Set(take.fields)
  const patch: Partial<Event> = {}
  if (fields.has('title')) patch.title = draft.title
  if (fields.has('description')) patch.description = draft.description
  if (fields.has('lineup')) patch.lineup = draft.lineup
  if (fields.has('categories')) patch.categories = draft.categories
  if (fields.has('times')) {
    patch.startsAt = new Date(draft.starts_at)
    patch.startTimeKnown = true
    patch.endsAt = draft.ends_at ? new Date(draft.ends_at) : null
  }
  if (fields.has('place')) {
    patch.venueId = draft.venue_id
    patch.locationText = draft.location_text
    patch.city = draft.city
    if (draft.venue_id) {
      const [venue] = await tx.select({ city: venues.city }).from(venues).where(eq(venues.id, draft.venue_id))
      if (venue) patch.city = venue.city
      else {
        // The mapped venue was deleted since the run: keep a readable place, as accept does.
        patch.venueId = null
        patch.locationText = draft.location_text ?? fallbackLocation
      }
    }
  }

  const fromFeed = take.links.filter((key) => draft.links[key])
  if (fromFeed.length) {
    patch.links = { ...current.links }
    for (const key of fromFeed) patch.links[key] = draft.links[key]!
  }
  return patch
}
