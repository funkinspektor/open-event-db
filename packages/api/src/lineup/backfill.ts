import { and, eq, inArray, sql } from 'drizzle-orm'
import { events, ingestItems } from '@open-event-db/db'
import type { Lineup } from '@open-event-db/shared'
import { db } from '../db.js'
import { diff, logEdit } from '../history.js'
import { eventSnapshot } from '../queries/events.js'
import { splitMarkdownLineup } from './markdown.js'

export interface BackfillChange {
  id: string
  title: string
  lineup: Lineup
  description: string
}

/**
 * Events without a lineup (and not kept in sync by a feed) whose description holds one as Markdown lists: what would move, and with
 * `write` the move itself, one transaction and one history entry (`via: 'cli'`, as the event's adder) each.
 * `ids` limits it to those events (tests).
 */
export async function backfillMarkdownLineups(opts: { write: boolean; ids?: string[] }): Promise<BackfillChange[]> {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        sql`${events.lineup} = '[]'::jsonb`,
        // A feed keeps the event in sync: its next run would put the description back
        sql`not exists (select 1 from ${ingestItems} where ${ingestItems.eventId} = ${events.id} and ${ingestItems.detachedAt} is null)`,
        opts.ids ? inArray(events.id, opts.ids) : undefined,
      ),
    )
    .orderBy(events.startsAt)

  const changes: BackfillChange[] = []
  for (const e of rows) {
    const split = splitMarkdownLineup(e.description)
    if (!split) continue
    changes.push({ id: e.id, title: e.title, ...split })
    if (!opts.write) continue
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(events)
        .set({ lineup: split.lineup, description: split.description, updatedAt: new Date() })
        .where(and(eq(events.id, e.id), sql`${events.lineup} = '[]'::jsonb`))
        .returning()
      if (!updated) return // edited in the meantime
      await logEdit(tx, {
        entityType: 'event',
        entityId: e.id,
        publisherId: e.createdBy,
        action: 'updated',
        diff: { ...diff(eventSnapshot(e), eventSnapshot(updated)), via: 'cli' },
      })
    })
  }
  return changes
}
