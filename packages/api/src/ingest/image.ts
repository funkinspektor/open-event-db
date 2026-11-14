import { and, eq, sql } from 'drizzle-orm'
import { ingestItems, type IngestItem } from '@open-event-db/db'
import type { IngestDraft } from '@open-event-db/shared'
import { db } from '../db.js'
import { replaceEventImage } from '../images/events.js'
import { fetchRemoteImage } from '../images/fetch.js'
import { imageStore, isLocalStore } from '../images/store.js'

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
export async function syncItemImage(item: IngestItem, draft: IngestDraft, accountId: string): Promise<void> {
  if (item.status !== 'accepted' || !item.eventId || item.detachedAt || !imageStore.store) return
  if (draft.image_url === item.imageSourceUrl) return

  try {
    const image = draft.image_url ? await fetchRemoteImage(draft.image_url, fetchImpl) : null
    if (draft.image_url && !image) return
    await replaceEventImage(item.eventId, image, {
      accountId,
      ingestItem: { id: item.id, sourceUrl: draft.image_url },
    })
  } catch (err) {
    console.warn(`Could not sync the image of ingest item ${item.id}:`, err instanceof Error ? err.message : err)
  }
}

/**
 * Moves the image a person uploaded with a suggestion onto its event (accept, or link taking the image): copies it
 * as the scout's edit, then deletes the suggestion's own object and forgets its key. When the copy fails the object
 * is kept, so the upload is not lost. Never throws.
 */
export async function moveSuggestionImage(eventId: string, item: IngestItem, draft: IngestDraft, accountId: string): Promise<void> {
  const store = imageStore.store
  const key = item.imageKey
  if (!key || !store) return
  try {
    // A local development store serves from localhost, which fetchRemoteImage refuses: read the file instead
    let copied: boolean
    if (isLocalStore(store)) {
      const image = await store.read(key)
      copied = !!image && (await replaceEventImage(eventId, image, { accountId })).applied
    } else {
      copied = await copyItemImage(eventId, draft, accountId)
    }
    if (copied) await dropSuggestionImage(item)
  } catch (err) {
    console.warn(`Could not move the image of suggestion ${item.id}:`, err instanceof Error ? err.message : err)
  }
}

/** Forgets a decided suggestion's own image and deletes its object. Never throws. */
export async function dropSuggestionImage(item: IngestItem): Promise<void> {
  const store = imageStore.store
  const key = item.imageKey
  if (!key || !store) return
  try {
    await db
      .update(ingestItems)
      .set({ imageKey: null, draft: sql`jsonb_set(${ingestItems.draft}, '{image_url}', 'null'::jsonb)` })
      .where(and(eq(ingestItems.id, item.id), eq(ingestItems.imageKey, key)))
    await store.delete(key)
  } catch (err) {
    console.warn(`Could not delete the image ${key} of suggestion ${item.id}:`, err instanceof Error ? err.message : err)
  }
}

/**
 * Copies the feed image onto an event once, as a person's edit: for a scout who links an item without
 * keeping it synced. Never throws; returns whether the event now shows the feed image.
 */
export async function copyItemImage(eventId: string, draft: IngestDraft, accountId: string): Promise<boolean> {
  if (!draft.image_url || !imageStore.store) return false
  try {
    const image = await fetchRemoteImage(draft.image_url, fetchImpl)
    if (!image) return false
    return (await replaceEventImage(eventId, image, { accountId })).applied
  } catch (err) {
    console.warn(`Could not copy the feed image onto event ${eventId}:`, err instanceof Error ? err.message : err)
    return false
  }
}
