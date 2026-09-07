import { editHistory, type Db } from '@open-event-db/db'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

export type EntityType = 'event' | 'venue' | 'publisher' | 'invite'
export type HistoryAction = 'created' | 'updated' | 'cancelled' | 'ownership_changed'
export type Diff = Record<string, { before: unknown; after: unknown }>

export function diff(before: Record<string, unknown> | null, after: Record<string, unknown>): Diff {
  const out: Diff = {}
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)])
  for (const k of keys) {
    const b = before ? before[k] : undefined
    const a = after[k]
    if (JSON.stringify(b) !== JSON.stringify(a)) out[k] = { before: b ?? null, after: a ?? null }
  }
  return out
}

export async function logEdit(
  tx: DbOrTx,
  entry: {
    entityType: EntityType
    entityId: string
    publisherId: string
    action: HistoryAction
    diff: Diff
  },
): Promise<void> {
  await tx.insert(editHistory).values(entry)
}
