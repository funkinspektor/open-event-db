import type { IngestItem } from '@open-event-db/db'
import type { IngestDraft } from '@open-event-db/shared'
import { replaceEventImage } from '../images/events.js'
import { fetchRemoteImage } from '../images/fetch.js'
import { imageStore } from '../images/store.js'

let fetchImpl: typeof fetch = fetch

/** The network for feed images, behind a holder so tests stub it. */
export const ingestImages = {
  setFetch(f: typeof fetch) {
    fetchImpl = f
  },
  reset() {
    fetchImpl = fetch
  },
}

/**
 * Brings an accepted, still synced item's event image in line with the feed: copies a new or changed feed
 * image into the store, removes it when the feed dropped it. A failed fetch changes nothing, so the next
 * run (which compares again) retries. Never throws: an image must not fail an accept or a run.
 */
export async function syncItemImage(item: IngestItem, draft: IngestDraft, publisherId: string): Promise<void> {
  if (item.status !== 'accepted' || !item.eventId || item.detachedAt || !imageStore.store) return
  if (draft.image_url === item.imageSourceUrl) return

  try {
    const image = draft.image_url ? await fetchRemoteImage(draft.image_url, fetchImpl) : null
    if (draft.image_url && !image) return
    await replaceEventImage(item.eventId, image, {
      publisherId,
      ingestItem: { id: item.id, sourceUrl: draft.image_url },
    })
  } catch (err) {
    console.warn(`Could not sync the image of ingest item ${item.id}:`, err instanceof Error ? err.message : err)
  }
}
