import { eq } from 'drizzle-orm'
import { events, ingestItems } from '@open-event-db/db'
import { db } from '../db.js'
import { diff, logEdit } from '../history.js'
import { detachIngest } from '../ingest/detach.js'
import { eventSnapshot } from '../queries/events.js'
import { imageKey, imageStore, type ImageStore } from './store.js'
import type { ImageType } from './sniff.js'

export interface ReplaceImageOptions {
  /** Who the edit is logged for. */
  publisherId: string
  /** A person's change: the feed must stop syncing this event. */
  detach?: boolean
  /**
   * A feed sync: applied only while this item is still attached to the event, and records which feed
   * image URL the event image now comes from. Logged with `via: 'ingest'`.
   */
  ingestItem?: { id: string; sourceUrl: string | null }
}

async function deleteQuietly(store: ImageStore, key: string) {
  try {
    await store.delete(key)
  } catch (err) {
    // An orphaned object costs a few kB; it must not fail the edit that replaced it
    console.warn(`Could not delete image ${key}:`, err instanceof Error ? err.message : err)
  }
}

/**
 * Sets (or with `image: null` removes) an event's image. The new object is uploaded first; the event row
 * then points at it in one transaction; only after that commits is the previous object deleted, so the
 * event never points at a missing object. `applied` is false when the event or the attached item is gone.
 */
export async function replaceEventImage(
  eventId: string,
  image: { data: Buffer; type: ImageType } | null,
  opts: ReplaceImageOptions,
): Promise<{ applied: boolean; key: string | null }> {
  const store = imageStore.store
  if (!store) throw new Error('Event images are off: no image store configured')

  const key = image ? imageKey(eventId, image.type) : null
  if (image && key) await store.put(key, image.data, image.type)

  let previous: string | null = null
  let applied: boolean
  try {
    applied = await db.transaction(async (tx) => {
      // Event first, then item: the lock order of the event routes and the sync run
      const [current] = await tx.select().from(events).where(eq(events.id, eventId)).for('update')
      if (!current) return false
      if (opts.ingestItem) {
        const [item] = await tx.select().from(ingestItems).where(eq(ingestItems.id, opts.ingestItem.id)).for('update')
        if (!item || item.eventId !== eventId || item.detachedAt) return false
        await tx.update(ingestItems).set({ imageSourceUrl: opts.ingestItem.sourceUrl }).where(eq(ingestItems.id, item.id))
      }
      if (current.imageKey === key) return true // removing an image the event does not have

      const [updated] = await tx
        .update(events)
        .set({ imageKey: key, updatedAt: new Date() })
        .where(eq(events.id, eventId))
        .returning()
      if (!updated) throw new Error('update returned no row')
      previous = current.imageKey
      const changes = diff(eventSnapshot(current), eventSnapshot(updated))
      await logEdit(tx, {
        entityType: 'event',
        entityId: eventId,
        publisherId: opts.publisherId,
        action: 'updated',
        diff: opts.ingestItem ? { ...changes, via: 'ingest' } : changes,
      })
      if (opts.detach) await detachIngest(tx, eventId)
      return true
    })
  } catch (err) {
    if (key) await deleteQuietly(store, key)
    throw err
  }

  if (!applied) {
    if (key) await deleteQuietly(store, key)
    return { applied: false, key: null }
  }
  if (previous) await deleteQuietly(store, previous)
  return { applied: true, key }
}
