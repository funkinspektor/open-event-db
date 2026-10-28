import { and, eq, isNull } from 'drizzle-orm'
import { ingestItems } from '@open-event-db/db'
import type { DbOrTx } from '../history.js'

/** Stops feed sync for an event after a human edit, cancel or claim. Keeps an earlier detachedAt. */
export async function detachIngest(tx: DbOrTx, eventId: string): Promise<void> {
  await tx
    .update(ingestItems)
    .set({ detachedAt: new Date() })
    .where(and(eq(ingestItems.eventId, eventId), isNull(ingestItems.detachedAt)))
}
